/**
 * Give shared links a message a stranger can understand.
 *
 * The share sheet previously sent "Wash the car: https://...". To someone who
 * has never heard of the app that reads as spam: no sender, no context, no
 * reason to tap. Every route now carries a short written message, the sheet
 * shows exactly what will be sent, and clipboard copies the message rather than
 * a bare URL, since clipboard is the route that actually works inside the
 * WebView.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const FILE_MAIN = 'src/web/main.ts';
let main = readFileSync(FILE_MAIN, 'utf8');

/* ---------------------------------------------------------------- helpers */

const messageHelpers = `/**
 * What actually gets sent.
 *
 * Written for someone who has never heard of the app: who it is from, what is
 * being asked, what it pays, and only then the link. The reward is the part
 * that earns the tap, so it goes before the URL rather than after it.
 */
function favourMessage(task: Task): string {
  const me = state.displayName || 'A neighbour';
  const fiat = approxFiat(task.reward.assetKey, task.reward.units, state.currency);
  const paid = formatMoney(task.reward) + (fiat ? ' (' + fiat.replace('≈ ', 'about ') + ')' : '');
  return (
    me + ' needs a favour doing: "' + task.title + '", paid ' + paid + '. ' +
    'Have a look and take it if you fancy it: ' + taskUrl(origin, task.id)
  );
}

function inviteMessage(circle: { name: string; inviteCode: string }): string {
  const me = state.displayName || 'A neighbour';
  return (
    me + ' has invited you to "' + circle.name + '" on Favour, where people post ' +
    'small paid jobs for each other and settle up instantly. Join here: ' +
    inviteUrl(origin, circle.inviteCode)
  );
}

`;

main = main.replace('function shareSheet(', messageHelpers + 'function shareSheet(');

/* ------------------------------------------------- shareSheet signature */

main = main.replace(
  `function shareSheet(title: string, url: string, subject: string) {
  const body = el('div', {});
  const caps = capabilities();
  const message = subject + ': ' + url;

  const img = el('img', { class: 'qr', alt: 'QR code for ' + url });
  void qrDataUrl(url).then((data) => (img.src = data));
  body.append(img, el('p', { class: 'muted small center mono break' }, url));`,
  `function shareSheet(title: string, url: string, message: string) {
  const body = el('div', {});
  const caps = capabilities();

  const img = el('img', { class: 'qr', alt: 'QR code for ' + url });
  void qrDataUrl(url).then((data) => (img.src = data));
  body.append(img);

  // Show the message itself, not just the URL. Nobody should have to guess what
  // their friend is about to receive.
  body.append(
    el('p', { class: 'field-label' }, 'They will get'),
    el('p', { class: 'share-preview' }, message),
  );`,
);

/* ----------------------------------------------------------- share button */

main = main.replace(
  `      const ok = await tryWebShare(title, subject, url);`,
  `      const ok = await tryWebShare(title, message, url);`,
);

/* ------------------------------------------------------------ copy button */

main = main.replace(
  `    const copy = el('button', { class: 'primary' }, 'Copy link');
    copy.onclick = async () => {
      const ok = await copyToClipboard(url);
      notify(ok ? 'ok' : 'error', ok ? 'Link copied.' : 'Could not copy. Long-press the link above.');
    };`,
  `    // Copies the whole message, not a bare URL. Clipboard is the route that
    // works inside the WebView, so it is the one most people will use.
    const copy = el('button', { class: 'primary' }, 'Copy message');
    copy.onclick = async () => {
      const ok = await copyToClipboard(message);
      notify(
        ok ? 'ok' : 'error',
        ok ? 'Message copied. Paste it wherever you like.' : 'Could not copy. Select the text above.',
      );
    };`,
);

/* ------------------------------------------------------------- sms button */

main = main.replace(
  `          notify('error', 'This app cannot open the messages composer. Use Copy link instead.');`,
  `          notify('error', 'This app cannot open the messages composer. Use Copy message instead.');`,
);

/* ------------------------------------------------------------- call sites */

main = main.replace(
  `    share.onclick = () => shareSheet('Share this favour', taskUrl(origin, task.id), task.title);`,
  `    share.onclick = () =>
      shareSheet('Share this favour', taskUrl(origin, task.id), favourMessage(task));`,
);
main = main.replace(
  `      shareSheet('Share this favour', taskUrl(origin, task.id), task.title);`,
  `      shareSheet('Share this favour', taskUrl(origin, task.id), favourMessage(task));`,
);
main = main.replaceAll(
  `      shareSheet('Invite to ' + circle.name, inviteUrl(origin, circle.inviteCode), circle.name);`,
  `      shareSheet('Invite to ' + circle.name, inviteUrl(origin, circle.inviteCode), inviteMessage(circle));`,
);

writeFileSync(FILE_MAIN, main);
console.log('share messages wired');

/* ----------------------------------------------------------------- style */

const css = readFileSync('src/web/style.css', 'utf8');
if (!css.includes('.share-preview')) {
  writeFileSync(
    'src/web/style.css',
    css +
      `
/* The message itself, shown before it is sent. Quoted rather than styled as a
   control, so it reads as text a person will receive. */
.share-preview {
  margin: 6px 0 0;
  padding: 12px 14px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.5;
  word-break: break-word;
}
`,
  );
  console.log('share-preview style added');
}
