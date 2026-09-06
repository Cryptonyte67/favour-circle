/**
 * One-off rename helper: Chore Circle -> Favour Circle.
 *
 * Kept in the repo rather than run ad hoc so the substitution is reviewable and
 * repeatable. Order matters — the longest, most specific patterns run first so
 * a later rule cannot re-match text an earlier one already rewrote.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SKIP = new Set(['node_modules', '.git', 'dist', '.wrangler', 'data']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|css|html|md|json|toml|sql|sh|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const rules = [
  [/Chore Circle/g, 'Favour Circle'],
  [/chore-circle/g, 'favour-circle'],
  [/chore_circle/g, 'favour_circle'],
  [/Chores/g, 'Favours'],
  [/chores/g, 'favours'],
  // Word-bounded: 'chore' is a substring of 'anchored', which an unbounded
  // rule silently turned into 'anfavourd' in three files.
  [/\bChore\b/g, 'Favour'],
  [/\bchore\b/g, 'favour'],
];

let changed = 0;
for (const file of walk('.')) {
  if (file.includes('rename.mjs')) continue;
  const before = readFileSync(file, 'utf8');
  let after = before;
  for (const [from, to] of rules) after = after.replace(from, to);
  if (after !== before) {
    writeFileSync(file, after);
    changed++;
    console.log('  ' + file.split('\\').join('/'));
  }
}
console.log('\nfiles changed: ' + changed);
