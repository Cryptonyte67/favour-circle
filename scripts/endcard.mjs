/**
 * Render the end card and standalone logo assets.
 *
 * Uses the same SVG the app ships, so the mark on the end card is the mark in
 * the header rather than a redrawn copy that slowly drifts out of step.
 *
 *   node scripts/endcard.mjs [outDir]
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import QRCode from 'qrcode';

const OUT = process.argv[2] || 'brand';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const FAMILY = '#00b78a';
const FRIENDS = '#d98324';
const COMMUNITY = '#5b5bd6';

/** The app's logo, with colours and tick passed in so it works on any ground. */
const mark = (size, tick, colours = [FAMILY, FRIENDS, COMMUNITY]) => `
<svg viewBox="0 0 64 64" width="${size}" height="${size}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g stroke-width="6" stroke-linecap="round" stroke-dasharray="47 122.6">
    <circle cx="32" cy="32" r="27" stroke="${colours[0]}" transform="rotate(-90 32 32)"/>
    <circle cx="32" cy="32" r="27" stroke="${colours[1]}" transform="rotate(30 32 32)"/>
    <circle cx="32" cy="32" r="27" stroke="${colours[2]}" transform="rotate(150 32 32)"/>
  </g>
  <path d="M21 33.5 L28.5 41 L43 25" stroke="${tick}" stroke-width="6.5"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const FONT = `-apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`;

const endCard = ({ bg, ink, muted, tick }) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1920px; }
  body {
    background: ${bg};
    color: ${ink};
    font-family: ${FONT};
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 0;
  }
  .mark { line-height: 0; margin-bottom: 64px; }
  h1 { font-size: 132px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
  p.tag { margin-top: 34px; font-size: 40px; font-weight: 400; color: ${muted}; text-align: center; line-height: 1.35; max-width: 760px; }
  p.url { margin-top: 96px; font-size: 34px; font-weight: 600; color: ${muted}; letter-spacing: 0.01em; }
</style></head><body>
  <div class="mark">${mark(300, tick)}</div>
  <h1>Favour</h1>
  <p class="tag">Post it. They do it. You approve.<br>They get paid on the spot.</p>
  <p class="url">app.favour-circle.workers.dev</p>
</body></html>`;

/** Mark alone and mark-plus-wordmark, both on transparency for overlays. */
const transparent = (inner, w, h) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${w}px; height: ${h}px; background: transparent; }
  body { display: flex; align-items: center; justify-content: center; gap: 44px;
         font-family: ${FONT}; color: #14161a; }
  h1 { font-size: 150px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
  .mark { line-height: 0; }
</style></head><body>${inner}</body></html>`;

const APP_URL = "https://app.favour-circle.workers.dev";

/**
 * A scan card.
 *
 * The QR always sits on a white panel, even on the dark version. Inverted codes
 * do scan on good phones and fail on plenty of others, and a code nobody can
 * scan is worse than no code at all. High error correction so it survives video
 * compression and a thumb across the corner.
 */
const scanCard = ({ bg, ink, muted, tick, qr }) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1920px; }
  body {
    background: ${bg}; color: ${ink}; font-family: ${FONT};
    display: flex; flex-direction: column; align-items: center; justify-content: center;
  }
  .mark { line-height: 0; margin-bottom: 40px; }
  h1 { font-size: 104px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
  .panel {
    margin-top: 72px; background: #ffffff; border-radius: 48px;
    padding: 44px; line-height: 0;
    box-shadow: 0 30px 80px rgba(0,0,0,.25);
  }
  .panel img { width: 560px; height: 560px; display: block; }
  p.url { margin-top: 64px; font-size: 36px; font-weight: 600; color: ${muted}; }
  p.sub { margin-top: 26px; font-size: 34px; font-weight: 400; color: ${muted}; }
</style></head><body>
  <div class="mark">${mark(150, tick)}</div>
  <h1>Start here</h1>
  <div class="panel"><img src="${qr}" alt=""></div>
  <p class="url">app.favour-circle.workers.dev</p>
  <p class="sub">Point your camera at the code</p>
</body></html>`;

/** Just the words and the code, for laying over footage. */
const scanOverlay = ({ ink, qr }) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 900px; height: 1150px; background: transparent; }
  body { font-family: ${FONT}; color: ${ink};
         display: flex; flex-direction: column; align-items: center; justify-content: center; }
  h1 { font-size: 104px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
  .panel { margin-top: 56px; background: #ffffff; border-radius: 48px; padding: 44px;
           line-height: 0; box-shadow: 0 30px 80px rgba(0,0,0,.35); }
  .panel img { width: 620px; height: 620px; display: block; }
</style></head><body>
  <h1>Start here</h1>
  <div class="panel"><img src="${qr}" alt=""></div>
</body></html>`;

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  // --default-background-color crashes the session on this build; omitBackground
  // on the screenshot gives transparency without it.
  args: ['--hide-scrollbars', '--force-color-profile=srgb'],
});

const render = async (html, file, width, height, omitBackground = false) => {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: join(OUT, file), omitBackground });
  await page.close();
  console.log('  ' + join(OUT, file));
};

await render(
  endCard({ bg: '#0f1114', ink: '#f2f4f7', muted: '#9aa3b2', tick: '#f2f4f7' }),
  'endcard-dark.png', 1080, 1920,
);

await render(
  endCard({ bg: '#f6f7f9', ink: '#14161a', muted: '#5b6270', tick: '#14161a' }),
  'endcard-light.png', 1080, 1920,
);

// Mark on its own, square and transparent, for corner bugs and app icons.
await render(
  transparent(`<div class="mark">${mark(900, '#14161a')}</div>`, 1024, 1024),
  'logo-mark-dark-tick.png', 1024, 1024, true,
);
await render(
  transparent(`<div class="mark">${mark(900, '#ffffff')}</div>`, 1024, 1024),
  'logo-mark-light-tick.png', 1024, 1024, true,
);

// Horizontal lockup for titles and thumbnails.
await render(
  transparent(`<div class="mark">${mark(190, '#14161a')}</div><h1>Favour</h1>`, 1000, 260),
  'logo-lockup-dark-text.png', 1000, 260, true,
);
await render(
  transparent(
    `<div class="mark">${mark(190, '#ffffff')}</div><h1 style="color:#ffffff">Favour</h1>`,
    1000, 260,
  ),
  'logo-lockup-light-text.png', 1000, 260, true,
);

// Error correction Q survives compression and a partly covered corner. The
// margin is the quiet zone; without it many scanners simply will not lock on.
const qrDataUrl = await QRCode.toDataURL(APP_URL, {
  width: 1200,
  margin: 2,
  errorCorrectionLevel: 'Q',
  color: { dark: '#000000ff', light: '#ffffffff' },
});

await render(
  scanCard({ bg: '#0f1114', ink: '#f2f4f7', muted: '#9aa3b2', tick: '#f2f4f7', qr: qrDataUrl }),
  'scan-start-here-dark.png', 1080, 1920,
);
await render(
  scanCard({ bg: '#f6f7f9', ink: '#14161a', muted: '#5b6270', tick: '#14161a', qr: qrDataUrl }),
  'scan-start-here-light.png', 1080, 1920,
);
await render(
  scanOverlay({ ink: '#ffffff', qr: qrDataUrl }),
  'scan-start-here-overlay-white-text.png', 900, 1150, true,
);
await render(
  scanOverlay({ ink: '#14161a', qr: qrDataUrl }),
  'scan-start-here-overlay-dark-text.png', 900, 1150, true,
);

await browser.close();
console.log('\nDone.');
