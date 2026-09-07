/**
 * Public, server-rendered preview pages.
 *
 * These are the growth loop. An invite link lands here, in any browser, with no
 * Nimiq Pay install and no wallet. The favour itself does the persuading; only
 * accepting it requires the app. They render without JavaScript and carry
 * OpenGraph tags so the link unfurls in whatever messenger it was pasted into.
 */

import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { formatMoney } from '../shared/money.js';
import { Repo, type Env } from './api-types.js';

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
    <footer>Favour &middot; a Nimiq Pay Mini App</footer>
  </div>
</body>
</html>`;
}

/**
 * A dead link deserves an explanation, not the app shell.
 *
 * These pages are shared into messengers and live for a long time; a favour gets
 * cancelled, a circle gets deleted, someone mistypes a code. Returning the SPA
 * with a 200 makes that look like the app is broken, and hides the 404 from
 * anything checking links.
 */
function missing(message: string): Response {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found | Favour</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; padding:24px; text-align:center; }
  .w { max-width:340px; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { opacity:.7; margin:0 0 20px; }
  a { display:inline-block; padding:12px 20px; border-radius:11px; background:#00b78a;
      color:#fff; text-decoration:none; font-weight:650; }
</style></head><body><div class="w">
<h1>${message}</h1>
<p>The link may have expired, or the favour may have been cancelled.</p>
<a href="/">Open Favour</a>
</div></body></html>`;
  return new Response(body, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=UTF-8' },
  });
}

