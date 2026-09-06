/**
 * Shorten the displayed product name to "Favour", and colour the tabs.
 *
 * The repo, Worker and URL stay favour-circle — those are technical handles and
 * churning them again costs more than it gains. This only changes what a person
 * reads on screen.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const edits = [
  // --- main.ts: headings and the payment memo -------------------------------
  ["src/web/main.ts", "el('h1', {}, 'Favour Circle'),", "el('h1', {}, 'Favour'),"],
  [
    "src/web/main.ts",
    "el('div', { class: 'brand' }, logoElement(24), el('h1', {}, 'Favour Circle')),",
    "el('div', { class: 'brand' }, logoElement(24), el('h1', {}, 'Favour')),",
  ],
  [
    "src/web/main.ts",
    "' has not added a wallet address yet, so this cannot be paid. Ask them to open Favour Circle and connect a wallet.'",
    "' has not added a wallet address yet, so this cannot be paid. Ask them to open Favour and connect a wallet.'",
  ],
  ["src/web/main.ts", "memo: 'Favour Circle: '", "memo: 'Favour: '"],

  // --- index.html ----------------------------------------------------------
  ["src/web/index.html", "<title>Favour Circle</title>", "<title>Favour</title>"],

  // --- server-rendered pages ----------------------------------------------
  [
    "src/worker/pages.ts",
    "<footer>Favour Circle &middot; a Nimiq Pay Mini App</footer>",
    "<footer>Favour &middot; a Nimiq Pay Mini App</footer>",
  ],
  ["src/worker/pages.ts", "<title>Not found — Favour Circle</title>", "<title>Not found — Favour</title>"],
  ["src/worker/pages.ts", '<a href="/">Open Favour Circle</a>', '<a href="/">Open Favour</a>'],
  ["src/worker/pages.ts", "title: `Join ${circle.name} on Favour Circle`", "title: `Join ${circle.name} on Favour`"],
  [
    "src/worker/pages.ts",
    "'<h1>Open Favour Circle in Nimiq Pay</h1>',",
    "'<h1>Open Favour in Nimiq Pay</h1>',",
  ],
  ["src/worker/pages.ts", "<title>Getting paid in crypto — Favour Circle</title>", "<title>Getting paid in crypto — Favour</title>"],
  ["src/worker/pages.ts", "you</strong>, and neither can Favour Circle.", "you</strong>, and neither can Favour."],
  ["src/worker/pages.ts", "<title>Favour Circle diagnostics</title>", "<title>Favour diagnostics</title>"],
  ["src/worker/pages.ts", "<h1>Favour Circle diagnostics</h1>", "<h1>Favour diagnostics</h1>"],
  ["src/worker/pages.ts", "Open Favour Circle inside Nimiq Pay", "Open Favour inside Nimiq Pay"],
  ["src/worker/pages.ts", "'Favour Circle', text:", "'Favour', text:"],

  // --- diagnostics probe ---------------------------------------------------
  ["src/web/diagnostics.ts", "title: 'Favour Circle', text: 'test'", "title: 'Favour', text: 'test'"],

  // --- tabs carry the logo's three colours ---------------------------------
  [
    "src/web/main.ts",
    "    const tab = el('button', { class: 'tab' + (state.tab === id ? ' on' : '') }, label);",
    "    // Each tab takes one of the logo's three arc colours, in the same order.\n" +
      "    // Those hues also identify circle kinds elsewhere; the two never appear\n" +
      "    // side by side, so the tie to the mark is worth the small overlap.\n" +
      "    const tab = el(\n" +
      "      'button',\n" +
      "      { class: 'tab tab-' + id + (state.tab === id ? ' on' : '') },\n" +
      "      label,\n" +
      "    );",
  ],
];

let applied = 0;
const missed = [];
for (const [file, from, to] of edits) {
  const before = readFileSync(file, 'utf8');
  if (!before.includes(from)) {
    missed.push(file + ' :: ' + from.slice(0, 60));
    continue;
  }
  writeFileSync(file, before.split(from).join(to));
  applied++;
}

console.log('applied: ' + applied);
if (missed.length) {
  console.log('MISSED:');
  for (const m of missed) console.log('  ' + m);
}
