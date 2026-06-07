/**
 * Anchor event decoder for all Parquet event types.
 *
 * Decodes base64-encoded program log lines produced by Anchor's #[event] macro.
 * Uses SHA-256 discriminators matching the indexer pattern ("event:EventName").
 *
 * Each event log line in `logs.logs` has the form:
 *   "Program log: <base64>"
 * Strip the "Program log: " prefix, then pass the base64 remainder to
 * decodeAnchorEvent().
 */

import { PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import type {
  PositionOpenedEvent,
  PositionClosedEvent,
  LiquidatedEvent,
  BadDebtEvent,
  FundingUpdatedEvent,
  EnqueuedEvent,
  HarvestedEvent,
  EntryVoidedEvent,
  SideBucketCreditedEvent,
  QueueDrainedEvent,
  PhantomCreditDrainedEvent,
  FeesSweptEvent,
  FeesDistributedEvent,
  TreasuryWithdrawalEvent,
  StakedEvent,
  UnstakedEvent,
  RewardClaimedEvent,
  RewardIndexUpdatedEvent,
  CompoundedRewardEvent,
  Side,
} from "../types";

// ---------------------------------------------------------------------------
// Discriminator helpers (event: prefix, not account:)
// ---------------------------------------------------------------------------

function sha256Disc(name: string): Buffer {
  return createHash("sha256").update(name).digest().subarray(0, 8) as Buffer;
}

const EVENT_DISCS = {
  PositionOpened:       sha256Disc("event:PositionOpened"),
  PositionClosed:       sha256Disc("event:PositionClosed"),
  Liquidated:           sha256Disc("event:Liquidated"),
  BadDebt:              sha256Disc("event:BadDebt"),
  FundingUpdated:       sha256Disc("event:FundingUpdated"),
  // Queue events (v4 — pool-program)
  Enqueued:             sha256Disc("event:Enqueued"),
  Harvested:            sha256Disc("event:Harvested"),
  EntryVoided:          sha256Disc("event:EntryVoided"),
  SideBucketCredited:   sha256Disc("event:SideBucketCredited"),
  QueueDrained:         sha256Disc("event:QueueDrained"),
  PhantomCreditDrained: sha256Disc("event:PhantomCreditDrained"),
  FeesSwept:            sha256Disc("event:FeesSwept"),
  FeesDistributed:      sha256Disc("event:FeesDistributed"),
  TreasuryWithdrawal:   sha256Disc("event:TreasuryWithdrawal"),
  Staked:               sha256Disc("event:Staked"),
  Unstaked:             sha256Disc("event:Unstaked"),
  RewardClaimed:        sha256Disc("event:RewardClaimed"),
  RewardIndexUpdated:   sha256Disc("event:RewardIndexUpdated"),
  CompoundedReward:     sha256Disc("event:CompoundedReward"),
} as const;

// ---------------------------------------------------------------------------
// Discriminator matching
// ---------------------------------------------------------------------------

function discMatches(data: Uint8Array, disc: Buffer): boolean {
  for (let i = 0; i < 8; i++) {
    if (data[i] !== disc[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// LE reading helpers (same pattern as decode/index.ts)
// ---------------------------------------------------------------------------

function makeView(data: Buffer | Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function readPubkey(view: DataView, offset: number): PublicKey {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, 32);
  return new PublicKey(bytes);
}

function readBytes(view: DataView, offset: number, len: number): Uint8Array {
  return new Uint8Array(
    view.buffer.slice(view.byteOffset + offset, view.byteOffset + offset + len)
  );
}

function readU64LE(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, true);
}

/** Little-endian u128 (Anchor `u128` on wire). */
function readU128LE(view: DataView, offset: number): bigint {
  const lo = view.getBigUint64(offset, true);
  const hi = view.getBigUint64(offset + 8, true);
  return lo + (hi << 64n);
}

function readI64LE(view: DataView, offset: number): bigint {
  return view.getBigInt64(offset, true);
}

function readI128LE(view: DataView, offset: number): bigint {
  const lo = view.getBigUint64(offset, true);
  const hi = view.getBigInt64(offset + 8, true);
  return lo | (hi << 64n);
}

function readU8(view: DataView, offset: number): number {
  return view.getUint8(offset);
}

function readSide(view: DataView, offset: number): Side {
  const v = view.getUint8(offset);
  if (v === 0) return "long";
  if (v === 1) return "short";
  throw new Error(`invalid Side byte: ${v}`);
}

// ---------------------------------------------------------------------------
// DecodedEvent union type
// ---------------------------------------------------------------------------

export type DecodedEvent =
  | { type: "positionOpened";       data: PositionOpenedEvent }
  | { type: "positionClosed";       data: PositionClosedEvent }
  | { type: "liquidated";           data: LiquidatedEvent }
  | { type: "badDebt";              data: BadDebtEvent }
  | { type: "fundingUpdated";       data: FundingUpdatedEvent }
  // Queue events (v4 — pool-program)
  | { type: "enqueued";             data: EnqueuedEvent }
  | { type: "harvested";            data: HarvestedEvent }
  | { type: "entryVoided";          data: EntryVoidedEvent }
  | { type: "sideBucketCredited";   data: SideBucketCreditedEvent }
  | { type: "queueDrained";         data: QueueDrainedEvent }
  | { type: "phantomCreditDrained"; data: PhantomCreditDrainedEvent }
  | { type: "feesSwept";            data: FeesSweptEvent }
  | { type: "feesDistributed";      data: FeesDistributedEvent }
  | { type: "treasuryWithdrawal";   data: TreasuryWithdrawalEvent }
  | { type: "staked";               data: StakedEvent }
  | { type: "unstaked";             data: UnstakedEvent }
  | { type: "rewardClaimed";        data: RewardClaimedEvent }
  | { type: "rewardIndexUpdated";   data: RewardIndexUpdatedEvent }
  | { type: "compoundedReward";     data: CompoundedRewardEvent };

// ---------------------------------------------------------------------------
// Per-event decoders
// ---------------------------------------------------------------------------

//
// PositionOpened — 97 bytes total (8 disc + 89 payload)
//   [8..40]  owner: Pubkey
//   [40..72] market_id: [u8;32]
//   [72]     side: u8
//   [73..81] size_usdc: u64
//   [81..89] collateral: u64
//   [89..97] entry_price: u64
//
function decodePositionOpened(data: Buffer): PositionOpenedEvent {
  const v = makeView(data);
  return {
    owner:      readPubkey(v, 8),
    marketId:   readBytes(v, 40, 32),
    side:       readSide(v, 72),
    sizeUsdc:   readU64LE(v, 73),
    collateral: readU64LE(v, 81),
    entryPrice: readU64LE(v, 89),
  };
}

//
// PositionClosed — 96 bytes total (8 disc + 88 payload)
//   [8..40]  owner: Pubkey
//   [40..72] market_id: [u8;32]
//   [72..80] pnl: i64 SIGNED — use getBigInt64
//   [80..88] net_return: u64
//   [88..96] exit_price: u64
//
function decodePositionClosed(data: Buffer): PositionClosedEvent {
  const v = makeView(data);
  return {
    owner:     readPubkey(v, 8),
    marketId:  readBytes(v, 40, 32),
    pnl:       readI64LE(v, 72),
    netReturn: readU64LE(v, 80),
    exitPrice: readU64LE(v, 88),
  };
}

//
// Liquidated — 80 bytes total (8 disc + 72 payload)
//   [8..40]  owner: Pubkey
//   [40..72] market_id: [u8;32]
//   [72..80] bad_debt: u64
//
function decodeLiquidated(data: Buffer): LiquidatedEvent {
  const v = makeView(data);
  return {
    owner:    readPubkey(v, 8),
    marketId: readBytes(v, 40, 32),
    badDebt:  readU64LE(v, 72),
  };
}

//
// BadDebt — 48 bytes total (8 disc + 40 payload)
//   [8..40]  market_id: [u8;32]
//   [40..48] amount: u64
//
function decodeBadDebt(data: Buffer): BadDebtEvent {
  const v = makeView(data);
  return {
    marketId: readBytes(v, 8, 32),
    amount:   readU64LE(v, 40),
  };
}

//
// FundingUpdated — 72 bytes total (8 disc + 64 payload)
//   [8..40]  market_id: [u8;32]
//   [40..56] funding_index: i128 SIGNED
//   [56..64] long_oi: u64
//   [64..72] short_oi: u64
//
function decodeFundingUpdated(data: Buffer): FundingUpdatedEvent {
  const v = makeView(data);
  return {
    marketId:     readBytes(v, 8, 32),
    fundingIndex: readI128LE(v, 40),
    longOi:       readU64LE(v, 56),
    shortOi:      readU64LE(v, 64),
  };
}

//
// Enqueued — 97 bytes total (8 disc + 89 payload)
//   [8..16]  idx: u64
//   [16..48] owner: Pubkey
//   [48..80] market_id: [u8;32]
//   [80..88] amount: u64
//   [88..96] queue_total_owed_after: u64
//
function decodeEnqueued(data: Buffer): EnqueuedEvent {
  const v = makeView(data);
  return {
    idx:                 readU64LE(v, 8),
    owner:               readPubkey(v, 16),
    marketId:            readBytes(v, 48, 32),
    amount:              readU64LE(v, 80),
    queueTotalOwedAfter: readU64LE(v, 88),
  };
}

//
// Harvested — 88 bytes total (8 disc + 80 payload)
//   [8..16]  idx: u64
//   [16..48] owner: Pubkey
//   [48..80] market_id: [u8;32]
//   [80..88] amount: u64
//
function decodeHarvested(data: Buffer): HarvestedEvent {
  const v = makeView(data);
  return {
    idx:      readU64LE(v, 8),
    owner:    readPubkey(v, 16),
    marketId: readBytes(v, 48, 32),
    amount:   readU64LE(v, 80),
  };
}

//
// EntryVoided — 89 bytes total (8 disc + 81 payload)
//   [8..16]  idx: u64
//   [16..48] owner: Pubkey
//   [48..80] market_id: [u8;32]
//   [80..88] amount: u64
//   [88]     reason: u8
//
function decodeEntryVoided(data: Buffer): EntryVoidedEvent {
  const v = makeView(data);
  return {
    idx:      readU64LE(v, 8),
    owner:    readPubkey(v, 16),
    marketId: readBytes(v, 48, 32),
    amount:   readU64LE(v, 80),
    reason:   readU8(v, 88),
  };
}

//
// SideBucketCredited — 49 bytes total (8 disc + 41 payload)
//   [8..40]  market_id: [u8;32]
//   [40..48] amount: u64
//   [48]     source: u8
//
function decodeSideBucketCredited(data: Buffer): SideBucketCreditedEvent {
  const v = makeView(data);
  return {
    marketId: readBytes(v, 8, 32),
    amount:   readU64LE(v, 40),
    source:   readU8(v, 48),
  };
}

//
// QueueDrained — 48 bytes total (8 disc + 40 payload)
//   [8..40]  market_id: [u8;32]
//   [40..48] residual_to_treasury: u64
//
function decodeQueueDrained(data: Buffer): QueueDrainedEvent {
  const v = makeView(data);
  return {
    marketId:           readBytes(v, 8, 32),
    residualToTreasury: readU64LE(v, 40),
  };
}

//
// PhantomCreditDrained — 80 bytes total (8 disc + 72 payload)
//   [8..40]  owner: Pubkey
//   [40..72] market_id: [u8;32]
//   [72..80] amount: u64
//
function decodePhantomCreditDrained(data: Buffer): PhantomCreditDrainedEvent {
  const v = makeView(data);
  return {
    owner:    readPubkey(v, 8),
    marketId: readBytes(v, 40, 32),
    amount:   readU64LE(v, 72),
  };
}

//
// FeesSwept — 48 bytes total (8 disc + 40 payload)
//   [8..40]  market_id: [u8;32]
//   [40..48] amount: u64
//
function decodeFeesSwept(data: Buffer): FeesSweptEvent {
  const v = makeView(data);
  return {
    marketId: readBytes(v, 8, 32),
    amount:   readU64LE(v, 40),
  };
}

//
// FeesDistributed — 40 bytes total (8 disc + 32 payload)
//   [8..16]  total: u64
//   [16..24] staker_share: u64
//   [24..32] treasury_share: u64
//   [32..40] referral_share: u64
//
function decodeFeesDistributed(data: Buffer): FeesDistributedEvent {
  const v = makeView(data);
  return {
    total:         readU64LE(v, 8),
    stakerShare:   readU64LE(v, 16),
    treasuryShare: readU64LE(v, 24),
    referralShare: readU64LE(v, 32),
  };
}

//
// TreasuryWithdrawal — 48 bytes total (8 disc + 40 payload)
//   [8..16]  amount: u64
//   [16..48] destination: Pubkey
//
function decodeTreasuryWithdrawal(data: Buffer): TreasuryWithdrawalEvent {
  const v = makeView(data);
  return {
    amount:      readU64LE(v, 8),
    destination: readPubkey(v, 16),
  };
}

//
// Staked — 81 bytes total (8 disc + 73 payload)
//   [8..40]  owner: Pubkey
//   [40..48] amount: u64
//   [48]     tier: u8
//   [49..57] lockup_expiry: i64
//   [57..65] weighted_amount: u64
//
function decodeStaked(data: Buffer): StakedEvent {
  const v = makeView(data);
  return {
    owner:          readPubkey(v, 8),
    amount:         readU64LE(v, 40),
    tier:           readU8(v, 48),
    lockupExpiry:   readI64LE(v, 49),
    weightedAmount: readU64LE(v, 57),
  };
}

//
// Unstaked — 48 bytes total (8 disc + 40 payload)
//   [8..40]  owner: Pubkey
//   [40..48] amount: u64
//
function decodeUnstaked(data: Buffer): UnstakedEvent {
  const v = makeView(data);
  return {
    owner:  readPubkey(v, 8),
    amount: readU64LE(v, 40),
  };
}

//
// RewardClaimed — 48 bytes total (8 disc + 40 payload)
//   [8..40]  owner: Pubkey
//   [40..48] amount_usdc: u64
//
function decodeRewardClaimed(data: Buffer): RewardClaimedEvent {
  const v = makeView(data);
  return {
    owner:      readPubkey(v, 8),
    amountUsdc: readU64LE(v, 40),
  };
}

//
// RewardIndexUpdated — 32 bytes payload (8 disc + 24) per programs/staking/src/events.rs
//   [8..24]  reward_index: u128
//   [24..32] new_rewards: u64
//
function decodeRewardIndexUpdated(data: Buffer): RewardIndexUpdatedEvent {
  if (data.length < 32) {
    throw new Error(`RewardIndexUpdated: truncated payload (${data.length} < 32)`);
  }
  const v = makeView(data);
  return {
    rewardIndex: readU128LE(v, 8),
    newRewards:  readU64LE(v, 24),
  };
}

//
// CompoundedReward — 49 bytes total (8 disc + 41 payload)
//   [8..40]  owner: Pubkey
//   [40..48] amount: u64
//   [48]     tier: u8
//
function decodeCompoundedReward(data: Buffer): CompoundedRewardEvent {
  const v = makeView(data);
  return {
    owner:  readPubkey(v, 8),
    amount: readU64LE(v, 40),
    tier:   readU8(v, 48),
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * When the 8-byte event discriminator matches but the payload is corrupt or
 * truncated, return `null` instead of throwing — program logs may be hostile or incomplete.
 */
function tryDecodePayload<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/**
 * Decode a single Anchor event from a base64-encoded program log payload.
 *
 * @param base64Data  The base64 string after stripping the "Program log: " prefix.
 * @returns           A typed DecodedEvent, or null if the discriminator does not match
 *                    any known event type, or the payload fails to decode (truncated/corrupt).
 */
export function decodeAnchorEvent(base64Data: string): DecodedEvent | null {
  let raw: Buffer;
  try {
    raw = Buffer.from(base64Data, "base64");
  } catch {
    return null;
  }

  if (raw.length < 8) return null;

  if (discMatches(raw, EVENT_DISCS.PositionOpened)) {
    const data = tryDecodePayload(() => decodePositionOpened(raw));
    if (data) return { type: "positionOpened", data };
    return null;
  }
  if (discMatches(raw, EVENT_DISCS.PositionClosed)) {
    const data = tryDecodePayload(() => decodePositionClosed(raw));
    if (data) return { type: "positionClosed", data };
    return null;
  }
  if (discMatches(raw, EVENT_DISCS.Liquidated)) {
    const data = tryDecodePayload(() => decodeLiquidated(raw));
    if (data) return { type: "liquidated", data };
    return null;
  }
  if (discMatches(raw, EVENT_DISCS.BadDebt)) {
    const data = tryDecodePayload(() => decodeBadDebt(raw));
    if (data) return { type: "badDebt", data };
    return null;
  }
  if (discMatches(raw, EVENT_DISCS.FundingUpdated)) {
    const data = tryDecodePayload(() => decodeFundingUpdated(raw));
    if (data) return { type: "fundingUpdated", data };
    return null;
  }
  if (discMatches(raw, EVENT_DISCS.Enqueued)) {
    const data = tryDecodePayload(() => decodeEnqueued(raw));
    if (data) return { type: "enqueued", data };
    return null;
  }
  if (discMatches(raw, EVENT_DISCS.Harvested)) {
    const data = tryDecodePayload(() => decodeHarvested(raw));
    if (data) return { type: "harvested", data };
    return null;
  }
  if (discMatches(raw, EVENT_DISCS.EntryVoided)) {
    const data = tryDecodePayload(() => decodeEntryVoided(raw));
    if (data) return { type: "entryVoided", data };
    return null;
  }
  if (discMatches(raw, EVENT_DISCS.SideBucketCredited)) {
    const data = tryDecodePayload(() => decodeSideBucketCredited(raw));
    if (data) return { type: "sideBucketCredited", data };
    return null;
  }
  if (discMatches(raw, EVENT_DISCS.QueueDrained)) {
    const data = tryDecodePayload(() => decodeQueueDrained(raw));
    if (data) return { type: "queueDrained", data };
    return null;
  }
  if (discMatches(raw, EVENT_DISCS.PhantomCreditDrained)) {
    const data = tryDecodePayload(() => decodePhantomCreditDrained(raw));
    if (data) return { type: "phantomCreditDrained", data };
    return null;
  }
  if (discMatches(raw, EVENT_DISCS.FeesSwept)) {
    const data = tryDecodePayload(() => decodeFeesSwept(raw));
    if (data) return { type: "feesSwept", data };
    return null;
  }
  if (discMatches(raw, EVENT_DISCS.FeesDistributed)) {
    const data = tryDecodePayload(() => decodeFeesDistributed(raw));
    if (data) return { type: "feesDistributed", data };
    return null;
  }
  if (discMatches(raw, EVENT_DISCS.TreasuryWithdrawal)) {
    const data = tryDecodePayload(() => decodeTreasuryWithdrawal(raw));
    if (data) return { type: "treasuryWithdrawal", data };
    return null;
  }
  if (discMatches(raw, EVENT_DISCS.Staked)) {
    const data = tryDecodePayload(() => decodeStaked(raw));
    if (data) return { type: "staked", data };
    return null;
  }
  if (discMatches(raw, EVENT_DISCS.Unstaked)) {
    const data = tryDecodePayload(() => decodeUnstaked(raw));
    if (data) return { type: "unstaked", data };
    return null;
  }
  if (discMatches(raw, EVENT_DISCS.RewardClaimed)) {
    const data = tryDecodePayload(() => decodeRewardClaimed(raw));
    if (data) return { type: "rewardClaimed", data };
    return null;
  }
  if (discMatches(raw, EVENT_DISCS.RewardIndexUpdated)) {
    const data = tryDecodePayload(() => decodeRewardIndexUpdated(raw));
    if (data) return { type: "rewardIndexUpdated", data };
    return null;
  }
  if (discMatches(raw, EVENT_DISCS.CompoundedReward)) {
    const data = tryDecodePayload(() => decodeCompoundedReward(raw));
    if (data) return { type: "compoundedReward", data };
    return null;
  }

  return null;
}
