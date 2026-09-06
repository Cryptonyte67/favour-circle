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
 *     null and the UI simply omits the line. Reliability is 45 points; a price
 *     API must never be able to stop a chore from rendering.
 *  3. **USD is not offered for USDT.** A stablecoin priced in dollars reads
 *     "1.00 USDT ≈ $1.00", which is noise. The value is in local currency.
 */

import { ASSETS } from '../shared/types.js';
import { formatUnits } from '../shared/money.js';

const ENDPOINT = 'https://api.coingecko.com/api/v3/simple/price';
const CACHE_KEY = 'chore-circle:rates';
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
    const value = localStorage.getItem('chore-circle:currency');
    return CURRENCIES.includes(value as Currency) ? (value as Currency) : null;
  } catch {
    return null;
  }
}

export function storeCurrency(currency: Currency): void {
  try {
    localStorage.setItem('chore-circle:currency', currency);
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
      return body;
    } catch (err) {
      console.warn('[prices] unavailable, continuing without fiat', err);
      return cached?.rates ?? null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * "≈ ₱78.33", or null when there is nothing trustworthy to show.
 *
 * Returns null for USDT priced in USD: a stablecoin quoted in dollars tells the
 * reader nothing they did not already know.
 */
export function approxFiat(assetKey: string, units: string, currency: Currency): string | null {
  const spec = ASSETS[assetKey];
  const id = COINGECKO_IDS[assetKey];
  if (!spec || !id) return null;
  if (id === 'tether' && currency === 'USD') return null;

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
