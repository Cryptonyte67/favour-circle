import { api, storeUserId, storedUserId, type CircleWithCount, type TasksResponse } from './api.js';
import { detectProvider, type WalletProvider } from './nimiq/provider.js';
import { pickRail, railsFor, type PayoutRail } from './rails/rail.js';
import {
  ASSETS,
  CIRCLE_KINDS,
  DEFAULT_ASSET_KEY,
  SELECTABLE_ASSET_KEYS,
  type CircleKind,
  type Id,
  type Task,
  type WalletAddress,
} from '../shared/types.js';
import { formatMoney, formatUnits, parseDecimal } from '../shared/money.js';
import {
  capabilities,
  copyToClipboard,
  inviteUrl,
  qrDataUrl,
  smsHref,
  taskUrl,
  tryWebShare,
  watchSmsHandoff,
} from './share.js';
import {
  approxFiat,
  detectCurrency,
  fiatToAssetAmount,
  rateFor,
  loadRates,
  ratesAreUnavailable,
  storeCurrency,
  CURRENCIES,
  type Currency,
} from './prices.js';
import {
  passiveReport,
  probeClipboard,
  probePriceApi,
  probeShare,
  probeWallet,
  sendReport,
  walletDetected,
  type DiagnosticsReport,
} from './diagnostics.js';
import { logoElement } from './logo.js';
import './style.css';

/* ----------------------------- app state ----------------------------- */

interface State {
  ready: boolean;
  userId: Id | null;
  displayName: string;
  /** Where this user gets paid. Empty means they cannot receive anything yet. */
  addresses: WalletAddress[];
  circles: CircleWithCount[];
  tasks: TasksResponse | null;
  tab: 'favours' | 'circles' | 'owed';
  filter: CircleKind | 'all';
  currency: Currency;
  busy: boolean;
}

const state: State = {
  ready: false,
  userId: storedUserId(),
  displayName: '',
  addresses: [],
  circles: [],
  tasks: null,
  tab: 'favours',
  filter: 'all',
  currency: detectCurrency(),
  busy: false,
};

let wallet: WalletProvider;
let rails: PayoutRail[];

const root = document.getElementById('app') as HTMLElement;
const origin = location.origin;

/* ------------------------------ helpers ------------------------------ */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

let toastTimer = 0;

/**
 * Toasts mount on <body>, not inside #app.
 *
 * They used to render into the app root, which puts them *behind* the sheet
 * overlay. Every validation error raised from inside a sheet — "Give the circle
 * a name", "What needs doing?" — was therefore invisible: the button appeared to
 * do nothing at all. Anything that reports a failure has to outrank the thing
 * that caused it.
 */
function notify(kind: 'error' | 'ok', text: string) {
  document.querySelector('.toast')?.remove();
  const toast = el('div', { class: 'toast ' + kind, role: 'status' }, text);
  document.body.append(toast);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.remove(), 4000);
}

/** Enter should do the obvious thing in a single-field sheet. */
function submitOnEnter(input: HTMLInputElement, button: HTMLButtonElement) {
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      button.click();
    }
  };
}

async function guard(fn: () => Promise<void>) {
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    await fn();
  } catch (err) {
    notify('error', (err as Error).message);
  } finally {
    state.busy = false;
    render();
  }
}

async function refresh() {
  const [{ circles }, tasks] = await Promise.all([api.circles(), api.tasks()]);
  state.circles = circles;
  state.tasks = tasks;
}

function nameOf(id: Id | null): string {
  if (!id) return 'nobody';
  if (id === state.userId) return 'you';
  return state.tasks?.names[id] ?? 'someone';
}

const KIND_LABEL: Record<CircleKind, string> = {
  family: 'Family',
  friends: 'Friends',
  community: 'Community',
};

const STATUS_LABEL: Record<Task['status'], string> = {
  open: 'Up for grabs',
  claimed: 'In progress',
  submitted: 'Needs approval',
  approved: 'Awaiting payment',
  settled: 'Paid',
  cancelled: 'Cancelled',
};

/* ------------------------------- modal ------------------------------- */

