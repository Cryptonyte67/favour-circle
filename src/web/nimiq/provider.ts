/**
 * Wallet access, behind one interface with two implementations.
 *
 * NimiqPayProvider talks to the real injected providers. MockProvider fakes
 * them so the entire app runs in a normal desktop browser with no wallet, no
 * funds and no phone. Detection is automatic: if Nimiq Pay injected anything,
 * the real one wins.
 *
 * Everything the UI does goes through this interface, so nothing in the views
 * knows which one is live.
 */

import type { AssetSpec, Chain } from '../../shared/types.js';
import { assetOf } from '../../shared/money.js';

export interface WalletAccount {
  chain: Chain;
  address: string;
  label?: string;
}

export interface PaymentRequest {
  to: string;
  /** Integer minor units. */
  units: string;
  assetKey: string;
  memo?: string;
}

export interface PaymentResult {
  txHash: string;
}

export interface WalletProvider {
  readonly id: 'nimiq-pay' | 'mock';
  readonly isReal: boolean;
  getAccounts(): Promise<WalletAccount[]>;
  signMessage(message: string): Promise<string | null>;
  sendPayment(request: PaymentRequest): Promise<PaymentResult>;
}

/** Shape of what Nimiq Pay injects. Kept loose on purpose. */
interface InjectedNimiq {
  isConsensusEstablished?(): Promise<boolean>;
  getBlockNumber?(): Promise<number>;
  requestAccounts?(): Promise<string[]>;
  signMessage?(message: string): Promise<string>;
  sendTransaction?(tx: { recipient: string; value: string; extraData?: string }): Promise<string>;
}

interface InjectedEthereum {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    nimiq?: InjectedNimiq;
    ethereum?: InjectedEthereum;
  }
}

export function detectProvider(): WalletProvider {
  if (typeof window !== 'undefined' && (window.nimiq || window.ethereum)) {
    return new NimiqPayProvider();
  }
  return new MockProvider();
}

/* -------------------------------------------------------------------- */

export class NimiqPayProvider implements WalletProvider {
  readonly id = 'nimiq-pay' as const;
  readonly isReal = true;

  async getAccounts(): Promise<WalletAccount[]> {
    const out: WalletAccount[] = [];

    if (window.nimiq?.requestAccounts) {
      try {
        for (const address of await window.nimiq.requestAccounts()) {
          out.push({ chain: 'nimiq', address });
        }
      } catch (err) {
        console.warn('[wallet] nimiq.requestAccounts failed', err);
      }
    }

    if (window.ethereum) {
      try {
        const accounts = (await window.ethereum.request({
          method: 'eth_requestAccounts',
        })) as string[];
        for (const address of accounts) out.push({ chain: 'base', address });
      } catch (err) {
        console.warn('[wallet] eth_requestAccounts failed', err);
      }
    }

    return out;
  }

  async signMessage(message: string): Promise<string | null> {
    // Signing is optional everywhere it is used: it strengthens the audit trail
    // but must never block someone from marking a favour done.
    try {
      if (window.nimiq?.signMessage) return await window.nimiq.signMessage(message);
      if (window.ethereum) {
        const accounts = (await window.ethereum.request({ method: 'eth_accounts' })) as string[];
        const from = accounts[0];
        if (!from) return null;
        return (await window.ethereum.request({
          method: 'personal_sign',
          params: [message, from],
        })) as string;
      }
    } catch (err) {
      console.warn('[wallet] signMessage declined or failed', err);
    }
    return null;
  }

  async sendPayment(request: PaymentRequest): Promise<PaymentResult> {
    const asset = assetOf(request.assetKey);

    if (asset.chain === 'nimiq') {
      if (!window.nimiq?.sendTransaction) {
        throw new Error('This wallet cannot send NIM.');
      }
      const txHash = await window.nimiq.sendTransaction({
        recipient: request.to,
        value: request.units,
        extraData: request.memo,
      });
      return { txHash };
    }

    return this.sendErc20(asset, request);
  }

