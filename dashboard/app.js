'use strict';

/* Token Launch Radar dashboard. Renders window.RADAR (written beside this page as ../data.js by
   main.ts) with no fetch and no network: the board, the already-trading comparison set, the
   set-aside set, and one detail page per protocol. The location hash carries the view so a
   screenshot can be taken of any state: #/ is the board (filters ride in its query string),
   #/live and #/aside are the other views, #/p/<slug> is a protocol's detail page. */

const R = window.RADAR;
const viewEl = document.getElementById('view');
const detailEl = document.getElementById('detail');
const toolbarEl = document.getElementById('toolbar');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtUsd(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n);
}
function fmtPct(n) {
  if (n === null || n === undefined) return '<span class="flat">n/r</span>';
  const cls = n > 0.05 ? 'pos' : n < -0.05 ? 'neg' : 'flat';
  return `<span class="${cls}">${n > 0 ? '+' : ''}${n.toFixed(1)}%</span>`;
}
function fmtAge(days) {
  if (days === null || days === undefined) return 'unreported';
  if (days >= 730) return (days / 365.25).toFixed(1) + ' yrs';
  if (days >= 60) return Math.round(days / 30.4) + ' mo';
  return days + ' d';
}
function fmtMult(x) { return '×' + Number(x).toFixed(3); }
function chainList(chains) { return chains.length ? esc(chains.slice(0, 3).join(', ')) + (chains.length > 3 ? ` +${chains.length - 3}` : '') : '—'; }

/* ---------- header and model panel ---------- */

function renderHeader() {
  document.getElementById('subline').textContent =
    `Snapshot ${R.as_of} · ${R.source} · ${R.scanned_size} protocols scanned · model ${R.model_version}`;
  const top = R.rows[0];
  document.getElementById('stats').innerHTML = [
    [R.board_size, 'on the board'],
    [R.watchlist_size + '/' + R.watchlist_size, 'watchlist covered'],
    [R.live_size, 'already trading'],
    [top ? fmtUsd(top.implied_value_usd) : '—', 'top implied value'],
  ].map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
  document.getElementById('foot').textContent =
    'Implied value is a model estimate from the snapshot\'s own numbers, not a price prediction and not financial advice. ' +
    'A protocol is listed as pre-token when the snapshot records no token for it; the record is not proof none exists.';
}

function renderModel() {
  const cats = R.categories.slice(0, 14);
  const rowsHtml = cats.map((c) =>
    `<tr><td>${esc(c.category)}</td><td class="num">${c.peers}</td><td class="num">${fmtMult(c.multiple)}</td></tr>`).join('');
  document.getElementById('model').innerHTML = `
    <h2>How the radar prices a launch</h2>
    <p>Every protocol that records no token is priced from the snapshot's own market, never from its name.
    <code>implied = TVL × category multiple × momentum × seasoning × breadth</code>.
    The category multiple is the <b>median market-cap / TVL of that category's already-trading protocols in this
    snapshot</b>, shrunk toward the market-wide median (${fmtMult(R.global_multiple)} across ${R.global_peers} trading protocols)
    when a category has few peers, with peer ratios winsorized at the market's own 95th percentile (${fmtMult(R.ratio_cap)})
    so one token trading at hundreds of times its recorded TVL cannot carry a whole category. Momentum takes 40% of the seven-day TVL move, clamped; seasoning rewards a longer
    no-token record; breadth rewards TVL spread over more chains. Protocols whose token already trades are kept apart
    below, and wrapped, staked or bridged products are set aside with their reason — the board ranks launches, not wrappers.</p>
    <table class="mult-table"><thead><tr><th>Category</th><th>Trading peers</th><th>Multiple used</th></tr></thead>
    <tbody>${rowsHtml}</tbody></table>`;
}

/* ---------- routing ---------- */

