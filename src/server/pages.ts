/**
 * Public, server-rendered preview pages.
 *
 * These are the growth loop. An invite link lands here, in any browser, with no
 * Nimiq Pay install and no wallet. The chore itself does the persuading; only
 * accepting it requires the app. They render without JavaScript and carry
 * OpenGraph tags so the link unfurls in whatever messenger it was pasted into.
 */

import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { projectTask } from '../shared/events.js';
import { formatMoney } from '../shared/money.js';
import { circleByCode, eventsForTask, userById, type Store } from './store.js';

const STATUS_LABEL: Record<string, string> = {
  open: 'Up for grabs',
  claimed: 'Someone is on it',
  submitted: 'Waiting to be approved',
  approved: 'Approved, awaiting payment',
  settled: 'Done and paid',
  cancelled: 'Cancelled',
};

function shell(opts: {
  title: string;
  description: string;
  body: HtmlEscapedString | Promise<HtmlEscapedString>;
  deeplink: string;
}) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title}</title>
<meta property="og:title" content="${opts.title}">
<meta property="og:description" content="${opts.description}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --ink:#14161a;
          --muted:#5b6270; --line:#e3e6ec; --accent:#0b7; --accent-ink:#fff; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1114; --card:#171a1f; --ink:#eceef2; --muted:#9aa3b2; --line:#272b33; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
         display:flex; justify-content:center; padding:24px 16px; }
  .wrap { width:100%; max-width:420px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:20px; }
  h1 { font-size:22px; margin:0 0 4px; line-height:1.25; }
  .reward { font-size:32px; font-weight:650; margin:12px 0 4px; }
  .muted { color:var(--muted); font-size:14px; margin:0; }
  .pill { display:inline-block; font-size:12px; font-weight:600; padding:4px 10px;
          border-radius:999px; background:var(--line); color:var(--muted); }
  .detail { margin:14px 0 0; white-space:pre-wrap; }
  .cta { display:block; text-align:center; text-decoration:none; margin-top:18px; padding:14px;
         border-radius:12px; background:var(--accent); color:var(--accent-ink); font-weight:650; }
  .alt { display:block; text-align:center; margin-top:10px; font-size:14px; color:var(--muted); }
  hr { border:0; border-top:1px solid var(--line); margin:18px 0; }
  footer { text-align:center; margin-top:18px; font-size:13px; color:var(--muted); }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">${opts.body}</div>
    <footer>Chore Circle &middot; a Nimiq Pay Mini App</footer>
  </div>
