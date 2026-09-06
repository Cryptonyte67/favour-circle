/**
 * Remove em dashes from user-facing text.
 *
 * Each one is rewritten rather than swapped for a hyphen, so the sentences read
 * as if they were never punctuated that way: a full stop where the clause could
 * stand alone, a colon where it introduces, commas where it interrupts.
 *
 * Code comments are left alone; this is about what a person reads on screen.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const edits = [
  ['src/web/diagnostics.ts',
    "'Sent — open /diag/results on your computer.'",
    "'Sent. Open /diag/results on your computer.'"],

  ['src/web/main.ts',
    "? 'Wallet detected — this run counts.'",
    "? 'Wallet detected. This run counts.'"],

  ['src/web/main.ts',
    "const message = subject + ' — ' + url;",
    "const message = subject + ': ' + url;"],

  ['src/worker/pages.ts',
    '<title>Not found — Favour</title>',
    '<title>Not found | Favour</title>'],

  ['src/worker/pages.ts',
    "'to the App Store &mdash; that is the intended fallback, not an error.</p>',",
    "'to the App Store. That is the intended fallback, not an error.</p>',"],

  ['src/worker/pages.ts',
    '<title>Getting paid in crypto — Favour</title>',
    '<title>Getting paid in crypto | Favour</title>'],

  ['src/worker/pages.ts',
    'content="Getting paid in crypto — what you can actually do with it"',
    'content="Getting paid in crypto: what you can actually do with it"'],

  ['src/worker/pages.ts',
    'service — usually a crypto exchange — which typically means:</p>',
    'service, usually a crypto exchange, which typically means:</p>'],

  ['src/worker/pages.ts',
    'lot by country. We deliberately do not recommend a particular service here —\nwe cannot know what is available or appropriate where you are.</p>',
    'lot by country. We deliberately do not recommend a particular service here,\nbecause we cannot know what is available or appropriate where you are.</p>'],

  ['src/worker/pages.ts',
    'converts or has access to your money — payments go straight between wallets.</p>',
    'converts or has access to your money. Payments go straight between wallets.</p>'],

  ['src/worker/pages.ts',
    '<h2>Active checks — tap each</h2>',
    '<h2>Active checks: tap each</h2>'],

  ['src/worker/pages.ts',
    "'Running inside Nimiq Pay &mdash; wallet detected.' +",
    "'Running inside Nimiq Pay. Wallet detected.' +"],

  ['src/worker/pages.ts',
    "set('smsAmpersandTapped','tapped — did the composer open?')",
    "set('smsAmpersandTapped','tapped. Did the composer open?')"],

  ['src/worker/pages.ts',
    "set('smsQuestionTapped','tapped — did the composer open?')",
    "set('smsQuestionTapped','tapped. Did the composer open?')"],
];

let applied = 0;
const missed = [];
for (const [file, from, to] of edits) {
  const before = readFileSync(file, 'utf8');
  if (!before.includes(from)) {
    missed.push(file + ' :: ' + from.slice(0, 60).replace(/\n/g, '\\n'));
    continue;
  }
  writeFileSync(file, before.split(from).join(to));
  applied++;
}

console.log('rewritten: ' + applied);
if (missed.length) {
  console.log('MISSED:');
  for (const m of missed) console.log('  ' + m);
}
