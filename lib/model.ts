// The launch radar's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// The board ranks protocols that record no token yet by the value a launch could carry if the
// protocol's record stayed as it is. The value is calibrated on the snapshot's own market, never on
// a hand-written list of names:
//
//   comps     = for every category, the median market-cap / TVL ratio of that category's protocols
//               whose token already trades in this same snapshot, shrunk toward the market-wide
//               median by the number of trading peers (a category with few peers borrows strength
//               from the whole market instead of trusting two or three prints)
//   base      = tvl_usd x comps(category)
//   momentum  = 1 + clamp(change_7d, -50, 100) / 100 x 0.4, held inside [0.7, 1.4];
//               an unreported seven-day change is neutral, never invented
//   seasoning = 0.75 + 0.45 x min(age_days, 1460) / 1460: a protocol that has run four years with
//               no token has a record a launch can be priced on; a three-week-old one has mostly
//               promises. An unknown listing date is scored as 540 days and says so.
//   breadth   = 1 + 0.03 x min(chains - 1, 7): TVL spread over more chains is harder to fake and
//               cheaper to distribute a launch across.
//   implied   = max(1, round(base x momentum x seasoning x breadth))
//
// Who is ranked: a protocol that records no token (no market cap, no CoinGecko id, no symbol) and is
// not, on the snapshot's own fields, a wrapped, staked or bridged product of a token that already
// trades. The exclusions mirror the house watchlist's own definition where the snapshot's ten
// fields can see it: an excluded category (Bridge, Canonical Bridge, Liquid Staking, Liquid
// Restaking, Restaked BTC, CEX), a name ending in a version marker, a name carrying the whole word
// wrapped, staked or staking, or a name beginning with an exchange's. Excluded pre-token protocols
// are not dropped: they are set aside in their own view with the reason, beside the protocols whose
// token already trades. DefiLlama's record is not proof, so the board says a protocol records no
// token, never that it has none.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it and the board's rows carry it. */
export const MODEL_VERSION = 'comps-2';

/** How many already-trading protocols the dashboard's comparison view carries, by market cap. */
export const LIVE_ROWS = 36;

/** How many set-aside protocols the dashboard's set-aside view carries, by TVL. */
export const ASIDE_ROWS = 60;

/** The model's few global constants. Everything category-shaped is measured, not set here. */
export const MODEL = {
  /** Trading peers a category needs before its own median is trusted at full weight. */
  shrink_peers: 4,
  /** Momentum: how much of a seven-day TVL move the value takes. */
  momentum_weight: 0.4,
  momentum_floor_pct: -50,
  momentum_cap_pct: 100,
  momentum_min: 0.7,
  momentum_max: 1.4,
  /** Seasoning: the factor's floor, its range, and the days to earn the whole range. */
  seasoning_floor: 0.75,
  seasoning_range: 0.45,
  seasoning_days: 1460,
  unknown_age_days: 540,
  /** Breadth: the factor each extra chain adds, and how many extra chains count. */
  breadth_per_chain: 0.03,
  breadth_max_extra: 7,
};

/** One category's measured multiple: its trading peers' median mcap/TVL and how many peers priced it. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  peers: number;
}

/** The measured market the model prices against: a multiple per category plus the market-wide one. */
export interface CompTable {
  global_multiple: number;
  global_peers: number;
  by_category: Map<string, CategoryMultiple>;
}

/** A farm step before it is flattened: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row, with the model's working shown. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_peers: number;
    momentum_multiplier: number;
    seasoning_multiplier: number;
    breadth_multiplier: number;
    growth_pct: number | null;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: everything the page renders, farm plan included. */
export interface RadarRow extends BoardRow {}

/** A protocol whose token already trades: the market's own value, never the model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
}

/** A pre-token protocol set aside as a wrapped, staked or bridged product, with the reason. */
export interface AsideRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  reason: string;
}