function openSheet(title: string, body: HTMLElement) {
  const sheet = el('div', { class: 'sheet' });
  const card = el('div', { class: 'sheet-card' });
  const close = el('button', { class: 'sheet-close', 'aria-label': 'Close' }, '×');
  close.onclick = () => sheet.remove();
  card.append(el('h2', {}, title), close, body);
  sheet.append(card);
  sheet.onclick = (e) => {
    if (e.target === sheet) sheet.remove();
  };
  document.body.append(sheet);
  return sheet;
}

/**
 * Shown on every screen, onboarding included.
 *
 * It used to be appended only after the signed-in branch, which put the crypto
 * explainer behind a sign-up — exactly the wrong side of the door for the
 * person who most needs it.
 */
function appFooter(): HTMLElement {
  return el(
    'footer',
    { class: 'app-footer muted small center' },
    el(
      'a',
      { href: '/help/cash-out', class: 'muted' },
      'New to crypto? What your earnings are and what to do with them',
    ),
    // Also on the onboarding screen, but that is only ever seen once. Anyone
    // already signed in had no way to reach diagnostics from inside the app,
    // which is exactly the context the wallet checks need to run in.
    ...(diagnosticsEnabled() ? [el('span', { class: 'sep' }, ' · '), diagnosticsLink()] : []),
  );
}

/**
 * Diagnostics are hidden unless explicitly switched on.
 *
 * They are a developer tool, not a feature, and had no business appearing in
 * the footer of every screen for every user. Open the app once with ?diag=1 to
 * enable them on that device; ?diag=0 turns them off again. The probe itself is
 * unchanged — this only controls whether the link is visible.
 */
function diagnosticsEnabled(): boolean {
  try {
    const flag = new URLSearchParams(location.search).get('diag');
    if (flag === '1') localStorage.setItem('favour-circle:diag', '1');
    if (flag === '0') localStorage.removeItem('favour-circle:diag');
    return localStorage.getItem('favour-circle:diag') === '1';
  } catch {
    return false;
  }
}

/**
 * Opens the probe in a sheet rather than navigating.
 *
 * Nimiq Pay's WebView hands link taps to Safari, so the standalone /diag page
 * could never measure the app's own context — it always reported "no wallet"
 * because Safari has none.
 */
function diagnosticsLink(): HTMLElement {
  const link = el('a', { href: '#', class: 'muted' }, 'Diagnostics');
  link.onclick = (e) => {
    e.preventDefault();
    diagnosticsSheet();
  };
  return link;
}

function diagnosticsSheet() {
  const body = el('div', {});
  const report: DiagnosticsReport = passiveReport();

  const banner = el(
    'div',
    { class: 'diag-banner ' + (walletDetected() ? 'good' : 'bad') },
    walletDetected()
      ? 'Wallet detected — this run counts.'
      : 'No wallet injected here. If this is Nimiq Pay, it exposed nothing.',
  );

  const out = el('pre', { class: 'diag-out' }, JSON.stringify(report, null, 2));
  const redraw = () => {
    out.textContent = JSON.stringify(report, null, 2);
  };

  const run = (label: string, key: string, fn: () => Promise<unknown>) => {
    const button = el('button', { class: 'ghost' }, label);
    button.onclick = async () => {
      button.textContent = label + '…';
      report[key] = await fn();
      redraw();
      button.textContent = label + ' ✓';
    };
    body.append(button);
  };

  body.append(banner, el('p', { class: 'note' }, 'Tap each check, then send.'));

  run('Wallet: accounts + signature', 'wallet', () => probeWallet(wallet));
  run('Price API', 'priceApi', probePriceApi);
  run('Clipboard', 'clipboard', probeClipboard);
  run('Share sheet', 'share', probeShare);

  const status = el('p', { class: 'muted small' }, '');
  const send = el('button', { class: 'primary' }, 'Send to my computer');
  send.onclick = async () => {
    status.textContent = 'Sending…';
    status.textContent = await sendReport(report);
  };

  body.append(send, status, out);
  openSheet('Diagnostics', body);
}

/* ------------------------------ onboarding --------------------------- */