export function createPages() {
  const pages = new Hono<{ Bindings: Env }>();

  /**
   * Deeplink that opens this mini app inside Nimiq Pay.
   *
   * Prefers the configured APP_URL, but ignores it when it points at localhost
   * and the request arrived on a real host. That is what makes a tunnel work
   * with no config change: a localhost APP_URL otherwise produces a deeplink
   * that is syntactically valid and completely useless on a phone.
   */
  const deeplinkFor = (configured: string | undefined, requestUrl: string, path: string) => {
    const isLocal = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(u);
    const appUrl =
      configured && !isLocal(configured) ? configured : new URL(requestUrl).origin;
    const host = appUrl.replace(/^https?:\/\//, '');
    return `https://nimpay.app/miniapps/open/${host}${path}`;
  };

  pages.get('/t/:id', async (c) => {
    const repo = new Repo(c.env.DB);
    const task = await repo.taskById(c.req.param('id'));
    if (!task) return missing('This favour does not exist');

    const poster = await repo.userById(task.posterId);
    const posterName = poster ? poster.displayName : 'Someone';
    const reward = formatMoney(task.reward);
    const status = STATUS_LABEL[task.status] ?? task.status;
    const deeplink = deeplinkFor(c.env.APP_URL, c.req.url, `/#/task/${task.id}`);
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
                   <span class="alt"><a href="https://youtube.com/shorts/5uc5DPpibqE" target="_blank" rel="noopener">Watch how it works (30 seconds)</a></span>
                   <span class="alt"><a href="/help/cash-out">New to crypto? What this pays you in</a></span>`
            : html`<span class="alt">This favour is no longer open.</span>`}
        `,
      }),
    );
  });

  pages.get('/join/:code', async (c) => {
    const code = c.req.param('code');
    const circle = await new Repo(c.env.DB).circleByCode(code);
    if (!circle) return missing('This invite is not valid');

    const deeplink = deeplinkFor(c.env.APP_URL, c.req.url, `/#/join/${circle.inviteCode}`);
    return c.html(
      shell({
        title: `Join ${circle.name} on Favour`,
        description: `A ${circle.kind} circle. Post favours, get them done, pay instantly.`,
        deeplink,
        body: html`
          <span class="pill">${circle.kind} circle</span>
          <h1>${circle.name}</h1>
          <p class="muted">You have been invited to join this circle.</p>
          <p class="detail">Members post favours with a reward attached. Do one, get
approved, get paid straight to your wallet.</p>
          <hr>
          <a class="cta" href="${deeplink}">Open in Nimiq Pay</a>
          <span class="alt"><a href="https://youtube.com/shorts/5uc5DPpibqE" target="_blank" rel="noopener">Watch how it works (30 seconds)</a></span>
          <span class="alt">Invite code: <strong>${circle.inviteCode}</strong></span>
        `,
      }),
    );
  });

  /**
   * Launcher, for opening this app inside Nimiq Pay during development.
   *
   * The documented HTTPS deeplink (nimpay.app/miniapps/open/...) is an iOS
   * universal link, and universal links are sticky: once opened in Safari, iOS
   * remembers that choice and stops handing it to the app, so it falls through
   * to the web page and on to the App Store. Nothing about the app is wrong
   * when that happens, and it cannot be reset from here.
   *
   * The custom scheme has no such behaviour, so it is offered first.
   */
  pages.get('/open', (c) => {
    const host = new URL(c.req.url).host;

    // On a phone with Nimiq Pay installed this opens the app directly. On one
    // without it, iOS falls back to the web page and on to the App Store —
    // which is correct behaviour, not a broken link, and is exactly what an
    // invited person without the app will experience.
    const universal = 'https://nimpay.app/miniapps/open/' + host;
    const scheme = 'nimiqpay://miniapp?url=' + host;

    return c.html([
      '<!doctype html><html lang="en"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
      '<title>Open in Nimiq Pay</title>',
      '<style>',
      ':root{color-scheme:light dark}',
      'body{margin:0;padding:24px 16px;font:16px/1.55 -apple-system,system-ui,sans-serif}',
      '.w{max-width:420px;margin:0 auto}',
      'h1{font-size:20px;margin:0 0 4px}',
      'p{opacity:.7;margin:0 0 18px;font-size:14px}',
      'a{display:block;padding:15px;margin:10px 0;border-radius:12px;text-align:center;',
      'text-decoration:none;font-weight:650}',
      '.primary{background:#00b78a;color:#fff}',
      '.ghost{border:1px solid rgba(128,128,128,.45);color:inherit}',
      'code{font-size:12px;word-break:break-all;opacity:.55;display:block;margin-top:18px}',
      '</style></head><body><div class="w">',
      '<h1>Open Favour in Nimiq Pay</h1>',
      '<p>Needs Nimiq Pay installed on this device. Without it you will be sent to the App Store, which is the intended fallback rather than an error.</p>',
      '<p>If the first button does nothing, try the second. They use two different ways of handing the link to the app, and phones vary in which one they honour.</p>',
      '<a class="primary" href="' + universal + '">Open in Nimiq Pay</a>',
      '<a class="ghost" href="' + scheme + '">Try another way to open it</a>',
      '<a class="ghost" href="/diag">Open diagnostics here instead (no wallet)</a>',
      '<code>' + host + '</code>',
      '</div></body></html>',
    ].join(''));
  });  /**
   * Plain-language explainer for people who have never held crypto.
   *
   * Written to be honest rather than encouraging. Nimiq Pay is a payment app
   * with no built-in off-ramp, and Nimiq's own OASIS covers NIM and BTC in
   * Europe — neither cashes out USDT for most people. Someone deciding whether
   * to take a favour paid in crypto deserves to know that before they accept,
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
<title>Getting paid in crypto | Favour</title>
<meta property="og:title" content="Getting paid in crypto: what you can actually do with it">
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
you</strong>, and neither can Favour. To convert, you use a separate
service, usually a crypto exchange, which typically means:</p>
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
equivalent of a few dollars doing favours, fees and minimums can eat most of it.
Spending it or letting it build up first usually makes more sense.</p>
</div>

<h2>What is available depends on where you live</h2>
<p>Which services work, what they charge, and what is legally permitted vary a
lot by country. We deliberately do not recommend a particular service here,
because we cannot know what is available or appropriate where you are.</p>
<p>Nimiq runs its own service called <strong>OASIS</strong> for swapping directly with a bank
account. Two limits worth knowing: it covers <strong>NIM and BTC, not USDT</strong>, and it
needs a euro bank account supporting SEPA Instant, so it is Europe-focused.</p>

<h2>Before you accept a favour</h2>
<p>If being able to convert to cash easily matters to you, check what is available
in your country <em>first</em>. Agreeing to do something for crypto you cannot
readily spend or convert is a bad trade, however good the rate looks.</p>

<footer>
<p>General information only, not financial advice. Favour never holds,
converts or has access to your money. Payments go straight between wallets.</p>
<p><a href="/">Back to Favour</a></p>
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
<title>Favour diagnostics</title>
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
  #context { padding:14px; border-radius:10px; margin:12px 0 4px; font-weight:700; }
  #context.good { background:#0a7; color:#fff; }
  #context.bad { background:#c33; color:#fff; }
  #context small { display:block; font-weight:400; opacity:.9; margin-top:4px; }
</style></head><body>
<h1>Favour diagnostics</h1>
<div id="context"></div>
<p style="opacity:.7;margin:0">Open this inside Nimiq Pay, tap every button, then Copy results.</p>

<h2>Passive checks</h2><div id="passive"></div>
<h2>Active checks: tap each</h2>
<button id="b-share">Test navigator.share</button>
<button id="b-clip">Test clipboard write</button>
<a class="btn" id="b-sms" href="sms:&amp;body=Favour%20Circle%20test">Test sms: with &amp; (iOS form)</a>
<a class="btn" id="b-sms2" href="sms:?body=Favour%20Circle%20test">Test sms: with ? (Android form)</a>
<a class="btn" href="https://nimiq.com" target="_blank" rel="noopener">Test external link</a>
<button id="b-fetch">Test price API (drives currency conversion)</button>
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

// A WKWebView omits "Version/" and "Safari/" from its user agent; mobile
// Safari includes both. Combined with whether a wallet was injected, that is
// enough to tell someone plainly whether they are in the right place. Running
// this in Safari looks identical to a broken wallet otherwise.
(function(){
  var box = document.getElementById('context');
  var ua = navigator.userAgent;
  var looksLikeSafari = ua.indexOf('Version/') >= 0 && ua.indexOf('Safari/') >= 0;
  var hasWallet = !!(window.nimiq || window.ethereum);
  if (hasWallet) {
    box.className = 'good';
    box.innerHTML = 'Running inside Nimiq Pay. Wallet detected.' +
      '<small>This is the run that matters. Tap every button below.</small>';
  } else if (looksLikeSafari) {
    box.className = 'bad';
    box.innerHTML = 'This is Safari, not Nimiq Pay.' +
      '<small>No wallet here, so the wallet tests cannot answer anything. ' +
      'Open Favour inside Nimiq Pay and tap "Run capability diagnostics".</small>';
  } else {
    box.className = 'bad';
    box.innerHTML = 'No wallet detected.' +
      '<small>Either this is not Nimiq Pay, or it injected nothing. ' +
      'The user agent below will tell us which.</small>';
  }
})();

var p = document.getElementById('passive');
results.userAgent = navigator.userAgent;
results.platform = navigator.platform || null;
results.viewport = innerWidth + 'x' + innerHeight;
results.origin = location.origin;
results.secureContext = isSecureContext;
results.nimiq = { present: !!window.nimiq, methods: methodsOf(window.nimiq) };
results.ethereum = { present: !!window.ethereum, methods: methodsOf(window.ethereum) };
results.hasShare = typeof navigator.share === 'function';
results.vendor = navigator.vendor || null;
results.maxTouchPoints = navigator.maxTouchPoints;
// The app picks the sms: separator from these. iOS needs "&", Android "?", and
// a WebView with a custom UA silently gets it wrong.
results.appleDetected = navigator.vendor === 'Apple Computer, Inc.'
  || /iPad|iPhone|iPod/.test(navigator.userAgent)
  || /iPad|iPhone|iPod/.test(navigator.platform || '')
  || ((navigator.platform || '') === 'MacIntel' && navigator.maxTouchPoints > 1);
results.smsHrefAppWouldUse = 'sms:' + (results.appleDetected ? '&' : '?') + 'body=test';
results.hasClipboard = !!(navigator.clipboard && navigator.clipboard.writeText);
try { localStorage.setItem('_d','1'); localStorage.removeItem('_d'); results.localStorage = true; }
catch(e){ results.localStorage = false; }

row(p,'secure context', results.secureContext);
row(p,'window.nimiq', results.nimiq.present);
row(p,'window.ethereum', results.ethereum.present);
row(p,'navigator.share exists', results.hasShare);
row(p,'detected as Apple WebKit', results.appleDetected);
row(p,'sms separator the app uses', results.appleDetected ? '&  (iOS)' : '?  (Android)');
row(p,'clipboard.writeText exists', results.hasClipboard);
try { results.locale = navigator.language; results.region = new Intl.Locale(navigator.language).region || null; } catch(e) { results.region = 'ERR'; }
row(p,'localStorage', results.localStorage);
row(p,'locale / region', (results.locale||'?') + ' / ' + (results.region||'none'));
row(p,'viewport', results.viewport);
draw();

document.getElementById('b-share').onclick = function(){
  if(!navigator.share) return set('shareResult','absent');
  navigator.share({title:'Favour',text:'test',url:location.origin})
    .then(function(){ set('shareResult','worked'); })
    .catch(function(e){ set('shareResult', e.name + ': ' + e.message); });
};
document.getElementById('b-clip').onclick = function(){
  if(!(navigator.clipboard&&navigator.clipboard.writeText)) return set('clipboardResult','absent');
  navigator.clipboard.writeText('favour-circle-test')
    .then(function(){ set('clipboardResult','worked'); })
    .catch(function(e){ set('clipboardResult', e.name + ': ' + e.message); });
};
document.getElementById('b-sms').addEventListener('click', function(){ set('smsAmpersandTapped','tapped. Did the composer open?'); });
document.getElementById('b-sms2').addEventListener('click', function(){ set('smsQuestionTapped','tapped. Did the composer open?'); });
document.getElementById('b-fetch').onclick = function(){
  // Exactly the URL the app builds, so a pass here means conversion will work.
  var u = 'https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2,tether'
        + '&vs_currencies=usd,eur,gbp,php,aud,cad,inr,brl,ngn';
  var t0 = Date.now();
  fetch(u)
    .then(function(r){ return r.text().then(function(b){ return { status: r.status, body: b.slice(0,200) }; }); })
    .then(function(j){ set('priceApi', { ms: Date.now()-t0, status: j.status, body: j.body }); })
    .catch(function(e){ set('priceApi', 'BLOCKED: ' + e.name + ': ' + e.message); });
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
  var msg = 'favour-circle diagnostic ' + Date.now();
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
