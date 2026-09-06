/**
 * Payout rails.
 *
 * Nimiq is the only implementation and the only one this competition entry
 * needs. The interface exists because fiat rails (PayPal, GCash) are blocked by
 * licensing rather than by code: they need a registered business entity and, for
 * anything that converts between crypto and fiat balances, money-transmission
 * permission. When that exists, a new rail slots in here and nothing else in the
 * app changes.
 *
 * Do not claim rails that are not implemented. An honest abstraction reads well;
 * a broken button does not.
 */

import type { WalletProvider } from '../nimiq/provider.js';

export interface PayoutRequest {
  to: string;
  units: string;
  assetKey: string;
  memo?: string;
}

export interface PayoutRail {
  readonly id: string;
  readonly label: string;
  readonly available: boolean;
  supports(assetKey: string): boolean;
  pay(request: PayoutRequest): Promise<{ txHash: string }>;
}

export class NimiqRail implements PayoutRail {
  readonly id = 'nimiq';
  readonly label = 'Nimiq Pay';

  constructor(private readonly wallet: WalletProvider) {}

  get available(): boolean {
    return true;
  }

  supports(assetKey: string): boolean {
    return assetKey === 'NIM' || assetKey.startsWith('USDT');
  }

  pay(request: PayoutRequest): Promise<{ txHash: string }> {
    return this.wallet.sendPayment(request);
  }
}

export function railsFor(wallet: WalletProvider): PayoutRail[] {
  return [new NimiqRail(wallet)];
}

export function pickRail(rails: PayoutRail[], assetKey: string): PayoutRail {
  const rail = rails.find((r) => r.available && r.supports(assetKey));
  if (!rail) throw new Error('No payout rail can send ' + assetKey);
  return rail;
}