function renderOnboarding(): HTMLElement {
  const wrap = el('div', { class: 'card center' });
  wrap.append(
    el('div', { class: 'brand brand-lg' }, logoElement(56)),
    el('h1', {}, 'Favour Circle'),
    el(
      'p',
      { class: 'muted' },
      'Post a small job to your family, friends or neighbours. They do it, you approve, they get paid.',
    ),
  );

  const input = el('input', { placeholder: 'Your name', maxlength: '40' });
  const button = el('button', { class: 'primary' }, 'Get started');

  button.onclick = () =>
    guard(async () => {
      const name = input.value.trim();
      if (!name) throw new Error('What should people call you?');
      const accounts = await wallet.getAccounts().catch(() => []);
      const { user } = await api.createSession(name, accounts[0]?.address);
      storeUserId(user.id);
      state.userId = user.id;
      state.displayName = user.displayName;
      state.addresses = user.addresses;
      await refresh();
      await handleRoute();
    });

  submitOnEnter(input, button);

  wrap.append(input, button);
  if (!wallet.isReal) {
    wrap.append(
      el(
        'p',
        { class: 'note' },
        'No Nimiq Pay detected, so a mock wallet is in use. Payments are simulated.',
      ),
    );
  }

  if (diagnosticsEnabled()) {
    wrap.append(
      el('p', { class: 'muted small', style: 'margin-top:14px' }, diagnosticsLink()),
    );
  }

  return wrap;
}

/* -------------------------------- favours ----------------------------- */

function taskCard(task: Task): HTMLElement {
  // Where a favour spans several circles the first is used; the edge is a hint
  // about origin, not a claim of exclusivity.
  const kind = state.circles.find((c) => task.circleIds.includes(c.id))?.kind;
  const card = el('div', { class: 'card task' + (kind ? ' from-' + kind : '') });
  const mine = task.posterId === state.userId;
  const isDoer = task.doerId === state.userId;

  card.append(
    el('div', { class: 'row' },
      el('span', { class: 'pill status-' + task.status }, STATUS_LABEL[task.status]),
      el('div', { class: 'reward-box' },
        el('span', { class: 'reward' }, formatMoney(task.reward)),
        ...(() => {
          const fiat = approxFiat(task.reward.assetKey, task.reward.units, state.currency);
          return fiat ? [el('span', { class: 'muted small fiat' }, fiat)] : [];
        })(),
      ),
    ),
    el('h3', {}, task.title),
  );

  if (task.detail) card.append(el('p', { class: 'detail' }, task.detail));

  const who = mine
    ? 'You posted this' + (task.doerId ? ' · ' + nameOf(task.doerId) + ' is on it' : '')
    : 'Posted by ' + nameOf(task.posterId);
  card.append(el('p', { class: 'muted small' }, who));

  const actions = el('div', { class: 'actions' });

  if (task.status === 'open' && !mine) {
    const claim = el('button', { class: 'primary' }, "I'll do it");
    claim.onclick = () =>
      guard(async () => {
        await api.claim(task.id);
        await refresh();
        notify('ok', 'It is yours. Mark it done when you finish.');
      });
    actions.append(claim);
  }

  if (task.status === 'claimed' && isDoer) {
    const done = el('button', { class: 'primary' }, 'Mark done');
    done.onclick = () =>
      guard(async () => {
        // The signature is a nice-to-have audit trail, never a blocker.
        const signature = await wallet.signMessage(
          'I completed favour ' + task.id + ' at ' + new Date().toISOString(),
        );
        await api.markDone(task.id, signature);
        await refresh();
        notify('ok', 'Sent for approval.');
      });
    actions.append(done);
  }

  if (task.status === 'submitted' && mine) {
    const approve = el('button', { class: 'primary' }, 'Approve');
    approve.onclick = () =>
      guard(async () => {
        await api.approve(task.id);
        await refresh();
        notify('ok', 'Approved. It is now in Owed, ready to settle.');
      });
    actions.append(approve);
  }

  if (mine && ['open', 'claimed', 'submitted'].includes(task.status)) {
    const cancel = el('button', { class: 'ghost' }, 'Cancel');
    cancel.onclick = () =>
      guard(async () => {
        await api.cancel(task.id);
        await refresh();
      });
    actions.append(cancel);
  }

  if (task.status === 'open') {
    const share = el('button', { class: 'ghost' }, 'Share');
    share.onclick = () => shareSheet('Share this favour', taskUrl(origin, task.id), task.title);
    actions.append(share);
  }

  if (task.settlement) {
    card.append(el('p', { class: 'muted small mono' }, 'tx ' + task.settlement.txHash));
  }

  if (actions.childElementCount) card.append(actions);
  return card;
}