  /**
   * ERC-20 transfer through the injected EIP-1193 provider.
   *
   * The encoding here is standard and provider-independent. What is *not* yet
   * verified is how Nimiq Pay's injected provider behaves — whether it honours
   * wallet_switchEthereumChain, and what it returns from eth_sendTransaction.
   * Run /diag on a real device before trusting this path with real funds.
   */
  private async sendErc20(asset: AssetSpec, request: PaymentRequest): Promise<PaymentResult> {
    const eth = window.ethereum;
    if (!eth) throw new Error('No EVM wallet is available for ' + asset.symbol + '.');
    if (!asset.contract || !asset.chainIdHex) {
      throw new Error(asset.key + ' is missing its contract or chain id.');
    }

    // The wallet may be sitting on a different chain. Ask, and fail with
    // something readable rather than sending on the wrong network.
    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: asset.chainIdHex }],
      });
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 4902) {
        throw new Error(asset.chain + ' is not available in this wallet.');
      }
      // Some providers reject the call yet are already on the right chain, so
      // carry on and let the chain id check below be the authority.
      console.warn('[wallet] wallet_switchEthereumChain failed', err);
    }

    const chainId = (await eth.request({ method: 'eth_chainId' })) as string;
    if (chainId?.toLowerCase() !== asset.chainIdHex.toLowerCase()) {
      throw new Error(
        'Wallet is on chain ' + chainId + ', not ' + asset.chain + '. Switch and try again.',
      );
    }

    const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
    const from = accounts[0];
    if (!from) throw new Error('No EVM account is available to pay from.');

    const txHash = (await eth.request({
      method: 'eth_sendTransaction',
      params: [{ from, to: asset.contract, data: encodeErc20Transfer(request.to, request.units) }],
    })) as string;

    return { txHash };
  }
}

/** ERC-20 transfer(address,uint256) calldata. */
export function encodeErc20Transfer(to: string, units: string): string {
  const selector = 'a9059cbb';
  const address = to.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(address)) {
    throw new Error('That does not look like an EVM address: ' + to);
  }
  const amount = BigInt(units).toString(16);
  if (amount.length > 64) throw new Error('Amount is too large to encode.');
  return '0x' + selector + address.padStart(64, '0') + amount.padStart(64, '0');
}

/* -------------------------------------------------------------------- */

const MOCK_ADDRESS_KEY = 'favour-circle:mock-address';

/**
 * A stable per-browser mock address.
 *
 * A single hardcoded constant would hand every test user the same wallet, which
 * makes payout routing impossible to exercise: everyone would appear to be
 * paying themselves. Two browser profiles now get two distinct addresses, so the
 * doer-address wiring can actually be tested without a phone.
 */
function mockAddress(): string {
  try {
    const existing = localStorage.getItem(MOCK_ADDRESS_KEY);
    if (existing) return existing;
  } catch {
    // Storage unavailable; fall through and generate an ephemeral one.
  }
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let body = '';
  for (let i = 0; i < 32; i++) {
    if (i > 0 && i % 4 === 0) body += ' ';
    body += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  const address = 'NQ07 ' + body;
  try {
    localStorage.setItem(MOCK_ADDRESS_KEY, address);
  } catch {
    // Ephemeral for this load only.
  }
  return address;
}

export class MockProvider implements WalletProvider {
  readonly id = 'mock' as const;
  readonly isReal = false;

  async getAccounts(): Promise<WalletAccount[]> {
    return [{ chain: 'nimiq', address: mockAddress(), label: 'Mock wallet' }];
  }

  async signMessage(message: string): Promise<string> {
    // Not cryptography. A deterministic stand-in so the ledger has something to
    // store and the real implementation has a shape to match.
    let hash = 0;
    for (let i = 0; i < message.length; i++) {
      hash = (hash * 31 + message.charCodeAt(i)) | 0;
    }
    return `mocksig:${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  async sendPayment(request: PaymentRequest): Promise<PaymentResult> {
    // A real confirmation dialog takes a beat; imitate it so the UI's pending
    // states get exercised during development instead of only in production.
    await new Promise((resolve) => setTimeout(resolve, 600));
    const rand = Math.random().toString(16).slice(2, 10);
    console.info('[mock wallet] paid %s %s to %s', request.units, request.assetKey, request.to);
    return { txHash: `mocktx:${rand}` };
  }
}
