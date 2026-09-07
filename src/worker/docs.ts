/**
 * Static documents: how to use the app, and the terms.
 *
 * Server-rendered and dependency-free, like the other public pages, so they
 * work with no JavaScript, no wallet and no app install. Someone deciding
 * whether to trust this thing should be able to read the terms before they
 * install anything.
 */

import { Hono } from 'hono';
import type { Env } from './api.js';

const STYLE = `
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --ink:#14161a;
          --muted:#5b6270; --line:#e3e6ec; --accent:#00b78a;
          --family:#00b78a; --friends:#d98324; --community:#5b5bd6; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1114; --card:#171a1f; --ink:#eceef2; --muted:#9aa3b2; --line:#272b33;
            --family:#2ad4a8; --friends:#f0a955; --community:#8b8bf0; }
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); padding:24px 16px 56px;
         font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:520px; margin:0 auto; }
  h1 { font-size:24px; line-height:1.25; margin:0 0 6px; }
  h2 { font-size:17px; margin:30px 0 6px; }
  h3 { font-size:15px; margin:20px 0 4px; }
  p, li { margin:8px 0; }
  ol, ul { padding-left:22px; }
  .lede { color:var(--muted); margin:0 0 4px; }
  .updated { color:var(--muted); font-size:13px; margin:0 0 8px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px;
          padding:16px; margin:16px 0; }
  .card.family { border-left:3px solid var(--family); }
  .card.friends { border-left:3px solid var(--friends); }
  .card.community { border-left:3px solid var(--community); }
  .flag { border-left:3px solid #d2384a; padding-left:12px; margin:16px 0; }
  .steps { counter-reset:step; list-style:none; padding-left:0; }
  .steps li { counter-increment:step; position:relative; padding-left:40px; margin:12px 0; }
  .steps li::before {
    content:counter(step); position:absolute; left:0; top:1px;
    width:26px; height:26px; border-radius:50%; background:var(--accent); color:#fff;
    font-size:14px; font-weight:700; display:flex; align-items:center; justify-content:center;
  }
  nav.docs { margin:26px 0 0; padding-top:16px; border-top:1px solid var(--line);
             font-size:14px; color:var(--muted); }
  nav.docs a { color:inherit; }
  a { color:inherit; }
  .watch {
    display:inline-block; margin:6px 0 0; padding:11px 18px;
    border:1px solid var(--line); border-radius:999px;
    text-decoration:none; font-size:15px; font-weight:600; color:var(--ink);
  }
`;

function page(title: string, description: string, body: string): string {
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<title>' + title + ' | Favour</title>',
    '<meta name="description" content="' + description + '">',
    '<meta property="og:title" content="' + title + ' | Favour">',
    '<meta property="og:description" content="' + description + '">',
    '<style>' + STYLE + '</style></head><body><div class="wrap">',
    body,
    '<nav class="docs">',
    '<a href="/">Open Favour</a> &middot; ',
    '<a href="/help">How it works</a> &middot; ',
    '<a href="https://youtube.com/shorts/5uc5DPpibqE" target="_blank" rel="noopener">Video</a> &middot; ',
    '<a href="/help/cash-out">New to crypto?</a> &middot; ',
    '<a href="/terms">Terms</a>',
    '</nav>',
    '</div></body></html>',
  ].join('');
}

const HOW_IT_WORKS = `
<h1>How Favour works</h1>
<p class="lede">Three screens. Here is what each one does.</p>

<p><a class="watch" href="https://youtube.com/shorts/5uc5DPpibqE" target="_blank" rel="noopener">Watch the 30 second demo</a></p>

<p>The whole app is one loop: someone posts a favour, someone else does it, the
person who posted it approves, and the money moves. Nothing happens until the
person who asked says they are happy.</p>

<h2>Before anything else</h2>
<ol class="steps">
  <li><strong>Add your name.</strong> It is what other people see next to a favour.</li>
  <li><strong>Connect your wallet.</strong> You can post and approve favours without one,
      but nobody can pay you until it is set. The app will keep reminding you.</li>
  <li><strong>Create a circle, or join one with a code.</strong> You cannot post a
      favour until you are in at least one.</li>
</ol>

<h2>Circles</h2>
<p>A circle is a group of people you already know. Favours are only ever visible
to the circles you post them to.</p>

<div class="card family"><strong>Family</strong><br>The household. Chores, the school run, the bins.</div>
<div class="card friends"><strong>Friends</strong><br>The five-a-side team, the group chat, people you see often.</div>
<div class="card community"><strong>Community</strong><br>The street, the block, the neighbours.</div>

<p>Community circles are join-by-code, not a public board. That is deliberate:
everyone in a circle can see and claim its favours, so you should know who is in
it.</p>

<ol class="steps">
  <li><strong>Create a circle</strong> and give it a name.</li>
  <li><strong>Invite someone</strong> by QR code, or copy the message and send it
      however you like. The app never reads your contacts.</li>
  <li>They open the link and join. <strong>Join with a code</strong> works too if
      someone reads you a six-character code.</li>
</ol>

<h2>Favours</h2>
<p>Everything posted to your circles, newest first. The colour down the left of
each card tells you which circle it came from. The chips at the top filter by
circle type.</p>

<h3>Posting one</h3>
<ol class="steps">
  <li>Tap the <strong>+</strong> button.</li>
  <li>Say what needs doing, and add any detail that saves a question later.</li>
  <li><strong>Set a reward.</strong> Price it in NIM, in USDT, or in your own
      currency. If you pick your currency, it is posted in USDT so the value
      stays roughly what you meant.</li>
  <li>Choose which circles it goes to. It can go to more than one.</li>
  <li>Post it, then share it if you want to nudge someone directly.</li>
</ol>

<h3>Doing one</h3>
<ol class="steps">
  <li>Tap <strong>I'll do it</strong> on a favour that is up for grabs. It is
      then yours, and nobody else can claim it.</li>
  <li>Do the thing.</li>
  <li>Tap <strong>Mark done</strong>. That tells the person who posted it.</li>
</ol>

<h3>Approving one</h3>
<p>When someone marks a favour done, you get an <strong>Approve</strong> button.
Approving does not pay them yet. It moves the favour into Owed.</p>

<h2>Owed</h2>
<p>Everything you have approved and not yet paid for.</p>
<p>Favours are grouped by person, so several favours for the same person become
a single payment. Ten favours settle as one transaction and one confirmation,
instead of ten of each.</p>
<ol class="steps">
  <li>Check the amount. It shows the crypto figure and roughly what that is in
      your own currency.</li>
  <li>Tap <strong>Settle up</strong>.</li>
  <li>Confirm in Nimiq Pay. The money goes straight to their wallet.</li>
</ol>
<p>If someone has not added a wallet address yet, their card will say so and there
will be no button. Ask them to open Favour and connect a wallet.</p>

<h2>Sharing a favour with someone outside the app</h2>
<p>Every favour has its own web page. Anyone can open it in a browser and see
what is being asked and what it pays, with no app and no wallet. They only need
Nimiq Pay if they want to take it on.</p>
`;