function renderFavours(): HTMLElement {
  const wrap = el('div', {});

  if (state.circles.length === 0) {
    wrap.append(
      el('div', { class: 'card center' },
        el('h3', {}, 'No circles yet'),
        el('p', { class: 'muted' }, 'Create one, or join with a code, before posting a favour.'),
      ),
    );
    return wrap;
  }

  const filters = el('div', { class: 'filters' });
  const options: (CircleKind | 'all')[] = ['all', ...CIRCLE_KINDS];
  for (const option of options) {
    const chip = el(
      'button',
      {
        class:
          'chip' +
          (state.filter === option ? ' on' : '') +
          (option === 'all' ? '' : ' kind kind-' + option),
      },
      option === 'all' ? 'All' : KIND_LABEL[option],
    );
    chip.onclick = () => {
      state.filter = option;
      render();
    };
    filters.append(chip);
  }
  wrap.append(filters);

  const byId = new Map(state.circles.map((c) => [c.id, c]));
  const visible = (state.tasks?.tasks ?? []).filter((task) => {
    if (state.filter === 'all') return true;
    return task.circleIds.some((id) => byId.get(id)?.kind === state.filter);
  });

  const live = visible.filter((t) => !['settled', 'cancelled'].includes(t.status));
  const past = visible.filter((t) => ['settled', 'cancelled'].includes(t.status));

  if (live.length === 0) {
    wrap.append(el('div', { class: 'card center' }, el('p', { class: 'muted' }, 'Nothing open here yet.')));
  }
  for (const task of live) wrap.append(taskCard(task));

  if (past.length) {
    wrap.append(el('h4', { class: 'section' }, 'Finished'));
    for (const task of past) wrap.append(taskCard(task));
  }

  return wrap;
}

