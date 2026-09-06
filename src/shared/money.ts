/**
 * Integer-minor-unit money helpers.
 *
 * Every amount is a base-10 integer string of minor units (luna for NIM,
 * 6-decimal units for USDT). Floats never touch a balance. Retrofitting this
 * later would corrupt any history already written, so it is here from commit 1.
 */

import { ASSETS, type AssetSpec, type Money } from './types.js';

export function assetOf(assetKey: string): AssetSpec {
  const spec = ASSETS[assetKey];
  if (!spec) throw new Error('Unknown asset: ' + assetKey);
  return spec;
}

export function money(assetKey: string, units: string | bigint): Money {
  return { assetKey, units: BigInt(units).toString() };
}

export function addUnits(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

export function isPositive(units: string): boolean {
  return BigInt(units) > 0n;
}

/** "12.5" NIM becomes "1250000" luna. Rejects excess precision. */
export function parseDecimal(assetKey: string, input: string): string {
  const spec = assetOf(assetKey);
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error('Enter a positive number, for example 2.50');
  }
  const parts = trimmed.split('.');
  const whole = parts[0] || '0';
  const frac = parts[1] || '';
  if (frac.length > spec.decimals) {
    throw new Error(spec.symbol + ' allows at most ' + spec.decimals + ' decimal places');
  }
  const padded = frac.padEnd(spec.decimals, '0');
  return (BigInt(whole) * 10n ** BigInt(spec.decimals) + BigInt(padded || '0')).toString();
}

/** "1250000" luna becomes "12.5". Trailing zeros trimmed, never rounded. */
export function formatUnits(assetKey: string, units: string): string {
  const spec = assetOf(assetKey);
  const negative = units.startsWith('-');
  const abs = BigInt(negative ? units.slice(1) : units);
  const base = 10n ** BigInt(spec.decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(spec.decimals, '0').replace(/0+$/, '');
  const sign = negative ? '-' : '';
  return sign + whole.toString() + (frac ? '.' + frac : '');
}

export function formatMoney(m: Money): string {
  return formatUnits(m.assetKey, m.units) + ' ' + assetOf(m.assetKey).symbol;
}