/** Everything the dashboard needs: the board, the comparison sets, and the measured model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model_constants: typeof MODEL;
  global_multiple: number;
  global_peers: number;
  categories: CategoryMultiple[];
  scanned_size: number;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  aside_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  aside: AsideRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all on the snapshot's fields. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are products of another token, not launches of their own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a wrapped product may begin with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Why a pre-token protocol is set aside instead of ranked, or null when it is a launch candidate.
 * Every test reads the snapshot's own ten fields and mirrors the house watchlist's definition.
 */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) {
    return `a ${p.category} product: it wraps, stakes or bridges a token that already trades`;
  }
  if (VERSIONED.test(p.name)) return 'its name ends in a version marker: a pool of another protocol, not a launch of its own';
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return 'its name marks it as a wrapped or staked product of a token that already trades';
  for (const ex of EXCHANGE_PREFIXES) {
    if (p.name === ex || p.name.startsWith(`${ex} `) || p.name.startsWith(`${ex}-`)) {
      return `it begins with the exchange name ${ex}: an exchange product, not a launch candidate`;
    }
  }
  return null;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The measured market: for each category, the median mcap/TVL of its protocols whose token already
 * trades, shrunk toward the market-wide median by peer count. A category with no trading peer
 * prices at the market-wide multiple and says its peer count is zero.
 */
export function compTable(snapshot: Snapshot): CompTable {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    if (p.category !== null) {
      const list = ratiosByCategory.get(p.category) ?? [];
      list.push(ratio);
      ratiosByCategory.set(p.category, list);
    }
  }
  const globalMultiple = all.length > 0 ? median(all) : 0.15;
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, ratios] of ratiosByCategory) {
    const own = median(ratios);
    const n = ratios.length;
    const shrunk = (n * own + MODEL.shrink_peers * globalMultiple) / (n + MODEL.shrink_peers);
    byCategory.set(category, { category, multiple: round4(shrunk), peers: n });
  }
  return { global_multiple: round4(globalMultiple), global_peers: all.length, by_category: byCategory };
}

/** The multiple one protocol prices at, and how many trading peers stand behind it. */
function multipleFor(p: SnapshotProtocol, comps: CompTable): CategoryMultiple {
  if (p.category !== null) {
    const found = comps.by_category.get(p.category);
    if (found !== undefined) return found;
  }
  return { category: p.category ?? '(none)', multiple: comps.global_multiple, peers: 0 };
}

