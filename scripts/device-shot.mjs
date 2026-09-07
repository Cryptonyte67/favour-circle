/**
 * The app in a phone, showing a real payment.
 *
 * Two passes: capture the app at true device resolution, then composite that
 * into a CSS phone frame. Compositing rather than drawing a fake screen means
 * the picture inside the handset is the actual product, pixel for pixel.
 *
 *   node scripts/device-shot.mjs [baseUrl] [outDir]
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] || 'https://app.favour-circle.workers.dev';
const OUT = process.argv[3] || 'brand';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// iPhone 14 Pro logical size at 3x, so the screen inside the frame is real
// device resolution rather than an upscale.
const SW = 393;
const SH = 852;
const SCALE = 3;

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--hide-scrollbars', '--force-color-profile=srgb'],
});

const page = await browser.newPage();
await page.setViewport({ width: SW, height: SH, deviceScaleFactor: SCALE });
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1200));

/** A five pound favour, done by Joshua, approved and waiting to be paid. */
await page.evaluate(async (base) => {
  const post = (path, body, who) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(who ? { 'x-user-id': who } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => r.json());

  const me = await post('/api/session', {
    displayName: 'Dan',
    address: 'NQ07 4KWM 8XPQ 2H3D 9VBN 6TLR 5CGY 1JFS 7EAD',
  });
  const joshua = await post('/api/session', {
    displayName: 'Joshua',
    address: 'NQ21 9BXT 3RMD 7KLP 2SVN 8QHG 4YFC 6JAW 1DER',
  });
  await fetch(base + '/api/me/addresses', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-user-id': joshua.user.id },
    body: JSON.stringify({
      chain: 'polygon',
      address: '0x7A3fD2Bc91E4a05CbD8e2F1a6B0C4D9e83F2a71B',
    }),
  });

  const street = await post('/api/circles', { name: 'Alder Road', kind: 'community' }, me.user.id);
  await post('/api/circles/join', { code: street.circle.inviteCode }, joshua.user.id);

  // Priced so the fiat line reads as a round five pounds. The rate moves, so
  // the exact USDT figure is derived rather than hardcoded.
  const rates = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=gbp',
  ).then((r) => r.json());
  // Two decimals, so the card reads 6.76 USDT rather than 6.760841. Rounding
  // here moves the fiat by well under a penny, so it still shows five pounds.
  const usdt = (5 / rates.tether.gbp).toFixed(2);

  const task = await post(
    '/api/tasks',
    {
      title: 'Wash the car',
      detail: 'Front drive, bucket is in the garage',
      amount: usdt,
      assetKey: 'USDT@polygon',
      circleIds: [street.circle.id],
    },
    me.user.id,
  );

  const act = (a, who, body) =>
    fetch(base + '/api/tasks/' + task.task.id + '/' + a, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': who },
      body: body ? JSON.stringify(body) : undefined,
    });

  await act('claim', joshua.user.id);
  await act('done', joshua.user.id, { signature: 'mocksig:demo' });
  await act('approve', me.user.id);

  localStorage.setItem('favour-circle:user-id', me.user.id);
  localStorage.setItem('favour-circle:currency', 'GBP');
}, BASE);

await page.reload({ waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1600));
// A desktop browser reports no safe-area inset, so stand one in for the frame.
await page.addStyleTag({ content: '#app { padding-top: 62px; }' });
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.tab')].find((b) => b.textContent.includes('Owed'));
  el?.click();
});
await new Promise((r) => setTimeout(r, 700));

const screenFile = join(OUT, 'screen-payment-joshua.png');
await page.screenshot({ path: screenFile });
console.log('  ' + screenFile);

/* ------------------------------------------------------- the phone frame */

const shotB64 = readFileSync(screenFile).toString('base64');

const framed = (bg, shadow) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1920px; }
  body { background: ${bg}; display: flex; align-items: center; justify-content: center; }
  .phone {
    position: relative;
    width: ${SW * 2}px;
    height: ${SH * 2}px;
    background: #0b0c0e;
    border-radius: 108px;
    padding: 14px;
    box-shadow: ${shadow};
  }
  .screen {
    width: 100%; height: 100%;
    border-radius: 94px;
    overflow: hidden;
    background: #fff;
    position: relative;
  }
  .screen img { width: 100%; height: 100%; display: block; object-fit: cover; }
  /* Dynamic island, so the handset reads as current rather than a 2017 phone. */
  .island {
    position: absolute; top: 26px; left: 50%; transform: translateX(-50%);
    width: 232px; height: 68px; background: #000; border-radius: 34px; z-index: 2;
  }
</style></head><body>
  <div class="phone">
    <div class="screen">
      <div class="island"></div>
      <img src="data:image/png;base64,${shotB64}" alt="">
    </div>
  </div>
</body></html>`;

const render = async (html, file, omitBackground = false) => {
  const p = await browser.newPage();
  await p.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: 'load' });
  await p.screenshot({ path: join(OUT, file), omitBackground });
  await p.close();
  console.log('  ' + join(OUT, file));
};

await render(
  framed('#0f1114', '0 60px 140px rgba(0,0,0,.65), 0 0 0 2px #23262b'),
  'phone-payment-joshua-dark.png',
);
await render(
  framed('#f6f7f9', '0 60px 140px rgba(16,20,28,.28), 0 0 0 2px #d9dde4'),
  'phone-payment-joshua-light.png',
);

// Cutouts for compositing over footage or a coloured slide. The shadow version
// keeps a soft drop shadow in the alpha channel, which sits better on a busy
// background than a hard-edged cutout does.
await render(
  framed("transparent", "0 60px 140px rgba(0,0,0,.45), 0 0 0 2px #23262b"),
  "phone-payment-joshua-transparent.png",
  true,
);
await render(
  framed("transparent", "none"),
  "phone-payment-joshua-transparent-noshadow.png",
  true,
);

await browser.close();
console.log('\nDone.');
