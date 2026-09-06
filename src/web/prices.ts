/**
 * Indicative fiat conversion.
 *
 * Three rules this module exists to enforce:
 *
 *  1. **Fiat is never stored.** A reward is denominated in NIM or USDT and the
 *     ledger records only that. Fiat is computed at display time and shown with
 *     a "≈", because the rate at settlement will not be the rate at posting.
 *  2. **It can never break the app.** This is a network call inside a WebView
 *     that may not permit outbound fetches at all. Every failure path returns
 *     null and the UI carries on. Reliability is 45 points; a price API must
 *     never be able to stop a favour from rendering.
 *  3. **Failure is visible, not silent.** A blocked fetch used to render an
 *     empty space, which is indistinguishable from having no feature at all —
 *     and that is exactly how it got reported. `ratesAreUnavailable()` lets the
 *     UI say so.
 */

import { ASSETS } from '../shared/types.js';
import { formatUnits } from '../shared/money.js';

const ENDPOINT = 'https://api.coingecko.com/api/v3/simple/price';
const CACHE_KEY = 'favour-circle:rates';
const CACHE_TTL_MS = 10 * 60 * 1000;

/** CoinGecko ids for the assets we price. */
const COINGECKO_IDS: Record<string, string> = {
  NIM: 'nimiq-2',
  'USDT@polygon': 'tether',
};

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'PHP', 'AUD', 'CAD', 'INR', 'BRL', 'NGN'] as const;
export type Currency = (typeof CURRENCIES)[number];

type RateTable = Record<string, Record<string, number>>;

interface CachedRates {
  at: number;
  rates: RateTable;
}

let memory: CachedRates | null = null;
let inFlight: Promise<RateTable | null> | null = null;

/** Best guess at the viewer's currency from their locale, defaulting to USD. */
export function detectCurrency(): Currency {
  const stored = readStoredCurrency();
  if (stored) return stored;
  try {
    const region = new Intl.Locale(navigator.language).region;
    const byRegion: Record<string, Currency> = {
      US: 'USD', GB: 'GBP', PH: 'PHP', AU: 'AUD', CA: 'CAD',
      IN: 'INR', BR: 'BRL', NG: 'NGN',
      DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR', PT: 'EUR', AT: 'EUR',
    };
    if (region && byRegion[region]) return byRegion[region];
  } catch {
    // Intl.Locale is unavailable or the tag is malformed; fall through.
  }
  return 'USD';
}

function readStoredCurrency(): Currency | null {
  try {
    const value = localStorage.getItem('favour-circle:currency');
    return CURRENCIES.includes(value as Currency) ? (value as Currency) : null;
  } catch {
    return null;
  }
}

export function storeCurrency(currency: Currency): void {
  try {
    localStorage.setItem('favour-circle:currency', currency);
  } catch {
    // Not important enough to surface.
  }
}

function readCache(): CachedRates | null {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRates;
    if (parsed && typeof parsed.at === 'number' && parsed.rates) {
      memory = parsed;
      return parsed;
    }
  } catch {
    // Corrupt or unavailable; treat as absent.
  }
  return null;
}

function writeCache(rates: RateTable): void {
  memory = { at: Date.now(), rates };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(memory));
  } catch {
    // Memory cache still serves this session.
  }
}

/**
 * Load rates, preferring a fresh cache.
 *
 * A stale cache beats no prices at all, so on a failed fetch the old table is
 * kept and returned rather than discarded.
 */
export async function loadRates(): Promise<RateTable | null> {
  const cached = readCache();
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rates;
  if (inFlight) return inFlight;

  const ids = [...new Set(Object.values(COINGECKO_IDS))].join(',');
  const vs = CURRENCIES.join(',').toLowerCase();
  const url = `${ENDPOINT}?ids=${ids}&vs_currencies=${vs}`;

  inFlight = (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error('rates ' + res.status);
      const body = (await res.json()) as RateTable;
      writeCache(body);
      ratesUnavailable = false;
      return body;
    } catch (err) {
      // Silence here was the problem: a blocked fetch inside a WebView looked
      // identical to "this app has no conversion feature".
      console.warn('[prices] unavailable, continuing without fiat', err);
      ratesUnavailable = true;
      return cached?.rates ?? null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** True once a rate load has been attempted and produced nothing usable. */
let ratesUnavailable = false;

export function ratesAreUnavailable(): boolean {
  return ratesUnavailable && !readCache();
}

/**
 * "≈ ₱78.33", or null when there is no rate to work from.
 *
 * An earlier version suppressed USDT priced in USD on the grounds that "≈ $1.00"
 * for a dollar stablecoin tells the reader nothing. That was clever and wrong:
 * to anyone whose currency resolves to USD it just looks like the converter is
 * broken, which is precisely how it was reported. Predictable beats clever, so
 * it now converts everything.
 */
/** The rate for one unit of `assetKey` in `currency`, or null if unknown. */
export function rateFor(assetKey: string, currency: Currency): number | null {
  const id = COINGECKO_IDS[assetKey];
  if (!id) return null;
  const rate = readCache()?.rates?.[id]?.[currency.toLowerCase()];
  return typeof rate === 'number' && isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * Convert an amount typed in fiat into a decimal amount of `assetKey`.
 *
 * Returns a string with exactly the asset's precision, ready for parseDecimal.
 * The favour is still denominated in crypto — this only decides the number. The
 * rate at settlement will differ from the rate now, which is why fiat entry is
 * pinned to a stablecoin rather than to NIM.
 */
export function fiatToAssetAmount(
  assetKey: string,
  fiat: string,
  currency: Currency,
): string | null {
  const spec = ASSETS[assetKey];
  const rate = rateFor(assetKey, currency);
  if (!spec || rate === null) return null;
  const value = Number(fiat);
  if (!isFinite(value) || value <= 0) return null;
  return (value / rate).toFixed(spec.decimals);
}

export function approxFiat(assetKey: string, units: string, currency: Currency): string | null {
  const spec = ASSETS[assetKey];
  const id = COINGECKO_IDS[assetKey];
  if (!spec || !id) return null;

  const rates = readCache()?.rates;
  const rate = rates?.[id]?.[currency.toLowerCase()];
  if (typeof rate !== 'number' || !isFinite(rate) || rate <= 0) return null;

  const amount = Number(formatUnits(assetKey, units)) * rate;
  if (!isFinite(amount)) return null;

  try {
    return (
      '≈ ' +
      new Intl.NumberFormat(navigator.language || 'en', {
        style: 'currency',
        currency,
        maximumFractionDigits: amount < 1 ? 4 : 2,
      }).format(amount)
    );
  } catch {
    return '≈ ' + amount.toFixed(2) + ' ' + currency;
  }
}