/** The four factors and the implied value one protocol gets, with the model's working kept. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  comps: CompTable,
): { implied: number; multiple: CategoryMultiple; momentumMult: number; seasoningMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const multiple = multipleFor(p, comps);
  const base = p.tvl_usd * multiple.multiple;
  const growthPct = p.change_7d === null ? null : Math.min(MODEL.momentum_cap_pct, Math.max(MODEL.momentum_floor_pct, p.change_7d));
  const momentumMult = growthPct === null
    ? 1
    : Math.min(MODEL.momentum_max, Math.max(MODEL.momentum_min, 1 + (growthPct / 100) * MODEL.momentum_weight));
  const ageForModel = age ?? MODEL.unknown_age_days;
  const seasoningMult = MODEL.seasoning_floor + (Math.min(Math.max(ageForModel, 0), MODEL.seasoning_days) / MODEL.seasoning_days) * MODEL.seasoning_range;
  const breadthMult = 1 + MODEL.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), MODEL.breadth_max_extra);
  const implied = Math.max(1, Math.round(base * momentumMult * seasoningMult * breadthMult));
  return { implied, multiple, momentumMult, seasoningMult, breadthMult, age };
}

/** A small deterministic hash of a slug, so wording varies by protocol and never by run. */
function slugHash(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction roughly costs on a chain, in the words a farmer budgets with. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $4-12 of gas';
  if (c === 'solana') return 'under $0.05 of gas';
  if (c === 'bsc') return 'about $0.30 of gas';
  if (['base', 'arbitrum', 'optimism', 'linea', 'scroll', 'mantle', 'blast', 'zksync era', 'mode', 'taiko'].includes(c)) return 'under $0.50 of gas';
  if (['polygon', 'avalanche', 'fantom', 'gnosis', 'celo', 'moonbeam', 'cronos', 'kava', 'sei', 'berachain', 'sonic', 'hyperevm'].includes(c)) return 'under $1 of gas';
  return 'a few dollars of gas at most';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 250_000_000) return 120;
  if (p.tvl_usd >= 50_000_000) return 80;
  if (p.tvl_usd >= 10_000_000) return 50;
  return 30;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in the words a farmer can follow, with its second beat. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend')) {
    return [
      `Supply $${capital} of USDC to ${name} on ${chain} as the core position and leave it supplied.`,
      `Borrow about $${Math.round(capital / 4)} against the position once, hold it a week, then repay in full so the account shows both sides of the market.`,
    ];
  }
  if (c.includes('cdp')) {
    return [
      `Open a vault on ${name} with $${capital} of collateral on ${chain} and mint its stablecoin against it at a conservative ratio.`,
      `Hold half the minted stablecoin and put the rest to work inside ${name}'s own app so the vault stays active.`,
    ];
  }
  if (c.includes('dex')) {
    return [
      `Provide $${capital} of liquidity to ${name}'s busiest pool on ${chain}, split evenly across both assets.`,
      `Route two or three real swaps a week through ${name} itself rather than an aggregator, so the volume is the protocol's own.`,
    ];
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return [
      `Deposit $${capital} into one of ${name}'s curated vaults on ${chain} and keep the vault shares in the same wallet.`,
      `Read the curator's latest allocation note and move the deposit only if the vault itself migrates; churn earns nothing here.`,
    ];
  }
  if (c.includes('derivative') || c.includes('perpetual')) {
    return [
      `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position you can hold for weeks.`,
      `Keep the margin ratio comfortably above liquidation and add a second small trade each week rather than sizing up.`,
    ];
  }
  if (c.includes('rwa')) {
    return [
      `Mint or subscribe $${capital} of ${name}'s yield asset on ${chain} and hold it in the farming wallet.`,
      `Complete the protocol's own onboarding or allowlist steps early; RWA launches reward accounts that finished them before any snapshot.`,
    ];
  }
  if (c.includes('basis')) {
    return [
      `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position untouched.`,
      `Check the vault's funding-rate note monthly; the position is the product, so leave it running through quiet weeks.`,
    ];
  }
  if (c.includes('yield')) {
    return [
      `Deposit $${capital} into ${name}'s flagship vault on ${chain} and switch on auto-compounding where it is offered.`,
      `Harvest or restake the yield once a month so the account shows a second kind of activity, not just a deposit.`,
    ];
  }
  if (c.includes('launchpad') || c.includes('launch')) {
    return [
      `Stake or commit $${capital} on ${name} and take part in one full launch allocation round on ${chain}.`,
      `Claim and hold whatever the round allocates; selling on day one is the pattern launchpads learn to filter out.`,
    ];
  }
  if (c.includes('insurance')) {
    return [
      `Buy $${capital} of cover from ${name} on ${chain} against a position you actually hold, and keep the policy to expiry.`,
      `Renew the cover once when it lapses so the account carries a second policy period.`,
    ];
  }
  if (c.includes('prediction')) {
    return [
      `Fund $${capital} on ${name} and take one position in a market you have a view on.`,
      `Settle the position at resolution and take a second market the following week; settled history is what counts.`,
    ];
  }
  return [
    `Deposit $${capital} of USDC into ${name} on ${chain} and use its core product the way a real user would.`,
    `Repeat the core action on a second day in the same week so the account shows a pattern, not a single touch.`,
  ];
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age) with wording varied by a hash of its slug,
 * never from a hand-written list of names and never from the clock or a random source.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const [core, second] = actionsFor(p, capital, chain);
  const variant = slugHash(p.slug) % 3;
  const walletStep = [
    'Start from a fresh wallet that holds only the funds for this farm, its seed phrase written down offline and never typed into a site.',
    'Use one dedicated wallet for this protocol alone, funded only with what the plan needs, its seed phrase kept offline.',
    'Open a clean wallet for this farm and label it with the protocol name, so its history is never mixed with trading wallets.',
  ][variant]!;
  const crossChain = p.chains.length > 1
    ? {
        text: `Repeat a smaller $${Math.max(20, Math.round(capital / 3))} position on ${p.chains[1]!}, the protocol's second chain, so the account is visible in more than one of its markets.`,
        cost: `${gasFor(p.chains[1]!)} plus the bridge fee`,
        time: '20 minutes',
      }
    : {
        text: `Take part once in ${p.name}'s own governance or community channel: cast one vote or answer one feedback round, from the same wallet.`,
        cost: 'nothing but the vote transaction',
        time: '10 minutes',
      };
  return [
    { text: walletStep, cost: 'nothing to open; the first funding transfer pays network fees', time: '10 minutes' },
    { text: core, cost: `$${capital} of capital and ${gas}`, time: '15 minutes to set up' },
    { text: second, cost: `${gas} for the extra transactions`, time: '10 minutes' },
    crossChain,
    {
      text: `Keep one qualifying action a week for at least ${hold} days (a deposit top-up, a swap, a vote), and hold the position through the whole window so it appears in more than one activity snapshot.`,
      cost: `about $2 of gas a week on ${chain} at this plan's size`,
      time: `10 minutes a week for ${hold} days`,
    },
    {
      text: `Before any claim day, open only the points or rewards page ${p.name} itself publishes, claim only from its own link, and never pay a fee to claim. Log every transaction hash in a farm log so the position can be repeated or unwound.`,
      cost: 'no fee to check; a claim that asks for payment is a scam',
      time: '10 minutes to check, 5 minutes a week to log',
    },
  ];
}