function parseHash() {
  const h = location.hash.replace(/^#/, '');
  const detail = h.match(/^\/p\/(.+)$/);
  if (detail) return { view: 'detail', slug: decodeURIComponent(detail[1]) };
  if (h.startsWith('/live')) return { view: 'live' };
  if (h.startsWith('/aside')) return { view: 'aside' };
  const q = new URLSearchParams(h.includes('?') ? h.slice(h.indexOf('?') + 1) : '');
  return {
    view: 'board',
    q: q.get('q') || '',
    cat: q.get('cat') || '',
    chain: q.get('chain') || '',
    min: Number(q.get('min') || 0),
    wl: q.get('wl') === '1',
    sort: q.get('sort') || 'value',
  };
}

function boardHash(st) {
  const p = new URLSearchParams();
  if (st.q) p.set('q', st.q);
  if (st.cat) p.set('cat', st.cat);
  if (st.chain) p.set('chain', st.chain);
  if (st.min) p.set('min', String(st.min));
  if (st.wl) p.set('wl', '1');
  if (st.sort && st.sort !== 'value') p.set('sort', st.sort);
  const s = p.toString();
  return '#/' + (s ? '?' + s : '');
}

let state = parseHash();

function setTab(view) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
}

/* ---------- board view ---------- */

function fillFilterOptions() {
  const cats = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  document.getElementById('cat').innerHTML =
    '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  document.getElementById('chain').innerHTML =
    '<option value="">All chains</option>' + chains.map((c) => `<option>${esc(c)}</option>`).join('');
}

function filteredRows() {
  let rows = R.rows.filter((r) => {
    if (state.q) {
      const q = state.q.toLowerCase();
      if (!r.name.toLowerCase().includes(q) && !r.slug.toLowerCase().includes(q)) return false;
    }
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.min && r.tvl_usd < state.min) return false;
    if (state.wl && !r.watchlist) return false;
    return true;
  });
  const by = {
    value: (a, b) => a.rank - b.rank,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    growth: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity),
    age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
  };
  rows = rows.sort(by[state.sort] || by.value);
  return rows;
}

function renderBoard() {
  setTab('board');
  toolbarEl.style.display = '';
  detailEl.hidden = true;
  viewEl.hidden = false;
  document.getElementById('q').value = state.q || '';
  document.getElementById('cat').value = state.cat || '';
  document.getElementById('chain').value = state.chain || '';
  document.getElementById('min').value = String(state.min || 0);
  document.getElementById('wl').checked = !!state.wl;
  document.getElementById('sort').value = state.sort || 'value';
  const rows = filteredRows();
  document.getElementById('count').textContent = `${rows.length} of ${R.rows.length} protocols`;
  if (!rows.length) {
    viewEl.innerHTML = '<div class="empty">No protocol matches these filters. Loosen one and the radar fills again.</div>';
    return;
  }
  const body = rows.map((r) => `
    <tr data-slug="${esc(r.slug)}">
      <td class="rank">${r.rank}</td>
      <td><span class="name"><a href="#/p/${encodeURIComponent(r.slug)}">${esc(r.name)}</a></span>${r.watchlist ? '<span class="badge">WATCHLIST</span>' : ''}<br><span class="slug">${esc(r.slug)}</span></td>
      <td class="cat">${esc(r.category || '—')}</td>
      <td class="chains hide-s">${chainList(r.chains)}</td>
      <td class="num">${fmtUsd(r.tvl_usd)}</td>
      <td class="num hide-s">${fmtPct(r.change_7d)}</td>
      <td class="num hide-s">${fmtAge(r.age_days)}</td>
      <td class="num value">${fmtUsd(r.implied_value_usd)}</td>
    </tr>`).join('');
  viewEl.innerHTML = `
    <table class="board"><thead><tr>
      <th>#</th><th>Protocol</th><th>Category</th><th class="hide-s">Chains</th>
      <th class="num">TVL</th><th class="num hide-s">7d</th><th class="num hide-s">Age</th><th class="num">Implied value</th>
    </tr></thead><tbody>${body}</tbody></table>`;
  viewEl.querySelectorAll('tbody tr').forEach((tr) => {
    tr.addEventListener('click', () => { location.hash = '#/p/' + encodeURIComponent(tr.dataset.slug); });
  });
}