</body>
</html>`;
}

export function createPages(store: Store, appUrl: string) {
  const pages = new Hono();

  /** Deeplink that opens this mini app inside Nimiq Pay. */
  const deeplinkFor = (path: string) => {
    const host = appUrl.replace(/^https?:\/\//, '');
    return `https://nimpay.app/miniapps/open/${host}${path}`;
  };

  pages.get('/t/:id', (c) => {
    const db = store.read();
    const task = projectTask(eventsForTask(db, c.req.param('id')));
    if (!task) return c.notFound();

    const poster = userById(db, task.posterId);
    const posterName = poster ? poster.displayName : 'Someone';
    const reward = formatMoney(task.reward);
    const status = STATUS_LABEL[task.status] ?? task.status;
    const deeplink = deeplinkFor(`/#/task/${task.id}`);
    const open = task.status === 'open';

    return c.html(
      shell({
        title: `${posterName} needs: ${task.title}`,
        description: `${reward} &middot; ${status}`,
        deeplink,
        body: html`
          <span class="pill">${status}</span>
          <h1>${task.title}</h1>
          <p class="muted">Posted by ${posterName}</p>
          <div class="reward">${reward}</div>
          ${task.detail ? html`<p class="detail">${task.detail}</p>` : raw('')}
          <hr>
          ${open
            ? html`<a class="cta" href="${deeplink}">Open in Nimiq Pay to accept</a>
                   <span class="alt">You will need Nimiq Pay and a wallet to get paid.</span>
                   <span class="alt"><a href="/help/cash-out">New to crypto? What this pays you in</a></span>`
            : html`<span class="alt">This chore is no longer open.</span>`}
        `,
      }),
    );
  });

  pages.get('/join/:code', (c) => {
    const code = c.req.param('code');
    const circle = circleByCode(store.read(), code);
    if (!circle) return c.notFound();

    const deeplink = deeplinkFor(`/#/join/${circle.inviteCode}`);
    return c.html(
      shell({
        title: `Join ${circle.name} on Chore Circle`,
        description: `A ${circle.kind} circle. Post chores, get them done, pay instantly.`,
        deeplink,
        body: html`
          <span class="pill">${circle.kind} circle</span>
          <h1>${circle.name}</h1>
          <p class="muted">You have been invited to join this circle.</p>
          <p class="detail">Members post small jobs with a reward attached. Do one, get
approved, get paid straight to your wallet.</p>
          <hr>
          <a class="cta" href="${deeplink}">Open in Nimiq Pay</a>
          <span class="alt">Invite code: <strong>${circle.inviteCode}</strong></span>
        `,
      }),
    );
  });

  /**
   * Plain-language explainer for people who have never held crypto.
   *
   * Written to be honest rather than encouraging. Nimiq Pay is a payment app
   * with no built-in off-ramp, and Nimiq's own OASIS covers NIM and BTC in
   * Europe — neither cashes out USDT for most people. Someone deciding whether
   * to take a chore paid in crypto deserves to know that before they accept,
   * not after.
   *
   * Deliberately names no exchange. Availability, fees and legal status vary by
   * country and change often, and recommending one would be both unreliable and
   * closer to financial advice than this app should get.
   */
  pages.get('/help/cash-out', (c) =>
    c.html(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Getting paid in crypto — Chore Circle</title>
<meta property="og:title" content="Getting paid in crypto — what you can actually do with it">
<meta property="og:description" content="A plain explanation for people who have never held crypto before.">
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --ink:#14161a;
          --muted:#5b6270; --line:#e3e6ec; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1114; --card:#171a1f; --ink:#eceef2; --muted:#9aa3b2; --line:#272b33; }
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); padding:24px 16px 48px;
         font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:460px; margin:0 auto; }
  h1 { font-size:23px; line-height:1.25; margin:0 0 6px; }
  h2 { font-size:17px; margin:28px 0 6px; }
  p { margin:10px 0; }
  .lede { color:var(--muted); margin:0 0 4px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px;
          padding:16px; margin:16px 0; }
  ol, ul { padding-left:20px; margin:10px 0; }
  li { margin:6px 0; }
  .flag { border-left:3px solid #d2384a; padding-left:12px; margin:16px 0; }
  footer { margin-top:32px; padding-top:16px; border-top:1px solid var(--line);
           font-size:13px; color:var(--muted); }
  a { color:inherit; }
</style></head><body><div class="wrap">

<h1>Getting paid in crypto</h1>
<p class="lede">What it is, and what you can actually do with it. No jargon.</p>

<h2>What you are being paid in</h2>
<div class="card">
<p><strong>USDT</strong> is a "stablecoin". It is designed to always be worth about
one US dollar. 10 USDT is roughly 10 dollars' worth, today and next month.</p>
<p><strong>NIM</strong> is Nimiq's own coin. Its value moves up and down, so 100 NIM
may be worth more or less next week than it is today.</p>
</div>

<h2>You have three options</h2>
<p><strong>1. Keep it.</strong> It stays in your Nimiq Pay wallet. You do not have to
do anything with it.</p>
<p><strong>2. Spend it.</strong> Nimiq Pay is built for paying people and merchants who
accept it. This is the simplest option and costs you the least.</p>
<p><strong>3. Convert it to your own currency.</strong> This is the fiddly one, and it is
worth knowing why before you count on it.</p>

<h2>Converting to normal money</h2>
<p>Nimiq Pay is a payments app. <strong>It cannot turn your balance into cash for
you</strong>, and neither can Chore Circle. To convert, you use a separate
service — usually a crypto exchange — which typically means:</p>
<ul>
  <li>Creating an account and <strong>verifying your identity</strong> with a photo ID</li>
  <li>Sending your USDT or NIM from Nimiq Pay to that account</li>
  <li>Selling it for your currency</li>
  <li>Withdrawing to your bank account or mobile wallet</li>
</ul>
<p>Every one of those steps can charge a fee, and there is often a minimum
withdrawal amount.</p>

<div class="flag">
<p><strong>Small amounts often are not worth converting.</strong> If you earned the
equivalent of a few dollars doing chores, fees and minimums can eat most of it.
Spending it or letting it build up first usually makes more sense.</p>
</div>

<h2>What is available depends on where you live</h2>
<p>Which services work, what they charge, and what is legally permitted vary a
lot by country. We deliberately do not recommend a particular service here —
we cannot know what is available or appropriate where you are.</p>
<p>Nimiq runs its own service called <strong>OASIS</strong> for swapping directly with a bank
account. Two limits worth knowing: it covers <strong>NIM and BTC, not USDT</strong>, and it
needs a euro bank account supporting SEPA Instant, so it is Europe-focused.</p>

<h2>Before you accept a chore</h2>
<p>If being able to convert to cash easily matters to you, check what is available
in your country <em>first</em>. Agreeing to do something for crypto you cannot
readily spend or convert is a bad trade, however good the rate looks.</p>

<footer>
<p>General information only, not financial advice. Chore Circle never holds,
converts or has access to your money — payments go straight between wallets.</p>
<p><a href="/">Back to Chore Circle</a></p>
</footer>

</div></body></html>`),
  );

  /**
   * Capability probe, served as plain self-contained HTML.
   *
   * Deliberately independent of the app bundle: if the mini app itself fails to
   * boot inside the WebView, this page still loads and says why. Everything the
   * provider and share layers assume about Nimiq Pay is guesswork until this has
   * been run on a real device, so it reports rather than infers — and the active
   * checks need a tap, because share and clipboard require a user gesture.
   */
  pages.get('/diag', (c) =>
    c.html(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Chore Circle diagnostics</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; padding:16px; font:15px/1.5 -apple-system,system-ui,sans-serif; max-width:520px; }
  h1 { font-size:19px; margin:0 0 12px; }
  h2 { font-size:14px; text-transform:uppercase; letter-spacing:.05em; opacity:.6; margin:22px 0 6px; }
  .row { display:flex; gap:8px; padding:7px 0; border-bottom:1px solid rgba(128,128,128,.25); }
  .k { flex:1; min-width:0; word-break:break-word; }
  .v { font-weight:700; white-space:nowrap; }
  .yes { color:#0a0; } .no { color:#c00; } .idk { opacity:.55; }
  button, a.btn { display:block; width:100%; margin:8px 0 0; padding:13px; font:inherit; font-weight:600;
    border:1px solid rgba(128,128,128,.4); border-radius:10px; background:transparent; color:inherit;
    text-align:center; text-decoration:none; }
  pre { background:rgba(128,128,128,.12); padding:10px; border-radius:8px; overflow-x:auto; font-size:12px; }
</style></head><body>
<h1>Chore Circle diagnostics</h1>
<p style="opacity:.7;margin:0">Open this inside Nimiq Pay, tap every button, then Copy results.</p>

<h2>Passive checks</h2><div id="passive"></div>
<h2>Active checks — tap each</h2>
<button id="b-share">Test navigator.share</button>
<button id="b-clip">Test clipboard write</button>
<a class="btn" id="b-sms" href="sms:&amp;body=Chore%20Circle%20test">Test sms: link</a>
<a class="btn" href="https://nimiq.com" target="_blank" rel="noopener">Test external link</a>
<button id="b-fetch">Test outbound fetch (price API)</button>
<button id="b-accounts">Test wallet getAccounts</button>
<button id="b-sign">Test signMessage</button>
<h2>Results</h2>
<pre id="log">(nothing yet)</pre>
<button id="b-copy">Copy results</button>

<script>
var results = {};
function methodsOf(o){ if(!o) return null; var out=[];
  for(var k in o){ try{ if(typeof o[k]==='function') out.push(k); }catch(e){} }
  try{ var p=Object.getPrototypeOf(o); if(p) Object.getOwnPropertyNames(p).forEach(function(k){
    try{ if(typeof o[k]==='function' && out.indexOf(k)<0) out.push(k); }catch(e){} }); }catch(e){}
  return out.sort(); }
function set(k,v){ results[k]=v; draw(); }
function draw(){ document.getElementById('log').textContent = JSON.stringify(results,null,2); }
function row(host,k,v){ var cls = v===true?'yes':v===false?'no':'idk';
  var t = v===true?'yes':v===false?'no':String(v);
  host.insertAdjacentHTML('beforeend','<div class="row"><span class="k">'+k+'</span><span class="v '+cls+'">'+t+'</span></div>'); }

var p = document.getElementById('passive');
results.userAgent = navigator.userAgent;
results.platform = navigator.platform || null;
results.viewport = innerWidth + 'x' + innerHeight;
results.origin = location.origin;
results.secureContext = isSecureContext;
results.nimiq = { present: !!window.nimiq, methods: methodsOf(window.nimiq) };
results.ethereum = { present: !!window.ethereum, methods: methodsOf(window.ethereum) };
results.hasShare = typeof navigator.share === 'function';
results.hasClipboard = !!(navigator.clipboard && navigator.clipboard.writeText);
try { localStorage.setItem('_d','1'); localStorage.removeItem('_d'); results.localStorage = true; }
catch(e){ results.localStorage = false; }

row(p,'secure context', results.secureContext);
row(p,'window.nimiq', results.nimiq.present);
row(p,'window.ethereum', results.ethereum.present);
row(p,'navigator.share exists', results.hasShare);
row(p,'clipboard.writeText exists', results.hasClipboard);
row(p,'localStorage', results.localStorage);
row(p,'viewport', results.viewport);
draw();

document.getElementById('b-share').onclick = function(){
  if(!navigator.share) return set('shareResult','absent');
  navigator.share({title:'Chore Circle',text:'test',url:location.origin})
    .then(function(){ set('shareResult','worked'); })
    .catch(function(e){ set('shareResult', e.name + ': ' + e.message); });
};
document.getElementById('b-clip').onclick = function(){
  if(!(navigator.clipboard&&navigator.clipboard.writeText)) return set('clipboardResult','absent');
  navigator.clipboard.writeText('chore-circle-test')
    .then(function(){ set('clipboardResult','worked'); })
    .catch(function(e){ set('clipboardResult', e.name + ': ' + e.message); });
};
document.getElementById('b-sms').addEventListener('click', function(){ set('smsTapped','tapped — did the composer open?'); });
document.getElementById('b-fetch').onclick = function(){
  fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd')
    .then(function(r){ return r.json(); })
    .then(function(j){ set('outboundFetch', j); })
    .catch(function(e){ set('outboundFetch', 'BLOCKED: ' + e.message); });
};
document.getElementById('b-accounts').onclick = function(){
  var out = {};
  var jobs = [];
  if(window.nimiq && window.nimiq.requestAccounts){
    jobs.push(Promise.resolve().then(function(){ return window.nimiq.requestAccounts(); })
      .then(function(a){ out.nimiq = a; }).catch(function(e){ out.nimiq = 'ERR ' + e.message; }));
  } else { out.nimiq = 'no requestAccounts'; }
  if(window.ethereum){
    jobs.push(window.ethereum.request({method:'eth_requestAccounts'})
      .then(function(a){ out.ethereum = a; }).catch(function(e){ out.ethereum = 'ERR ' + e.message; }));
  } else { out.ethereum = 'absent'; }
  Promise.all(jobs).then(function(){ set('accounts', out); });
};
document.getElementById('b-sign').onclick = function(){
  var msg = 'chore-circle diagnostic ' + Date.now();
  if(window.nimiq && window.nimiq.signMessage){
    Promise.resolve().then(function(){ return window.nimiq.signMessage(msg); })
      .then(function(s){ set('signature', { via:'nimiq', value: String(s).slice(0,300) }); })
      .catch(function(e){ set('signature','ERR ' + e.message); });
  } else if (window.ethereum) {
    window.ethereum.request({method:'eth_accounts'}).then(function(a){
      return window.ethereum.request({method:'personal_sign', params:[msg, a[0]]});
    }).then(function(s){ set('signature', { via:'ethereum', value: String(s).slice(0,300) }); })
      .catch(function(e){ set('signature','ERR ' + e.message); });
  } else { set('signature','no signing method'); }
};
document.getElementById('b-copy').onclick = function(){
  var text = JSON.stringify(results,null,2);
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){ alert('Copied.'); })
      .catch(function(){ window.prompt('Copy this:', text); });
  } else { window.prompt('Copy this:', text); }
};
</script>
</body></html>`),
  );

  return pages;
}