function postFavourSheet() {
  const body = el('div', {});
  const title = el('input', { placeholder: 'What needs doing?', maxlength: '80' });
  const detail = el('textarea', { placeholder: 'Any detail (optional)', rows: '3' });
  const amount = el('input', { placeholder: '2.50', inputmode: 'decimal' });

  // Three ways to price a favour: in NIM, in USDT, or in the viewer's own
  // currency. The last is how people actually think — "I'll pay three pounds
  // for this" — so it exists alongside the crypto assets rather than as a
  // read-only conversion underneath them.
  //
  // Fiat entry settles in USDT, never NIM. A favour posted as "£3" and paid a
  // week later in NIM could be worth noticeably more or less; pinned to a
  // stablecoin it stays roughly £3, which is what the poster meant.
  const FIAT_MODE = 'FIAT';
  const FIAT_SETTLES_IN = 'USDT@polygon';

  let mode: string = DEFAULT_ASSET_KEY;
  const assetPicker = el('div', { class: 'filters' });
  const assetChips: HTMLButtonElement[] = [];

  const chipFor = (key: string, label: string) => {
    const chip = el('button', { class: 'chip' + (key === mode ? ' on' : '') }, label);
    chip.onclick = () => {
      if (chip.hasAttribute('disabled')) return;
      mode = key;
      for (const other of assetChips) other.classList.remove('on');
      chip.classList.add('on');
      updatePreview();
    };
    assetChips.push(chip);
    assetPicker.append(chip);
    return chip;
  };

  for (const key of SELECTABLE_ASSET_KEYS) {
    const spec = ASSETS[key];
    if (spec) chipFor(key, spec.symbol);
  }

  // Only offered when a rate is actually available; without one there is no
  // honest way to turn a fiat figure into an amount of crypto.
  const fiatChip = chipFor(FIAT_MODE, state.currency);
  if (rateFor(FIAT_SETTLES_IN, state.currency) === null) {
    fiatChip.setAttribute('disabled', 'disabled');
    fiatChip.title = 'Exchange rate unavailable';
  }

  /** What this favour will actually be posted as, given the current mode. */
  const resolveAmount = (): { assetKey: string; amount: string } | null => {
    if (mode !== FIAT_MODE) return { assetKey: mode, amount: amount.value };
    const converted = fiatToAssetAmount(FIAT_SETTLES_IN, amount.value, state.currency);
    return converted ? { assetKey: FIAT_SETTLES_IN, amount: converted } : null;
  };

  const circleBox = el('div', { class: 'checks' });
  const chosen = new Set<Id>();
  for (const circle of state.circles) {
    const id = 'circle-' + circle.id;
    const input = el('input', { type: 'checkbox', id });
    input.onchange = () => (input.checked ? chosen.add(circle.id) : chosen.delete(circle.id));
    const label = el('label', { for: id }, KIND_LABEL[circle.kind] + ' · ' + circle.name);
    circleBox.append(el('div', { class: 'check' }, input, label));
  }

  const submit = el('button', { class: 'primary' }, 'Post favour');
  submit.onclick = () =>
    guard(async () => {
      const resolved = resolveAmount();
      if (!resolved) throw new Error('No exchange rate available, so that amount cannot be posted.');
      const { task } = await api.createTask({
        title: title.value,
        detail: detail.value,
        amount: resolved.amount,
        assetKey: resolved.assetKey,
        circleIds: [...chosen],
      });
      sheet.remove();
      await refresh();
      notify('ok', 'Posted.');
      shareSheet('Share this favour', taskUrl(origin, task.id), task.title);
    });

  // Live indicative value while typing, so the poster knows what they are
  // actually offering. Silent when rates are unavailable.
  const preview = el('p', { class: 'muted small', style: 'margin:6px 0 0' }, '');
  function updatePreview() {
    preview.textContent = '';
    if (!amount.value.trim()) return;

    if (mode === FIAT_MODE) {
      const converted = fiatToAssetAmount(FIAT_SETTLES_IN, amount.value, state.currency);
      if (!converted) {
        preview.textContent = 'Exchange rate unavailable';
        return;
      }
      // Format through the same path the favour card uses. Hand-trimming the
      // decimal string here produced a preview that disagreed with the posted
      // amount, which is worse than no preview at all.
      try {
        const units = parseDecimal(FIAT_SETTLES_IN, converted);
        preview.textContent = 'Posted as ' + formatMoney({ assetKey: FIAT_SETTLES_IN, units });
      } catch {
        preview.textContent = '';
      }
      return;
    }

    if (ratesAreUnavailable()) {
      preview.textContent = 'Conversion unavailable right now';
      return;
    }
    try {
      const units = parseDecimal(mode, amount.value || '0');
      const fiat = approxFiat(mode, units, state.currency);
      if (fiat && units !== '0') preview.textContent = fiat;
    } catch {
      // Mid-typing values are often invalid; showing nothing is correct.
    }
  }
  amount.oninput = updatePreview;

  body.append(
    el('label', { class: 'field-label' }, 'Favour'),
    title,
    detail,
    el('label', { class: 'field-label' }, 'Reward'),
    amount,
    assetPicker,
    preview,
    el('label', { class: 'field-label' }, 'Post to'),
    circleBox,
    submit,
  );

  const sheet = openSheet('New favour', body);
  title.focus();
}

/* ------------------------------- circles ----------------------------- */

