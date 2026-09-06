/**
 * Capture the app at 1080x1920 (9:16) for the demo video and the competition
 * submission.
 *
 * Drives the real deployed app with the local Chrome rather than mocking
 * anything, so what lands in the video is what a person actually sees. Each
 * scene seeds its own state through the API and captures a single frame.
 *
 *   node scripts/shots.mjs [baseUrl] [outDir]
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] || 'https://app.favour-circle.workers.dev';
const OUT = process.argv[3] || 'shots';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// 540x960 at 2x gives a true 1080x1920 frame, which is what a vertical
// timeline wants and leaves headroom for a slow push-in during the edit.
const WIDTH = 540;
const HEIGHT = 960;
const SCALE = 2;

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--hide-scrollbars', '--force-color-profile=srgb'],
});

const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE });

const shot = async (name) => {
  const file = join(OUT, name + '.png');
  await page.screenshot({ path: file });
  console.log('  ' + file);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Build a whole world through the API and return the ids we need. */
async function seed() {
  return page.evaluate(async (base) => {
    const post = (path, body, who) =>
      fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(who ? { 'x-user-id': who } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      }).then((r) => r.json());

    const sam = await post('/api/session', {
      displayName: 'Chris',
      address: 'NQ07 4KWM 8XPQ 2H3D 9VBN 6TLR 5CGY 1JFS 7EAD',
    });
    const ava = await post('/api/session', {
      displayName: 'Jamie',
      address: 'NQ21 9BXT 3RMD 7KLP 2SVN 8QHG 4YFC 6JAW 1DER',
    });
    await fetch(base + '/api/me/addresses', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-user-id': ava.user.id },
      body: JSON.stringify({ chain: 'polygon', address: '0x7A3fD2Bc91E4a05CbD8e2F1a6B0C4D9e83F2a71B' }),
    });

    const street = await post('/api/circles', { name: 'Alder Road', kind: 'community' }, sam.user.id);
    const home = await post('/api/circles', { name: 'Home', kind: 'family' }, sam.user.id);
    await post('/api/circles/join', { code: street.circle.inviteCode }, ava.user.id);
    await post('/api/circles/join', { code: home.circle.inviteCode }, ava.user.id);

    const mk = (title, detail, amount, circleId) =>
      post('/api/tasks', { title, detail, amount, assetKey: 'USDT@polygon', circleIds: [circleId] }, sam.user.id);

    const car = await mk('Wash the car', 'Front drive, bucket is in the garage', '8.00', street.circle.id);
    const grass = await mk('Cut the front grass', 'Mower is in the shed', '12.00', street.circle.id);
    const parcel = await mk('Pick up my parcel', 'Corner shop, before 6', '3.00', street.circle.id);
    const bins = await mk('Take the bins out', 'Green bin, Tuesday night', '4.00', home.circle.id);

    return {
      sam: sam.user.id,
      ava: ava.user.id,
      street: street.circle.id,
      inviteCode: street.circle.inviteCode,
      car: car.task.id,
      grass: grass.task.id,
      parcel: parcel.task.id,
      bins: bins.task.id,
    };
  }, BASE);
}

const act = (taskId, action, who, body) =>
  page.evaluate(
    async (base, id, a, w, b) => {
      await fetch(base + '/api/tasks/' + id + '/' + a, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user-id': w },
        body: b ? JSON.stringify(b) : undefined,
      });
    },
    BASE, taskId, action, who, body,
  );

const asUser = async (id) => {
  await page.evaluate((uid) => localStorage.setItem('favour-circle:user-id', uid), id);
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(900);
};

const tab = async (label) => {
  await page.evaluate((t) => {
    const el = [...document.querySelectorAll('.tab')].find((b) => b.textContent.includes(t));
    el?.click();
  }, label);
  await wait(500);
};

console.log('Capturing ' + BASE + ' at ' + WIDTH * SCALE + 'x' + HEIGHT * SCALE + '\n');

await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
await wait(1200);

// 01 — the hero / onboarding screen
await shot('01-open');

const ids = await seed();

// 02 — posting a favour, mid-compose
await asUser(ids.sam);
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.tab')].find((b) => b.textContent.includes('Favours'));
  el?.click();
  document.querySelector('.fab')?.click();
});
await wait(600);
await page.evaluate(() => {
  const sheet = document.querySelector('.sheet-card');
  const inputs = sheet.querySelectorAll('input');
  inputs[0].value = 'Wash the car';
  sheet.querySelector('textarea').value = 'Front drive, bucket is in the garage';
  const amount = inputs[1];
  amount.value = '8.00';
  amount.dispatchEvent(new Event('input', { bubbles: true }));
  const check = sheet.querySelector('.check input');
  if (check) check.click();
});
await wait(500);
await shot('02-post-a-favour');

// 03 — the list, colour-coded by circle
await page.evaluate(() => document.querySelector('.sheet')?.remove());
await wait(400);
await shot('03-favours-list');

// 04 — the other person's view, with the claim button
await asUser(ids.ava);
await shot('04-ill-do-it');

// 05 — claimed and submitted, waiting on approval
await act(ids.car, 'claim', ids.ava);
await act(ids.car, 'done', ids.ava, { signature: 'mocksig:demo' });
await act(ids.grass, 'claim', ids.ava);
await act(ids.grass, 'done', ids.ava, { signature: 'mocksig:demo' });
await asUser(ids.sam);
await shot('05-needs-approval');

// 06 — the batch, which is the whole point
await act(ids.car, 'approve', ids.sam);
await act(ids.grass, 'approve', ids.sam);
await asUser(ids.sam);
await tab('Owed');
await shot('06-one-payment');

// 07 — invite, with the QR
await tab('Circles');
await page.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Invite someone');
  el?.click();
});
await wait(1200);
await shot('07-invite');

// 08 — what someone sees with no app and no wallet
await page.goto(BASE + '/t/' + ids.parcel, { waitUntil: 'networkidle0' });
await wait(700);
await shot('08-no-app-needed');

await browser.close();
console.log('\nDone. Frames are ' + WIDTH * SCALE + 'x' + HEIGHT * SCALE + ' (9:16).');