/* ---------- live and set-aside views ---------- */

function renderLive() {
  setTab('live');
  toolbarEl.style.display = 'none';
  detailEl.hidden = true;
  viewEl.hidden = false;
  const body = R.live.map((r, i) => `
    <tr>
      <td class="rank">${i + 1}</td>
      <td><span class="name">${esc(r.name)}</span> <span class="slug">${esc(r.symbol || '')}</span><br><span class="slug">${esc(r.slug)}</span></td>
      <td class="cat">${esc(r.category || '—')}</td>
      <td class="chains hide-s">${chainList(r.chains)}</td>
      <td class="num">${fmtUsd(r.tvl_usd)}</td>
      <td class="num">${fmtUsd(r.mcap_usd)}</td>
      <td class="num hide-s">${r.mcap_usd && r.tvl_usd ? fmtMult(r.mcap_usd / r.tvl_usd) : '—'}</td>
      <td class="num hide-s">${fmtPct(r.change_7d)}</td>
    </tr>`).join('');
  viewEl.innerHTML = `
    <div class="card"><p style="margin:0;color:var(--muted)">These protocols already trade, so the market — not the model — sets their value.
    They are the comparison set the board's category multiples are measured from, and they never appear on the launch board.</p></div>
    <table class="board"><thead><tr>
      <th>#</th><th>Protocol</th><th>Category</th><th class="hide-s">Chains</th>
      <th class="num">TVL</th><th class="num">Market cap</th><th class="num hide-s">MCap / TVL</th><th class="num hide-s">7d</th>
    </tr></thead><tbody>${body}</tbody></table>`;
}

function renderAside() {
  setTab('aside');
  toolbarEl.style.display = 'none';
  detailEl.hidden = true;
  viewEl.hidden = false;
  const body = R.aside.map((r) => `
    <tr>
      <td><span class="name">${esc(r.name)}</span><br><span class="slug">${esc(r.slug)}</span></td>
      <td class="cat">${esc(r.category || '—')}</td>
      <td class="chains hide-s">${chainList(r.chains)}</td>
      <td class="num">${fmtUsd(r.tvl_usd)}</td>
      <td class="reason">${esc(r.reason)}</td>
    </tr>`).join('');
  viewEl.innerHTML = `
    <div class="card"><p style="margin:0;color:var(--muted)">These protocols also record no token, but on the snapshot's own fields they are wrapped, staked,
    bridged or exchange products of a token that already trades — the same exclusions the house watchlist uses. Ranking them as
    launches would price another token's product, so they are set aside here, in the open, each with its reason.</p></div>
    <table class="board"><thead><tr>
      <th>Protocol</th><th>Category</th><th class="hide-s">Chains</th><th class="num">TVL</th><th>Why it is set aside</th>
    </tr></thead><tbody>${body}</tbody></table>`;
}

/* ---------- detail view ---------- */

function factorRow(label, value, lo, hi, note) {
  const pct = Math.max(0, Math.min(100, ((value - lo) / (hi - lo)) * 100));
  return `<div class="factor"><span class="fname">${esc(label)}</span><span class="bar"><i style="width:${pct.toFixed(1)}%"></i></span><span class="fval">${fmtMult(value)}</span></div>
  <p style="margin:0 0 6px;color:var(--muted);font-size:12.5px">${esc(note)}</p>`;
}

