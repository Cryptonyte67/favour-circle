/**
 * YouTube thumbnails, 1080x1920 (9:16), for Shorts.
 *
 * Built around one rule: it has to work at 120 pixels wide, because that is how
 * most people will first see it in a browse feed. That means very few words,
 * very large, and one focal point. Everything here is sized against that rather
 * than against how it looks at full size.
 *
 *   node scripts/thumbnail.mjs [phonePng] [outDir]
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const PHONE = process.argv[2] || 'brand/phone-payment-joshua-transparent.png';
const OUT = process.argv[3] || 'brand';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const FAMILY = '#00b78a';
const FRIENDS = '#d98324';
const COMMUNITY = '#5b5bd6';

const phoneB64 = readFileSync(PHONE).toString('base64');

const mark = (size, tick) => `
<svg viewBox="0 0 64 64" width="${size}" height="${size}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g stroke-width="6" stroke-linecap="round" stroke-dasharray="47 122.6">
    <circle cx="32" cy="32" r="27" stroke="${FAMILY}" transform="rotate(-90 32 32)"/>
    <circle cx="32" cy="32" r="27" stroke="${FRIENDS}" transform="rotate(30 32 32)"/>
    <circle cx="32" cy="32" r="27" stroke="${COMMUNITY}" transform="rotate(150 32 32)"/>
  </g>
  <path d="M21 33.5 L28.5 41 L43 25" stroke="${tick}" stroke-width="6.5"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const FONT = `-apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`;

/**
 * @param lines  Array of {text, colour?}. Kept to three at most; four lines at
 *               this size is unreadable in a feed.
 */
const thumb = ({ lines, kicker }) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:1080px; height:1920px; overflow:hidden; }
  body {
    background:#0f1114; color:#fff; font-family:${FONT};
    position:relative; display:flex; flex-direction:column; align-items:center;
  }
  /* Soft brand glow behind the handset so it separates from the ground without
     needing an outline. */
  .glow {
    position:absolute; left:50%; top:58%; transform:translate(-50%,-50%);
    width:1000px; height:1000px; border-radius:50%;
    background:radial-gradient(circle, ${FAMILY}3a 0%, ${FAMILY}00 62%);
  }
  /* Vertical layout keeps the words in the top third and the phone below. In a
     Shorts feed the bottom of the frame is covered by the title, channel name
     and buttons, so nothing that matters sits under y=1600. */
  .copy { margin-top:170px; text-align:center; z-index:3; padding:0 60px; }
  .kicker {
    font-size:40px; font-weight:700; letter-spacing:.13em; text-transform:uppercase;
    color:${FAMILY}; margin-bottom:26px;
  }
  h1 { font-size:132px; font-weight:800; line-height:0.96; letter-spacing:-0.035em; }
  h1 span { display:block; }
  .phone {
    position:absolute; left:50%; top:640px;
    transform:translateX(-50%) rotate(-5deg);
    height:980px; z-index:2;
  }
  .brand {
    position:absolute; left:50%; bottom:120px; transform:translateX(-50%);
    z-index:3; display:flex; align-items:center; gap:18px;
  }
  .brand .name { font-size:60px; font-weight:700; letter-spacing:-0.02em; }
</style></head><body>
  <div class="glow"></div>
  <div class="copy">
    ${kicker ? `<div class="kicker">${kicker}</div>` : ''}
    <h1>${lines.map((l) => `<span${l.colour ? ` style="color:${l.colour}"` : ''}>${l.text}</span>`).join('')}</h1>
  </div>
  <img class="phone" src="data:image/png;base64,${phoneB64}" alt="">
  <div class="brand">${mark(72, '#fff')}<span class="name">Favour</span></div>
</body></html>`;

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--hide-scrollbars', '--force-color-profile=srgb'],
});

const render = async (html, file) => {
  const p = await browser.newPage();
  await p.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: 'load' });
  await p.screenshot({ path: join(OUT, file) });
  await p.close();
  console.log('  ' + join(OUT, file));
};

// A: the benefit, stated flatly. Safest and clearest at small size.
await render(
  thumb({
    kicker: 'Chores. Favours. Odd jobs.',
    lines: [{ text: 'PAID ON' }, { text: 'THE SPOT', colour: FAMILY }],
  }),
  'thumb-a-paid-on-the-spot.png',
);

// B: names the problem instead of the fix. Higher curiosity, needs the quote
// marks to read as speech rather than as a claim.
await render(
  thumb({
    kicker: 'The end of the IOU',
    lines: [{ text: 'NO MORE' }, { text: '"NEXT WEEK"', colour: FRIENDS }],
  }),
  'thumb-b-no-more-next-week.png',
);

// C: money on the face of it. Strongest thumbnail instinct, weakest on context.
await render(
  thumb({
    kicker: 'Wash the car. Cut the grass.',
    lines: [{ text: '\u00a35.' }, { text: 'INSTANTLY.', colour: FAMILY }],
  }),
  'thumb-c-five-pounds.png',
);

await browser.close();
console.log('\nDone. 1280x720.');
