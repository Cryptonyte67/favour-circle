/**
 * Capability probe that runs *inside* the app.
 *
 * There is a standalone /diag page, and it turned out to be the wrong tool:
 * tapping a link inside Nimiq Pay's WebView hands the URL to Safari, so the
 * page always reported "no wallet" no matter how it was reached. The context we
 * need to measure is the one the app itself runs in, so the probe has to live
 * in the app and never navigate.
 *
 * Everything here is defensive. This is diagnostic code running in an unknown
 * environment; it must never throw, and a failed probe must still produce a
 * readable answer.
 */

import type { WalletProvider } from './nimiq/provider.js';

export interface DiagnosticsReport {
  [key: string]: unknown;
}

function methodsOf(target: unknown): string[] | null {
  if (!target || typeof target !== 'object') return null;
  const found: string[] = [];
  const record = target as Record<string, unknown>;
  for (const key in record) {
    try {
      if (typeof record[key] === 'function') found.push(key);
    } catch {
      // Some injected providers throw on property access.
    }
  }
  try {
    const proto = Object.getPrototypeOf(record) as object | null;
    if (proto) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        try {
          if (typeof (record as Record<string, unknown>)[key] === 'function' && !found.includes(key)) {
            found.push(key);
          }
        } catch {
          // Ignore accessors that throw.
        }
      }
    }
  } catch {
    // Prototype unavailable.
  }
  return found.sort();
}

/** Collected without any user interaction. */
export function passiveReport(): DiagnosticsReport {
  const nav = navigator as Navigator & { vendor?: string; platform?: string };
  const anyWindow = window as unknown as { nimiq?: unknown; ethereum?: unknown };

  let locale: string | null = null;
  let region: string | null = null;
  try {
    locale = navigator.language;
    region = new Intl.Locale(navigator.language).region ?? null;
  } catch {
    region = 'unavailable';
  }

  let storage = false;
  try {
    localStorage.setItem('_d', '1');
    localStorage.removeItem('_d');
    storage = true;
  } catch {
    storage = false;
  }

  return {
    ranInsideApp: true,
    userAgent: navigator.userAgent,
    vendor: nav.vendor ?? null,
    platform: nav.platform ?? null,
    maxTouchPoints: navigator.maxTouchPoints,
    viewport: window.innerWidth + 'x' + window.innerHeight,
    origin: location.origin,
    secureContext: isSecureContext,
    locale,
    region,
    localStorage: storage,
    hasShare: typeof navigator.share === 'function',
    hasClipboard: !!navigator.clipboard?.writeText,
    nimiq: { present: !!anyWindow.nimiq, methods: methodsOf(anyWindow.nimiq) },
    ethereum: { present: !!anyWindow.ethereum, methods: methodsOf(anyWindow.ethereum) },
  };
}

/** True when a wallet was injected — the only thing that makes a run useful. */
export function walletDetected(): boolean {
  const anyWindow = window as unknown as { nimiq?: unknown; ethereum?: unknown };
  return !!(anyWindow.nimiq || anyWindow.ethereum);
}

export async function probeWallet(wallet: WalletProvider): Promise<DiagnosticsReport> {
  const out: DiagnosticsReport = { provider: wallet.id, isReal: wallet.isReal };
  try {
    out.accounts = await wallet.getAccounts();
  } catch (err) {
    out.accounts = 'ERROR: ' + (err as Error).message;
  }
  try {
    const signature = await wallet.signMessage('favour-circle diagnostic ' + Date.now());
    out.signature = signature ? String(signature).slice(0, 200) : null;
  } catch (err) {
    out.signature = 'ERROR: ' + (err as Error).message;
  }
  return out;
}

export async function probePriceApi(): Promise<DiagnosticsReport> {
  const url =
    'https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2,tether' +
    '&vs_currencies=usd,eur,gbp,php,aud,cad,inr,brl,ngn';
  const started = Date.now();
  try {
    const res = await fetch(url);
    const body = await res.text();
    return { ms: Date.now() - started, status: res.status, body: body.slice(0, 160) };
  } catch (err) {
    return { blocked: (err as Error).name + ': ' + (err as Error).message };
  }
}

export async function probeClipboard(): Promise<string> {
  try {
    await navigator.clipboard.writeText('favour-circle-test');
    return 'worked';
  } catch (err) {
    return 'failed: ' + (err as Error).message;
  }
}

export async function probeShare(): Promise<string> {
  if (typeof navigator.share !== 'function') return 'absent';
  try {
    await navigator.share({ title: 'Favour Circle', text: 'test', url: location.origin });
    return 'worked';
  } catch (err) {
    return (err as Error).name + ': ' + (err as Error).message;
  }
}

export async function sendReport(report: DiagnosticsReport): Promise<string> {
  try {
    const res = await fetch('/api/diag', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    });
    return res.ok ? 'Sent — open /diag/results on your computer.' : 'Failed: HTTP ' + res.status;
  } catch (err) {
    return 'Failed: ' + (err as Error).message;
  }
}