function renderCircles(): HTMLElement {
  const wrap = el('div', {});

  for (const circle of state.circles) {
    const card = el('div', { class: 'card' });
    card.append(
      el('div', { class: 'row' },
        el('span', { class: 'pill kind-' + circle.kind }, KIND_LABEL[circle.kind]),
        el('span', { class: 'muted small' }, circle.memberCount + ' member' + (circle.memberCount === 1 ? '' : 's')),
      ),
      el('h3', {}, circle.name),
      el('p', { class: 'muted small mono' }, 'Code ' + circle.inviteCode),
    );
    const invite = el('button', { class: 'primary' }, 'Invite someone');
    invite.onclick = () =>
      shareSheet('Invite to ' + circle.name, inviteUrl(origin, circle.inviteCode), circle.name);
    card.append(invite);
    wrap.append(card);
  }

  if (state.circles.length === 0) {
    wrap.append(
      el('div', { class: 'card center' }, el('p', { class: 'muted' }, 'You are not in any circles yet.')),
    );
  }

  const actions = el('div', { class: 'card' });
  const create = el('button', { class: 'primary' }, 'Create a circle');
  create.onclick = createCircleSheet;
  const join = el('button', { class: 'ghost' }, 'Join with a code');
  join.onclick = joinCircleSheet;
  actions.append(create, join);
  wrap.append(actions);

  return wrap;
}

function createCircleSheet() {
  const body = el('div', {});
  const name = el('input', { placeholder: 'Circle name', maxlength: '40' });
  let kind: CircleKind = 'family';

  const picker = el('div', { class: 'filters' });
  const chips: HTMLButtonElement[] = [];
  for (const option of CIRCLE_KINDS) {
    const chip = el('button', { class: 'chip' + (option === kind ? ' on' : '') }, KIND_LABEL[option]);
    chip.onclick = () => {
      kind = option;
      for (const other of chips) other.classList.remove('on');
      chip.classList.add('on');
    };
    chips.push(chip);
    picker.append(chip);
  }

  const submit = el('button', { class: 'primary' }, 'Create');
  submit.onclick = () =>
    guard(async () => {
      const { circle } = await api.createCircle(name.value, kind);
      sheet.remove();
      await refresh();
      shareSheet('Invite to ' + circle.name, inviteUrl(origin, circle.inviteCode), circle.name);
    });

  submitOnEnter(name, submit);

  body.append(
    el('label', { class: 'field-label' }, 'Name'),
    name,
    el('label', { class: 'field-label' }, 'Type'),
    picker,
    el(
      'p',
      { class: 'note' },
      'Community circles are join-by-code, not a public board. Everyone in a circle can see and claim its favours.',
    ),
    submit,
  );
  const sheet = openSheet('New circle', body);
  name.focus();
}

function joinCircleSheet() {
  const body = el('div', {});
  const code = el('input', { placeholder: 'ABC123', maxlength: '6', autocapitalize: 'characters' });
  const submit = el('button', { class: 'primary' }, 'Join');
  submit.onclick = () =>
    guard(async () => {
      const { circle } = await api.joinCircle(code.value);
      sheet.remove();
      await refresh();
      notify('ok', 'Joined ' + circle.name + '.');
    });
  submitOnEnter(code, submit);
  body.append(el('label', { class: 'field-label' }, 'Invite code'), code, submit);
  const sheet = openSheet('Join a circle', body);
  code.focus();
}

/* -------------------------------- owed ------------------------------- */

function renderOwed(): HTMLElement {
  const wrap = el('div', {});
  const buckets = (state.tasks?.owed ?? []).filter((b) => b.posterId === state.userId);

  wrap.append(
    el(
      'p',
      { class: 'note' },
      'Approved favours are batched per person, so ten favours settle as one payment and one confirmation dialog.',
    ),
  );

  if (buckets.length === 0) {
    wrap.append(el('div', { class: 'card center' }, el('p', { class: 'muted' }, 'Nothing to settle.')));
    return wrap;
  }

  for (const bucket of buckets) {
    const card = el('div', { class: 'card' });
    card.append(
      el('div', { class: 'row' },
        el('h3', {}, nameOf(bucket.doerId)),
        el('span', { class: 'reward' }, formatUnits(bucket.assetKey, bucket.units) + ' ' + (ASSETS[bucket.assetKey]?.symbol ?? '')),
      ),
      el('p', { class: 'muted small' }, bucket.taskIds.length + ' approved favour' + (bucket.taskIds.length === 1 ? '' : 's')),
    );

    if (!bucket.payTo) {
      // Nothing the poster can do about this, so say so plainly rather than
      // offering a button that would pay the wrong wallet.
      card.append(
        el(
          'p',
          { class: 'note' },
          nameOf(bucket.doerId) +
            ' has not added a wallet address yet, so this cannot be paid. Ask them to open Favour Circle and connect a wallet.',
        ),
      );
      wrap.append(card);
      continue;
    }

    const payTo = bucket.payTo;
    card.append(el('p', { class: 'muted small mono break' }, 'to ' + payTo.address));

    const pay = el('button', { class: 'primary' }, 'Settle up');
    pay.onclick = () =>
      guard(async () => {
        const rail = pickRail(rails, bucket.assetKey);
        const { txHash } = await rail.pay({
          to: payTo.address,
          units: bucket.units,
          assetKey: bucket.assetKey,
          memo: 'Favour Circle: ' + bucket.taskIds.length + ' favours',
        });
        // The server re-derives this address and rejects a mismatch, so a bug
        // here cannot mark favours paid while the money went somewhere else.
        await api.settle(bucket.taskIds, rail.id, txHash, payTo.address);
        await refresh();
        notify('ok', 'Paid. ' + bucket.taskIds.length + ' favours settled in one transaction.');
      });
    card.append(pay);
    wrap.append(card);
  }

  return wrap;
}