function renderDetail(slug) {
  const r = R.rows.find((x) => x.slug === slug);
  setTab('board');
  toolbarEl.style.display = 'none';
  viewEl.hidden = true;
  detailEl.hidden = false;
  if (!r) {
    detailEl.innerHTML = '<div class="card"><p>That protocol is not on the board.</p><p><a class="back" href="#/">&larr; Back to the board</a></p></div>';
    return;
  }
  const m = r.model;
  const base = r.tvl_usd * m.category_multiple;
  const peers = R.rows.filter((x) => x.category === r.category && x.slug !== r.slug)
    .sort((a, b) => a.rank - b.rank).slice(0, 6);
  const steps = r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('');
  detailEl.innerHTML = `
    <div class="card">
      <div class="detail-head">
        <div>
          <h2>${esc(r.name)}${r.watchlist ? '<span class="badge">WATCHLIST</span>' : ''}</h2>
          <p class="sub">${esc(r.slug)} · ${esc(r.category || 'uncategorised')} · records no token</p>
        </div>
        <a class="back" href="#/">&larr; Back to the board</a>
      </div>
      <div class="kv">
        <div><b>#${r.rank}</b><span>Board rank</span></div>
        <div><b>${fmtUsd(r.implied_value_usd)}</b><span>Implied value</span></div>
        <div><b>${fmtUsd(r.tvl_usd)}</b><span>TVL</span></div>
        <div><b>${r.change_7d === null ? 'n/r' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'}</b><span>TVL change, 7d</span></div>
        <div><b>${fmtAge(r.age_days)}</b><span>No-token record</span></div>
        <div><b>${r.chains.length || '—'}</b><span>Chains</span></div>
      </div>
      <h3 class="section">Why this value</h3>
      <p style="color:var(--muted);margin:4px 0">Base value: TVL ${fmtUsd(r.tvl_usd)} × ${esc(r.category || 'market')} multiple ${fmtMult(m.category_multiple)}
      (median of ${m.category_peers} trading peer${m.category_peers === 1 ? '' : 's'}) = ${fmtUsd(base)}, then three adjustments:</p>
      ${factorRow('Momentum (7d TVL)', m.momentum_multiplier, 0.7, 1.4, m.growth_pct === null ? 'Seven-day change unreported in the snapshot: neutral, never invented.' : `Seven-day TVL change ${m.growth_pct.toFixed(1)}%, taken at 40% and clamped.`)}
      ${factorRow('Seasoning (no-token age)', m.seasoning_multiplier, 0.75, 1.2, r.age_days === null ? 'Listing date unreported: scored as 540 days and marked as assumed.' : `${r.age_days} days with no token on record; the factor tops out at four years.`)}
      ${factorRow('Breadth (chains)', m.breadth_multiplier, 1, 1.21, `TVL present on ${r.chains.length} chain${r.chains.length === 1 ? '' : 's'}: ${esc(r.chains.join(', ') || 'none listed')}.`)}
      <h3 class="section">Farm plan</h3>
      <ol class="plan">${steps}</ol>
      ${peers.length ? `<h3 class="section">Same-category peers on the board</h3><div class="peers">${peers.map((p) => `<a href="#/p/${encodeURIComponent(p.slug)}">#${p.rank} ${esc(p.name)} · ${fmtUsd(p.implied_value_usd)}</a>`).join('')}</div>` : ''}
    </div>`;
  window.scrollTo(0, 0);
}

/* ---------- wiring ---------- */

function render() {
  state = parseHash();
  if (state.view === 'detail') renderDetail(state.slug);
  else if (state.view === 'live') renderLive();
  else if (state.view === 'aside') renderAside();
  else renderBoard();
}

function pushFilters() {
  const st = {
    view: 'board',
    q: document.getElementById('q').value.trim(),
    cat: document.getElementById('cat').value,
    chain: document.getElementById('chain').value,
    min: Number(document.getElementById('min').value),
    wl: document.getElementById('wl').checked,
    sort: document.getElementById('sort').value,
  };
  const h = boardHash(st);
  if (location.hash === h) { state = st; renderBoard(); } else { location.hash = h; }
}

document.querySelectorAll('.tab').forEach((b) => {
  b.addEventListener('click', () => {
    location.hash = b.dataset.view === 'board' ? '#/' : '#/' + b.dataset.view;
  });
});
['q', 'cat', 'chain', 'min', 'wl', 'sort'].forEach((id) => {
  document.getElementById(id).addEventListener('input', pushFilters);
  document.getElementById(id).addEventListener('change', pushFilters);
});
window.addEventListener('hashchange', render);

renderHeader();
renderModel();
fillFilterOptions();
render();
