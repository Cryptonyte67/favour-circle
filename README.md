# Favour Circle

Post a favour to your **family**, **friends** or **neighbours**. They do it,
you approve, they get paid — straight to their wallet, in one tap.

Live at **<https://app.favour-circle.workers.dev>**

30 second demo: <https://youtube.com/shorts/5uc5DPpibqE>

A Mini App for [Nimiq Pay](https://nimiq.dev/mini-apps/).

---

## Why payment is the app, not a button on it

A favour board without settlement is a to-do list. The thing that makes this work
is that approving a favour and paying for it are the same gesture. Nimiq Pay makes
sub-cent transfers viable at 0% platform fee, so "$2 to take the bins out" is a
real transaction instead of an IOU somebody settles later, somewhere else.

## The loop

```
post  ->  claim  ->  mark done  ->  approve  ->  settle
```

Every step is an entry in an append-only ledger. Task state is a projection over
those events, never a mutable row, which leaves disputes, reputation and audit
history available later at no cost now.

## Batched settlement

Nimiq Pay raises a **native confirmation dialog for every payment**. One dialog
per favour would make the app unusable.

So approved favours accumulate into one bucket per `(poster, doer, asset)`. Ten
approved favours settle as **one payment and one dialog**. This is the single most
important design decision in the codebase — see `owedBuckets()` in
`src/shared/events.ts`.

## Who gets paid

Each person registers a payout address **per chain**, so a NIM favour resolves to
their Nimiq address and a USDT favour would resolve to their EVM one. Owed buckets
carry that resolved address; if the doer has none, the bucket says so and offers
no button rather than paying the wrong wallet.

The client picks the address, and then **the server re-derives it and rejects any
mismatch**. Without that check a bug or a tampered client could mark favours paid
while the money went somewhere else — which is exactly the shape of bug that is
invisible until someone is out of pocket.

## Circles, not a public board

Favours are posted to circles you choose, typed `family` / `friends` /
`community`, and a favour can go to several at once.

Community circles are **join-by-code, not a public marketplace**. That is
deliberate. A public board between strangers needs escrow and dispute handling,
which this does not have, and it starts empty. A circle with four invited people
works on day one.

## Invites, and why there is no contact-list access

There is no phone-book integration, and there cannot be:

- The **Contact Picker API** is Chrome-on-Android only and is not exposed to
  WebViews. Reading contacts would need `READ_CONTACTS` in Nimiq Pay's manifest.
- **`navigator.share` does not work in Android WebView** either
  ([Chromium 765923](https://issues.chromium.org/issues/40570877)) unless the
  host app bridges it natively.

So `src/web/share.ts` probes capabilities at runtime and offers only what the
WebView actually supports, in order of reliability:

1. **QR code** — cannot fail, and favours are usually assigned in person anyway
2. **Copy link** — with an `execCommand` fallback
3. **SMS link** — `sms:?body=` / `sms:&body=`, user picks recipients
4. **`navigator.share`** — offered only if present, and withdrawn on first failure

In every route **the user chooses the recipient**. Harvesting contacts to
auto-text people is the growth pattern platforms ban, and unsolicited commercial
SMS carries real exposure under TCPA and GDPR.

## The invite link works without the app

`/t/:taskId` and `/join/:code` are **server-rendered pages that need no
JavaScript, no wallet and no Nimiq Pay install**. They carry OpenGraph tags so
the link unfurls in whatever messenger it was pasted into.

That is the growth loop: the *favour* spreads, not the app. Someone sees a real
favour with a real reward before anyone asks them to install anything.

## Payout rails

`src/web/rails/rail.ts` defines a `PayoutRail` interface with Nimiq as the only
implementation.

The interface exists because **fiat rails are blocked by licensing, not by
code**. GCash's API portal is partner-only and realistically needs a registered
Philippine entity through a gateway such as PayMongo or Xendit. PayPal Payouts
needs a verified Business account plus separate approval. And anything that
converts between crypto and fiat balances is money transmission, which needs
permission before it needs code.

**No unimplemented rail is claimed anywhere in the UI.** An honest abstraction
reads well; a broken button does not.

---

## Running it

Runs on **Cloudflare Workers with D1**. Local development uses the same runtime
(`workerd` via `wrangler dev`) and a local SQLite-backed D1, so there is no
second code path that can drift from production.

```bash
npm install
npm run db:local     # apply schema.sql to the local D1, once
npm run dev          # wrangler dev (:8787) + vite (:5173)
```

Then open <http://localhost:5173>.

**No wallet, no phone and no Nimiq Pay needed to develop.** If nothing is
injected, `MockProvider` takes over: fake accounts, deterministic signatures, and
simulated payments with a realistic delay so pending states get exercised. The
real provider wins automatically when Nimiq Pay is present, and nothing in the
views knows which is live.

```bash
npm run typecheck   # tsc, zero errors
npm run smoke       # 28 end-to-end assertions against a running server
npm run build       # -> dist/web
npm start           # serves API + built client on one origin
```

`npm run smoke` needs `npm run dev` running in another terminal. It drives two
users through the whole loop and checks every guard that protects money — who
may claim, who may approve, and whether a payment can be recorded against an
address that is not the doer's.

### Testing as two people

The mock wallet derives a stable address per browser profile, so a normal window
and an incognito window are two genuinely different users. Sign in as one, copy
an invite link from **Circles → Invite someone**, and open it in the other.

### A dev-server trap worth knowing

`src/web/api.ts` is served at `/api.ts` in development, which collides with a
bare `'/api'` proxy key — Vite prefix-matches, forwards the module to the
backend, and the page dies on a MIME type error while every request still shows
200. Both proxy rules in `vite.config.ts` are therefore anchored (`'^/api/'`,
`'^/(t|join)/'`). It never reproduces in production, where the file is bundled
and that request is never made.

### Deploying

```bash
npx wrangler login
npx wrangler d1 create favour-circle    # paste the database_id into wrangler.toml
npm run db:remote                      # apply the schema to the real database
npm run deploy
```

Then set `APP_URL` in `wrangler.toml` to the deployed origin and redeploy —
**Nimiq Pay deeplinks are built from it**, and left as localhost they are
syntactically valid and useless on a phone.

### Configuration

| Where | Key | Notes |
|---|---|---|
| `wrangler.toml` `[vars]` | `APP_URL` | Must be the real HTTPS origin in production |
| `wrangler.toml` `[[d1_databases]]` | `database_id` | From `wrangler d1 create` |
| `wrangler.toml` `[assets]` | `run_worker_first` | Paths the Worker owns. **Add a route here whenever you add one to the Worker**, or the static-asset handler shadows it and silently serves the app shell |

### Two configuration traps, both found the hard way

`src/web/api.ts` is served at `/api.ts` in development, which collides with a
bare `'/api'` Vite proxy key — it prefix-matches, forwards the module to the
backend, and the page dies on a MIME type error while every request still shows
200. The proxy rules in `vite.config.ts` are therefore all anchored.

The Worker's `notFound` handler originally served the app shell so client-side
routes would survive a refresh. That turned every dead invite link into a 200
serving the app — the smoke test caught it. The asset handler already does SPA
fallback, so the Worker returns real 404s.

---

## Known limitations

Stated plainly, because the competition asks for something that works on first
use and this is what "works" currently means.

- **Signatures are stored but not verified server-side.** The "mark done"
  attestation is recorded in the ledger and never checked. Fine among people who
  know each other; not fine for strangers. **This is the first thing to fix
  before real money.**
- **Identity is a bearer user id** issued on first connect, held in
  `localStorage`. There is no auth.
- **VERIFY THE USDT CONTRACT ADDRESS** in `src/shared/types.ts` against a block
  explorer before moving real money. Nimiq Pay holds USDT on **Polygon** (not
  Base — an earlier version of this file had that wrong), and a wrong token
  contract sends funds somewhere unrecoverable.
- **The ERC-20 path is unverified against a real wallet.** The encoding is
  standard, but how Nimiq Pay's injected provider handles
  `wallet_switchEthereumChain` and `eth_sendTransaction` is untested. Run
  `/diag` on a device first.
- **Fiat conversion is indicative only.** Rates come from CoinGecko at display
  time and are never stored; the rate at settlement will differ from the rate at
  posting. USD is deliberately suppressed for USDT — a stablecoin quoted in
  dollars tells the reader nothing.
- **Only NIM is proven to settle.** USDT is modelled throughout — assets carry their chain
  and decimals — but `sendPayment` deliberately throws for ERC-20 rather than
  failing quietly.
- **Task visibility is computed by replaying events per request.** Fine at this
  size; a projection table is the next step if a circle ever gets large.
- **Untested inside real Nimiq Pay.** Verified against the mock provider only.

## Before submitting

- [ ] **Submit the app for listing.** Nimiq Pay does not appear to embed an
      unlisted mini app — it opens it in the browser instead, so no wallet is
      injected and the payment path cannot be exercised. This blocks everything
      below it.
- [ ] Run the in-app diagnostics inside Nimiq Pay once listed. The banner must
      read green; a report without `ranInsideApp` and a non-Safari user agent
      did not measure the app's own context.
- [x] ~~Remove the diagnostics endpoints before submitting.~~ Done. `POST
      /api/diag` and `/diag/results` are gone, along with the `diagnostics`
      table. The probe still runs, but it only draws its report on screen:
      screenshot it. Sending it needed a public unauthenticated write endpoint,
      which has no business in a deployed app for the sake of saving a
      screenshot.
- [ ] Verify signatures server-side
- [ ] Deploy to HTTPS and set `APP_URL`
- [ ] Public GitHub repo, MIT (already licensed)

## Licence

MIT — see [LICENSE](LICENSE).
