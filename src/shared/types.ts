/**
 * Domain types shared by the server and the web client.
 *
 * Design rules that are cheap now and expensive to retrofit:
 *  - Roles are generic ("poster" / "doer"), never "parent" / "child".
 *  - Money is integer minor units carried as a string, never a float.
 *  - Every amount records its asset AND chain.
 *  - A user has a stable internal id; wallet addresses hang off it.
 */

export type Id = string;

/** Chains the Nimiq Pay mini-app framework can reach. */
export type Chain =
  | 'nimiq'
  | 'ethereum'
  | 'polygon'
  | 'base'
  | 'arbitrum'
  | 'optimism'
  | 'bnb'
  | 'sepolia';

export interface AssetSpec {
  /** Stable key, e.g. "NIM" or "USDT@polygon". */
  key: string;
  symbol: string;
  chain: Chain;
  decimals: number;
  /** EVM only: chain id as hex, for wallet_switchEthereumChain. */
  chainIdHex?: string;
  /** EVM only: ERC-20 contract. Absent means the chain's native coin. */
  contract?: string;
}

/**
 * Nimiq Pay holds USDT on **Polygon**, not Base. The mini-app docs list Base,
 * Arbitrum, Optimism, BNB and Sepolia as reachable EVM chains and then name
 * "USDT on Polygon" specifically, which is easy to misread — an earlier version
 * of this file had the asset on Base, which would have addressed a token the
 * wallet does not hold.
 *
 * VERIFY THE CONTRACT ADDRESS BELOW against a block explorer before moving real
 * money. It is the widely used USDT (PoS) address on Polygon, but a wrong token
 * contract sends funds somewhere unrecoverable, so do not take it on trust from
 * this comment.
 */
export const ASSETS: Record<string, AssetSpec> = {
  NIM: { key: 'NIM', symbol: 'NIM', chain: 'nimiq', decimals: 5 },
  'USDT@polygon': {
    key: 'USDT@polygon',
    symbol: 'USDT',
    chain: 'polygon',
    decimals: 6,
    chainIdHex: '0x89',
    contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  },
};

/** Assets a favour can be priced in, in the order shown to the user. */
export const SELECTABLE_ASSET_KEYS = ['NIM', 'USDT@polygon'];

export const DEFAULT_ASSET_KEY = 'NIM';

/** An amount in integer minor units. units is a base-10 integer string. */
export interface Money {
  assetKey: string;
  units: string;
}

export interface WalletAddress {
  chain: Chain;
  address: string;
}

export interface User {
  id: Id;
  displayName: string;
  addresses: WalletAddress[];
  createdAt: number;
}

/** The three posting destinations. Community is join-by-code, not a public board. */
export type CircleKind = 'family' | 'friends' | 'community';

export const CIRCLE_KINDS: CircleKind[] = ['family', 'friends', 'community'];

export interface Circle {
  id: Id;
  kind: CircleKind;
  name: string;
  inviteCode: string;
  createdBy: Id;
  createdAt: number;
}

export interface Membership {
  circleId: Id;
  userId: Id;
  joinedAt: number;
}

export type TaskStatus =
  | 'open'
  | 'claimed'
  | 'submitted'
  | 'approved'
  | 'settled'
  | 'cancelled';

export interface Task {
  id: Id;
  title: string;
  detail: string;
  reward: Money;
  posterId: Id;
  doerId: Id | null;
  /** A favour can be posted to several circles at once. */
  circleIds: Id[];
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  /** Signature over the "done" attestation, when the doer wallet provided one. */
  doneSignature: string | null;
  /** Set once a payout rail has settled this task. */
  settlement: { railId: string; txHash: string; paidTo: string; at: number } | null;
}

/* ------------------------------------------------------------------ */
/* Append-only event ledger. Task state is derived by replaying these. */
/* ------------------------------------------------------------------ */

interface EventBase {
  id: Id;
  taskId: Id;
  actorId: Id;
  at: number;
}

export type TaskEvent =
  | (EventBase & {
      type: 'task.created';
      title: string;
      detail: string;
      reward: Money;
      circleIds: Id[];
    })
  | (EventBase & { type: 'task.claimed' })
  | (EventBase & { type: 'task.submitted'; signature: string | null })
  | (EventBase & { type: 'task.approved' })
  | (EventBase & { type: 'task.settled'; railId: string; txHash: string; paidTo: string })
  | (EventBase & { type: 'task.cancelled'; reason: string });

export type TaskEventType = TaskEvent['type'];

/** One person unsettled total in a single asset, owed by one poster. */
export interface OwedBucket {
  posterId: Id;
  doerId: Id;
  assetKey: string;
  units: string;
  taskIds: Id[];
}

/**
 * An owed bucket with the doer's payout address resolved for the bucket's own
 * chain. `payTo` is null when the doer has not registered an address that can
 * receive this asset, which is a blocking condition the poster cannot fix — the
 * UI says so rather than silently paying the wrong wallet.
 */
export interface ResolvedOwedBucket extends OwedBucket {
  payTo: WalletAddress | null;
}