/* ------------------------------- wallet ------------------------------ */

/**
 * Shown whenever the signed-in user has no payout address.
 *
 * Someone can onboard before connecting a wallet, do favours, get approved, and
 * then be unpayable. Surfacing it at the top of every tab is deliberate: it is
 * the one piece of setup that silently breaks the end of the loop.
 */
function walletPrompt(): HTMLElement | null {
  if (state.addresses.length > 0) return null;

  const card = el('div', { class: 'card' });
  card.append(
    el('h3', {}, 'Add a wallet to get paid'),
    el(
      'p',
      { class: 'muted small' },
      'You can post and approve favours without one, but nobody can pay you until this is set.',
    ),
  );

  const connect = el('button', { class: 'primary' }, 'Connect wallet');
  connect.onclick = () =>
    guard(async () => {
      const accounts = await wallet.getAccounts();
      const account = accounts[0];
      if (!account) throw new Error('No wallet account was offered.');
      const { user } = await api.setAddress(account.address, account.chain);
      state.addresses = user.addresses;
      await refresh();
      notify('ok', 'Wallet connected. You can be paid now.');
    });

  card.append(connect);
  return card;
}

/* ------------------------------- sharing ----------------------------- */

function shareSheet(title: string, url: string, subject: string) {
  const body = el('div', {});
  const caps = capabilities();
  const message = subject + ' — ' + url;

  const img = el('img', { class: 'qr', alt: 'QR code for ' + url });
  void qrDataUrl(url).then((data) => (img.src = data));
  body.append(img, el('p', { class: 'muted small center mono break' }, url));

  const buttons = el('div', { class: 'stack' });

  if (caps.webShare) {
    const share = el('button', { class: 'primary' }, 'Share…');
    share.onclick = async () => {
      const ok = await tryWebShare(title, subject, url);
      if (!ok) {
        share.remove();
        notify('error', 'Sharing is not available here. Use copy or SMS instead.');
      }
    };
    buttons.append(share);
  }

  if (caps.clipboard) {
    const copy = el('button', { class: 'primary' }, 'Copy link');
    copy.onclick = async () => {
      const ok = await copyToClipboard(url);
      notify(ok ? 'ok' : 'error', ok ? 'Link copied.' : 'Could not copy. Long-press the link above.');
    };
    buttons.append(copy);
  }

  if (caps.sms) {
    // A genuine anchor, not a scripted navigation. WKWebView blocks
    // location.href to non-http schemes but honours a tapped link — which is
    // why the same sms: URL works on the /diag page and did not here.
    const sms = el('a', { class: 'button ghost', href: smsHref(message) }, 'Send as a text');
    sms.addEventListener('click', () => {
      void watchSmsHandoff().then((opened) => {
        if (!opened) {
          sms.remove();
          notify('error', 'This app cannot open the messages composer. Use Copy link instead.');
        }
      });
    });
    buttons.append(sms);
  }

  body.append(buttons);

  // A localhost QR scans fine and then resolves to the phone itself, which looks
  // like a broken link rather than a configuration problem. Say so here.
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(origin)) {
    body.append(
      el(
        'p',
        { class: 'note' },
        'This is a localhost link, so it only works on this computer. Scanning it from a phone will fail. Expose the app on a public HTTPS URL to test invites or Nimiq Pay properly.',
      ),
    );
  }

  body.append(
    el(
      'p',
      { class: 'note' },
      'You choose who to send this to. The app never reads your contacts. Anyone opening the link sees the details in a browser, with no install needed.',
    ),
  );

  openSheet(title, body);
}