/** The ranked board: every launch candidate, most valuable first, ranks 1..n. */
export function buildBoard(snapshot: Snapshot, comps: CompTable = compTable(snapshot)): BoardRow[] {
  const watchlist = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter((p) => isPreToken(p) && setAsideReason(p) === null)
    .map((p) => ({ p, ...impliedValue(p, snapshot.as_of, comps) }));
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watchlist.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple.multiple,
      category_peers: s.multiple.peers,
      momentum_multiplier: round4(s.momentumMult),
      seasoning_multiplier: round4(s.seasoningMult),
      breadth_multiplier: round4(s.breadthMult),
      growth_pct: s.p.change_7d === null ? null : Math.min(MODEL.momentum_cap_pct, Math.max(MODEL.momentum_floor_pct, s.p.change_7d)),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The already-trading protocols, by market cap, for the dashboard's comparison view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

/** The set-aside pre-token protocols, by TVL, each with the reason it is not ranked. */
export function asideRows(snapshot: Snapshot): AsideRow[] {
  return snapshot.protocols
    .filter((p) => isPreToken(p))
    .map((p) => ({ p, reason: setAsideReason(p) }))
    .filter((x): x is { p: SnapshotProtocol; reason: string } => x.reason !== null)
    .sort((a, b) => b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1))
    .slice(0, ASIDE_ROWS)
    .map(({ p, reason }) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      reason,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const comps = compTable(snapshot);
  const board = buildBoard(snapshot, comps);
  const live = liveRows(snapshot);
  const aside = asideRows(snapshot);
  const categories = [...comps.by_category.values()].sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model_constants: MODEL,
    global_multiple: comps.global_multiple,
    global_peers: comps.global_peers,
    categories,
    scanned_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    aside_size: aside.length,
    rows: board,
    live,
    aside,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: size, coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