const TERMS = `
<h1>Terms of use</h1>
<p class="updated">Last updated 7 September 2026</p>
<p class="lede">Plain English. Please read it, it is short.</p>

<h2>What Favour is</h2>
<p>Favour lets people who already know each other post small paid jobs, agree
they are done, and pay each other. It runs as a mini app inside Nimiq Pay.</p>
<p>It is early software, built for the Nimiq Mini Apps Competition. The source
code is public and MIT licensed.</p>

<h2>What Favour is not</h2>
<div class="flag">
<p><strong>Favour never holds, moves, or has access to your money.</strong>
Payments go directly from one wallet to another through Nimiq Pay. We are not a
bank, a payment service, a money transmitter, an escrow, or an employer.</p>
</div>
<p>Because we never touch the money, we cannot reverse a payment, recover a
wallet, refund anything, or step in if a payment goes to the wrong place. Once a
transaction is confirmed it is final.</p>

<h2>Who can use it</h2>
<p>You must be 18 or over. Nimiq Pay is a self-custodial wallet and is not
intended for children. Do not set it up on a child's behalf.</p>

<h2>Favours are between you and the other person</h2>
<p>We do not check that a favour is done, done well, or done safely. We do not
vet the people in your circles. Approving a favour is your judgement, and paying
for it is your decision.</p>
<p>If something goes wrong, it is between the two of you. We have no way to
arbitrate and no money to hold back while you work it out.</p>

<h2>Use it sensibly</h2>
<ul>
  <li>Only add people you actually know to your circles.</li>
  <li>Do not post anything illegal, unsafe, or that needs a licence or
      insurance to do properly.</li>
  <li>Do not use it to employ anyone. Regular paid work creates obligations
      around employment status, minimum wage and insurance that this app does
      not handle.</li>
  <li>Think about who you are asking and what you are asking them to do,
      especially where young people are involved.</li>
</ul>

<h2>Tax is yours to sort out</h2>
<p>Money earned through favours may be taxable where you live. We do not report
anything to anyone, and we do not give tax advice. Keep your own records if the
amounts matter.</p>

<h2>What we store</h2>
<p>Only what the app needs to work:</p>
<ul>
  <li>The name you type in, and the wallet addresses you connect.</li>
  <li>The circles you are in and who else is in them.</li>
  <li>The favours you post, claim, approve and settle, with their amounts.</li>
  <li>Transaction hashes for settled favours, which are public on the blockchain
      anyway.</li>
</ul>
<p>We do not read your contacts. We do not track you across other sites. There
are no advertising trackers in the app.</p>
<p>Currency conversion figures are fetched from a public price API at the moment
they are shown. They are indicative only and are never stored.</p>
<p>Anyone in a circle with you can see your name, and the favours in that
circle. A favour's public page is visible to anyone with the link.</p>

<h2>No warranty</h2>
<p>Favour is provided as it is, with no guarantee that it will work, stay
available, or keep your data. It is early software and may contain bugs. Do not
rely on it for anything that matters. To the extent the law allows, we are not
liable for any loss arising from using it.</p>

<h2>Changes</h2>
<p>These terms may change as the app does. The date at the top says when they
last did.</p>

<h2>Getting in touch</h2>
<p>Issues and questions are best raised on the public repository:
<a href="https://github.com/Cryptonyte67/favour-circle">github.com/Cryptonyte67/favour-circle</a>.</p>
`;

export function createDocs() {
  const docs = new Hono<{ Bindings: Env }>();

  docs.get('/help', (c) =>
    c.html(page('How it works', 'A short guide to posting, doing and paying for favours.', HOW_IT_WORKS)),
  );

  docs.get('/terms', (c) =>
    c.html(page('Terms of use', 'What Favour is, what it is not, and what it stores.', TERMS)),
  );

  return docs;
}