/* ------------------------------- routing ----------------------------- */

async function handleRoute() {
  const hash = location.hash.replace(/^#/, '');
  const join = hash.match(/^\/join\/([A-Z0-9]+)$/i);
  if (join && state.userId) {
    const code = join[1];
    if (code) {
      await guard(async () => {
        const { circle } = await api.joinCircle(code);
        await refresh();
        notify('ok', 'Joined ' + circle.name + '.');
      });
    }
    history.replaceState(null, '', location.pathname);
  }
  render();
}

/* ------------------------------- render ------------------------------ */

function render() {
  root.replaceChildren();

  if (!state.ready) {
    root.append(el('div', { class: 'card center' }, el('p', { class: 'muted' }, 'Loading…')));
    return;
  }

  if (!state.userId) {
    root.append(renderOnboarding(), appFooter());
    return;
  }

  const currencySelect = el('select', { class: 'currency', 'aria-label': 'Display currency' });
  for (const code of CURRENCIES) {
    const option = el('option', { value: code }, code);
    if (code === state.currency) option.setAttribute('selected', 'selected');
    currencySelect.append(option);
  }
  currencySelect.onchange = () => {
    state.currency = currencySelect.value as Currency;
    storeCurrency(state.currency);
    render();
  };

  const header = el('header', {},
    el('div', { class: 'brand' }, logoElement(24), el('h1', {}, 'Favour Circle')),
    el('div', { class: 'row', style: 'gap:10px' },
      el('span', { class: 'muted small' }, wallet.isReal ? 'Nimiq Pay' : 'Mock wallet'),
      currencySelect,
    ),
  );
  root.append(header);

  const tabs = el('nav', { class: 'tabs' });
  const owedCount = (state.tasks?.owed ?? []).filter((b) => b.posterId === state.userId).length;
  const defs: [State['tab'], string][] = [
    ['favours', 'Favours'],
    ['circles', 'Circles'],
    ['owed', owedCount ? 'Owed (' + owedCount + ')' : 'Owed'],
  ];
  for (const [id, label] of defs) {
    const tab = el('button', { class: 'tab' + (state.tab === id ? ' on' : '') }, label);
    tab.onclick = () => {
      state.tab = id;
      render();
    };
    tabs.append(tab);
  }
  root.append(tabs);

  const main = el('main', {});
  const prompt = walletPrompt();
  if (prompt) main.append(prompt);
  if (state.tab === 'favours') main.append(renderFavours());
  if (state.tab === 'circles') main.append(renderCircles());
  if (state.tab === 'owed') main.append(renderOwed());
  root.append(main);

  if (state.tab === 'favours' && state.circles.length > 0) {
    const fab = el('button', { class: 'fab', 'aria-label': 'Post a favour' }, '+');
    fab.onclick = postFavourSheet;
    root.append(fab);
  }

  root.append(appFooter());

  if (state.busy) root.append(el('div', { class: 'busy' }));
}

/* -------------------------------- boot ------------------------------- */

async function boot() {
  wallet = detectProvider();
  rails = railsFor(wallet);
  console.info('[favour-circle] wallet provider: %s', wallet.id);

  if (state.userId) {
    try {
      const { user } = await api.me();
      state.displayName = user.displayName;
      state.addresses = user.addresses;
      await refresh();
    } catch {
      // The stored id no longer resolves (fresh data file, new device).
      state.userId = null;
    }
  }

  // Rates are a nice-to-have: fire and forget, never block the first paint.
  void loadRates().then(() => render());

  state.ready = true;
  await handleRoute();
}

window.addEventListener('hashchange', () => void handleRoute());
void boot();
