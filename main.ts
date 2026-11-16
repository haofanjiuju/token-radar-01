// Token launch radar: one sealed snapshot in, a ranked board and a static dashboard out.
//
// Usage (from the repository root):
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json-or-dir>
//
// The program is deterministic: the same snapshot always produces the same board.json and data.js,
// byte for byte. It reads no clock, draws no random number, and touches no network. The dashboard
// and screenshots are copied into the output so the dossier carries the same page the screenshots
// show, and dossier.json is written last, from the finished output, with the house library.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));

/** The one positional argument, or its default: --input <snapshot.json | directory holding it>. */
function inputPath(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--input needs a path');
      return value;
    }
    if (argv[i]!.startsWith('--input=')) return argv[i]!.slice('--input='.length);
  }
  return join(ROOT, 'input', 'snapshot.json');
}

/** The snapshot file behind an --input that may name the file or the directory holding it. */
function snapshotFile(path: string): string {
  if (existsSync(path) && statSync(path).isDirectory()) return join(path, 'snapshot.json');
  return path;
}

/** Every file under a directory, in a stable order, as paths relative to it. */
function listFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    if (statSync(join(dir, name)).isDirectory()) out.push(...listFiles(join(dir, name), rel));
    else out.push(rel);
  }
  return out;
}

/** Copy a whole directory tree into the output, file by file. */
function copyTree(from: string, to: string): void {
  for (const rel of listFiles(from)) {
    const target = join(to, rel);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(from, rel), target);
  }
}

function main(): void {
  const snapshot = parseSnapshot(readFileSync(snapshotFile(inputPath(process.argv.slice(2))), 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) throw new Error(`board refused: ${issue}`);

  const out = process.env.MAKEFUN_OUTPUT_DIR ?? 'output';
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board }, null, 1)}\n`);
  writeFileSync(join(out, 'data.js'), dataScript(radar));
  copyTree(join(ROOT, 'dashboard'), join(out, 'dashboard'));
  copyTree(join(ROOT, 'screenshots'), join(out, 'screenshots'));
  writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 65536 }));

  console.log(
    `radar ${radar.model_version}: scanned ${radar.scanned_size} protocols, board ${radar.board_size} rows ` +
      `(watchlist ${radar.watchlist_size}/${radar.watchlist_size}), live ${radar.live_size}, set aside ${radar.aside_size}; ` +
      `top: ${board[0]!.slug} at $${board[0]!.implied_value_usd.toLocaleString('en-US')}`,
  );
}

main();
