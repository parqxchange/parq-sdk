import { PublicKey } from "@solana/web3.js";

export type Side = "long" | "short";

export interface Position {
  owner:                    PublicKey;   // 32
  marketId:                 Uint8Array;  // 32
  side:                     Side;        // 1 (u8: 0=Long, 1=Short)
  sizeUsdc:                 bigint;      // 8 (u64)
  collateralUsdc:           bigint;      // 8 (u64)
  entryPrice:               bigint;      // 8 (u64)
  fundingIndexSnapshot:     bigint;      // 16 (i128)
  borrowingFactorSnapshot:  bigint;      // 16 (u128)
  reservedMaxPayout:        bigint;      // 8 (u64)
  collateralFromQueue:      bigint;      // 8 (u64) — portion of collateral funded from UserQueueClaims
  openedAt:                 bigint;      // 8 (i64)
  bump:                     number;      // 1 (u8)
}
// Total borsh: 146 bytes + 8 discriminator = 154

export interface MarketState {
  marketId:                         Uint8Array;  // [u8; 32]
  longOi:                           bigint;      // u64
  shortOi:                          bigint;      // u64
  fundingIndex:                     bigint;      // i128
  lastFundingTs:                    bigint;      // i64
  maxLeverage:                      number;      // u8
  baseFeeBps:                       number;      // u16
  mmrBps:                           number;      // u16
  poolState:                        PublicKey;   // Pubkey
  poolProgram:                      PublicKey;   // Pubkey
  oracleProgram:                    PublicKey;   // Pubkey
  treasury:                         PublicKey;   // Pubkey
  stakingProgramId:                 PublicKey;   // Pubkey
  engineAuthBump:                   number;      // u8
  isPaused:                         boolean;     // bool
  // Adaptive funding
  savedFundingFactorPerSecond:      bigint;      // i128
  fundingIncreaseFactorPerSecond:   bigint;      // u64
  fundingDecreaseFactorPerSecond:   bigint;      // u64
  thresholdForStableFunding:        bigint;      // u64
  thresholdForDecreaseFunding:      bigint;      // u64
  minFundingFactorPerSecond:        bigint;      // u64
  maxFundingFactorPerSecond:        bigint;      // u64
  // Borrowing
  longCumulativeBorrowingFactor:    bigint;      // u128
  shortCumulativeBorrowingFactor:   bigint;      // u128
  lastBorrowingTs:                  bigint;      // i64
  borrowingFactor:                  bigint;      // u64
  optimalUsageFactor:               bigint;      // u64
  aboveOptimalBorrowingFactor:      bigint;      // u64
  longReservedUsdc:                 bigint;      // u64
  shortReservedUsdc:                bigint;      // u64
  // Price impact
  priceImpactFactor:                bigint;      // u64
  maxPriceImpactBps:                number;      // u16
  impactPoolUsdc:                   bigint;      // u64
  // Keeper
  keeper:                           PublicKey;   // Pubkey
  maxOiLong:                        bigint;      // u64
  maxOiShort:                       bigint;      // u64
  feeBpsFavorable:                  number;      // u16
  bump:                             number;      // u8
  // V2 append (LEN 460 → 476) — undefined when decoding a V1 buffer;
  // populated when the on-chain account has been realloc'd to V2.
  offHoursMaxOiLong?:               bigint;      // u64 — 0 = uncapped
  offHoursMaxOiShort?:              bigint;      // u64 — 0 = uncapped
  // V3 append (LEN 476 → 511) — undefined when decoding a V1/V2 buffer.
  // ADL tail-backstop params (33B @476..509, ship DISARMED: adlFrozen=1,
  // both triggers=u64::MAX) followed by initialMarginBps (2B @509).
  adlFrozen?:                       number;      // u8  — 1 = disarmed (default)
  adlTailTriggerUsdcRth?:           bigint;      // u64 — u64::MAX = dormant
  adlTailTriggerUsdcOff?:           bigint;      // u64 — u64::MAX = dormant
  adlTailMinAgeSecsRth?:            number;      // u32
  adlTailMinAgeSecsOff?:            number;      // u32
  adlHaircutBpsRth?:                number;      // u16
  adlHaircutBpsOff?:                number;      // u16
  adlMaxHaircutBps?:                number;      // u16 — absolute f ceiling (≤5000)
  adlMaxFeedDivergenceBps?:         number;      // u16 — Tier-A feed gate (dormant in v1)
  // openable cap = 10000 / initialMarginBps. 0 ⇒ no IM floor (pre-margin-migration).
  initialMarginBps?:                number;      // u16
  // V4 append (LEN 511 → 515) — undefined when decoding a V1/V2/V3 buffer.
  // Liquidation economics (2026-06-09): equity-denominated liq fee + partial-liq target.
  liqFeeBps?:                       number;      // u16 — φ in bps of equity (default 2000 = 20%, ≤10000)
  partialLiqTargetHealth?:          number;      // u16 — 0 = partial-liq disabled (this phase)
}
// V1 borsh: 452 bytes + 8 discriminator = 460
// V2 borsh: 468 bytes + 8 discriminator = 476 (appends 2× u64 off-hours OI caps)
// V3 borsh: 503 bytes + 8 discriminator = 511 (ADL 33B @476 + IM 2B @509)
// V4 borsh: 507 bytes + 8 discriminator = 515 (liq_fee_bps 2B @511 + partial_liq_target_health 2B @513)

/** @deprecated Use MarketState — this interface has only 9 of 35 fields. */
export interface Market {
  marketId:         Uint8Array;
  longOi:           bigint;
  shortOi:          bigint;
  fundingIndex:     bigint;
  lastFundingTs:    bigint;
  maxLeverage:      number;
  baseFeeBps:       number;
  mmrBps:           number;
  isPaused:         boolean;
}

export interface PoolState {
  marketId:           Uint8Array;  // [u8; 32]
  usdcVault:          PublicKey;   // Pubkey
  vaultAuthorityBump: number;      // u8
  lpMint:             PublicKey;   // Pubkey
  totalUsdc:          bigint;      // u64
  reservedUsdc:       bigint;      // u64
  cumulativeFees:     bigint;      // u64
  engineAuth:         PublicKey;   // Pubkey
  engineAuthBump:     number;      // u8
  admin:              PublicKey;   // Pubkey
  isPaused:           boolean;     // bool
  reserveFactor:      bigint;      // u64
  depositFeeBps:      number;      // u16
  withdrawalFeeBps:   number;      // u16
  // Queue fields (v4 — spec §4.1) — serialized before bump per struct field order
  sideBucket:         bigint;      // u64
  queueHeadIdx:       bigint;      // u64
  queueTailIdx:       bigint;      // u64
  queueTotalOwed:     bigint;      // u64
  bump:               number;      // u8
  // ADL tail-backstop (v5 — appended after bump by migrate_pool_state_v2).
  // 0 on legacy un-migrated (240-byte) pools.
  currentAdlEpoch:    number;      // u32
  lastAdlCutIdx:      bigint;      // u64
}
// Total borsh: 232 bytes + 8 discriminator = 240 (v4); v5 appends u32+u64 = 252.
// v4: 4 new queue fields (sideBucket, queueHeadIdx, queueTailIdx, queueTotalOwed)
// v5: ADL fields (currentAdlEpoch, lastAdlCutIdx) appended after bump.
// Borsh field order: queue fields precede bump (follows struct declaration in state.rs)

export type OrderType =
  | "marketIncrease"
  | "limitIncrease"
  | "stopIncrease"
  | "marketDecrease"
  | "limitDecrease"
  | "stopLossDecrease";

export interface Order {
  owner:           PublicKey;   // Pubkey
  marketId:        Uint8Array;  // [u8; 32]
  orderType:       OrderType;   // u8 (enum)
  side:            Side;        // u8
  sizeUsdc:        bigint;      // u64
  collateralUsdc:  bigint;      // u64
  triggerPrice:    bigint;      // u64
  acceptablePrice: bigint;      // u64
  minOutputUsdc:   bigint;      // u64
  referralCode:    Uint8Array;  // [u8; 32]
  positionNonce:   bigint;      // u64
  createdAt:       bigint;      // i64
  nonce:           bigint;      // u64
  bump:            number;      // u8
}
// Total borsh: 163 bytes + 8 discriminator = 171

export interface OrderNonce {
  owner: PublicKey;  // Pubkey
  nonce: bigint;     // u64
  bump:  number;     // u8
}
// Total borsh: 41 bytes + 8 discriminator = 49

export interface TradingKey {
  wallet:    PublicKey;  // Pubkey
  delegate:  PublicKey;  // Pubkey
  expiresAt: bigint;     // i64
  bump:      number;     // u8
}
// Total borsh: 73 bytes + 8 discriminator = 81

/**
 * Venue-wide emergency trading-halt mode — the on-chain `ProtocolConfig.halt_mode`
 * byte (perp-engine `set_trading_halt`). The on-chain flag is the single source
 * of truth.
 *
 * - `None`       — normal operation (the resume target).
 * - `ReduceOnly` — block opens/increases/new orders/margin/funding; closes,
 *   cancels and liquidations stay open (venue-wide equivalent of per-market pause).
 * - `Full`       — additionally freeze closes + liquidations.
 */
export enum HaltMode {
  None = 0,
  ReduceOnly = 1,
  Full = 2,
}

/**
 * Singleton ProtocolConfig PDA (`[b"protocol_config"]`, perp-engine).
 *
 * On-chain shape (`programs/perp-engine/src/state.rs`):
 *   admin                      Pubkey       (32)
 *   bump                       u8           (1)
 *   haltMode                   u8           (1)   // carved from _reserved[0]
 *   minFreeLiquidityBps        u16          (2)   // carved from _reserved[1..3]; 0 = gate disabled
 *   _reserved                  [u8; 28]     (28)  // preserved for backwards compat
 *   rthOpenMinutesUtc          u16          (2)
 *   rthCloseMinutesUtc         u16          (2)
 *   tierBreakpointsUsdc        [u64; 5]     (40)
 *   rthMaxLeverage             [u8; 5]      (5)
 *   offHoursMaxLeverage        [u8; 5]      (5)
 *
 * Fetched via `PerpClient.getProtocolConfig()` which delegates to
 * `program.account.protocolConfig.fetch(pda)` and so returns Anchor's camelCased
 * field names. Tier table arrays are length-5 (gross-notional buckets defined
 * by `tierBreakpointsUsdc`).
 */
export interface ProtocolConfig {
  admin:                PublicKey;
  bump:                 number;
  haltMode:             number;     // u8: 0 = None, 1 = ReduceOnly, 2 = Full (see HaltMode)
  minFreeLiquidityBps:  number;     // u16: open-side free-liquidity floor (bps of pool total_usdc); 0 = gate disabled
  rthOpenMinutesUtc:    number;     // u16: minutes from 00:00 UTC, RTH open
  rthCloseMinutesUtc:   number;     // u16: minutes from 00:00 UTC, RTH close
  tierBreakpointsUsdc:  bigint[];   // [u64; 5] — gross-notional upper bounds
  rthMaxLeverage:       number[];   // [u8; 5] — max leverage per tier during RTH
  offHoursMaxLeverage:  number[];   // [u8; 5] — max leverage per tier outside RTH
}

export interface ReferralTier {
  totalRebateBps:   number;  // u16
  discountSharePct: number;  // u8
}

export interface ReferralConfig {
  admin: PublicKey;           // Pubkey
  tiers: [ReferralTier, ReferralTier, ReferralTier, ReferralTier];
  bump:  number;              // u8
}
// Total borsh: 45 bytes + 8 discriminator = 53

export interface ReferralCode {
  owner: PublicKey;   // Pubkey
  code:  Uint8Array;  // [u8; 32]
  tier:  number;      // u8
  bump:  number;      // u8
}
// Total borsh: 66 bytes + 8 discriminator = 74

export interface TraderReferral {
  trader: PublicKey;   // Pubkey
  code:   Uint8Array;  // [u8; 32]
  bump:   number;      // u8
}
// Total borsh: 65 bytes + 8 discriminator = 73

export interface AffiliateReward {
  affiliate:   PublicKey;   // Pubkey
  marketId:    Uint8Array;  // [u8; 32]
  accruedUsdc: bigint;      // u64
  bump:        number;      // u8
}
// Total borsh: 73 bytes + 8 discriminator = 81

export interface FeePool {
  admin:             PublicKey;
  perpEngine:        PublicKey;
  usdcAccount:       PublicKey;
  stakingReward:     PublicKey;
  treasury:          PublicKey;
  referralReserve:   PublicKey;
  stakerSplitBps:    number;      // u16
  treasurySplitBps:  number;      // u16
  referralSplitBps:  number;      // u16
  totalDistributed:  bigint;      // u64
  bump:              number;      // u8
}
// Total borsh: 207 bytes + 8 discriminator = 215

export interface StakingPool {
  admin:                   PublicKey;
  tokenMint:               PublicKey;
  stakedVault:             PublicKey;
  rewardSource:            number;    // u8 — 0=BalanceBased, 1=EmissionSchedule
  rewardMint:              PublicKey;
  rewardVault:             PublicKey;
  rewardUsdc:              PublicKey;
  totalWeightedStake:      bigint;   // u128
  rewardIndex:             bigint;   // u128
  totalRewardsDistributed: bigint;   // u64
  totalAllocation:         bigint;   // u64
  startTs:                 bigint;   // i64
  endTs:                   bigint;   // i64
  emittedSoFar:            bigint;   // u64
  lastUpdateTs:            bigint;   // i64
  bump:                    number;   // u8
  totalClaimed:            bigint;   // u64 — cumulative USDC claimed out of reward_usdc
                                     // (v2, 2026-06-08 freeze fix; 0 on pre-migration V1 accounts)
}
// Total borsh: v1 = 274 + 8 disc = 282; v2 appends total_claimed (u64) → 290.

export interface StakePosition {
  pool:             PublicKey;
  owner:            PublicKey;
  amount:           bigint;      // u64
  lockupTier:       number;      // u8
  lockupExpiry:     bigint;      // i64
  weightedAmount:   bigint;      // u64
  rewardIndexSnap:  bigint;      // u128
  accruedReward:    bigint;      // u64
  bump:             number;      // u8
}
// Total borsh: 114 bytes + 8 discriminator = 122

/**
 * A single entry in the LP payout queue.
 * status: 0 = Pending, 1 = Harvested, 2 = Voided
 */
export interface PayoutQueueEntry {
  owner:       PublicKey;   // Pubkey (32)
  marketId:    Uint8Array;  // [u8; 32]
  idx:         bigint;      // u64
  amount:      bigint;      // u64
  enqueuedAt:  bigint;      // i64
  status:      number;      // u8 — 0=Pending, 1=Harvested, 2=Voided
  bump:        number;      // u8
}
// Total borsh: 90 bytes + 8 discriminator = 98

/**
 * Tracks cumulative LP payout-queue claim state per (owner, market).
 */
export interface UserQueueClaims {
  owner:             PublicKey;   // Pubkey (32)
  marketId:          Uint8Array;  // [u8; 32]
  unpaidOwed:        bigint;      // u64
  collateralDrawn:   bigint;      // u64
  phantomUnpaidOwed: bigint;      // u64
  bump:              number;      // u8
}
// Total borsh: 89 bytes + 8 discriminator = 97

export interface PriceData {
  price:      bigint;
  confidence: bigint;
  timestamp:  bigint;
}

// Event interfaces (mirrors on-chain Anchor events)
export interface PositionOpenedEvent {
  owner:       PublicKey;
  marketId:    Uint8Array;
  side:        Side;
  sizeUsdc:    bigint;
  collateral:  bigint;
  entryPrice:  bigint;
}

export interface PositionClosedEvent {
  owner:      PublicKey;
  marketId:   Uint8Array;
  /** GROSS price-move PnL (entry vs exit × size) — fees/funding NOT subtracted. */
  pnl:        bigint;
  netReturn:  bigint;
  exitPrice:  bigint;
  /** #172 append — undefined on pre-#172 (96-byte) events. */
  fundingCharge?: bigint;
  /**
   * #183 appends — undefined on pre-#183 (≤104-byte) events.
   * Realized net PnL = netReturn − collateral (bounded at −collateral).
   */
  collateral?: bigint;
  /** Notional closed by THIS close (enables both-leg volume). */
  sizeUsdc?:   bigint;
  /** 0 = user close_position, 1 = keeper execute_decrease, 2 = liquidation. */
  closedBy?:   number;
}

export interface LiquidatedEvent {
  owner:    PublicKey;
  marketId: Uint8Array;
  badDebt:  bigint;
}

export interface BadDebtEvent {
  marketId: Uint8Array;
  amount:   bigint;
}

export interface FundingUpdatedEvent {
  marketId:     Uint8Array;
  fundingIndex: bigint;
  longOi:       bigint;
  shortOi:      bigint;
}

// --- Queue events (v4 — pool-program) ---

export interface EnqueuedEvent {
  idx:                  bigint;      // u64
  owner:                PublicKey;
  marketId:             Uint8Array;
  amount:               bigint;      // u64
  queueTotalOwedAfter:  bigint;      // u64
}

export interface HarvestedEvent {
  idx:      bigint;     // u64
  owner:    PublicKey;
  marketId: Uint8Array;
  amount:   bigint;     // u64
}

export interface EntryVoidedEvent {
  idx:      bigint;     // u64
  owner:    PublicKey;
  marketId: Uint8Array;
  amount:   bigint;     // u64
  reason:   number;     // u8 — 0=liquidation
}

export interface SideBucketCreditedEvent {
  marketId: Uint8Array;
  amount:   bigint;     // u64
  source:   number;     // u8 — 0=loss, 1=bad_debt_absorb
}

export interface QueueDrainedEvent {
  marketId:           Uint8Array;
  residualToTreasury: bigint;     // u64
}

// Followup #173 — emitted by `harvest` when a Pending winner is paid (wholly or
// partly) from LP principal (`pool.total_usdc`) rather than `side_bucket`.
export interface QueueLpDrawEvent {
  marketId:       Uint8Array;
  idx:            bigint;     // u64
  owner:          PublicKey;
  amount:         bigint;     // u64 — portion drawn from LP principal this entry
  totalUsdcAfter: bigint;     // u64 — pool.total_usdc after the draw
}

export interface PhantomCreditDrainedEvent {
  owner:    PublicKey;
  marketId: Uint8Array;
  amount:   bigint;     // u64
}

export interface FeesSweptEvent {
  marketId: Uint8Array;
  amount:   bigint;
}

export interface FeesDistributedEvent {
  total:          bigint;
  stakerShare:    bigint;
  treasuryShare:  bigint;
  referralShare:  bigint;
}

export interface TreasuryWithdrawalEvent {
  amount:      bigint;
  destination: PublicKey;
}

export interface StakedEvent {
  owner:          PublicKey;
  amount:         bigint;
  tier:           number;
  lockupExpiry:   bigint;
  weightedAmount: bigint;
}

export interface UnstakedEvent {
  owner:  PublicKey;
  amount: bigint;
}

export interface RewardClaimedEvent {
  owner:      PublicKey;
  amountUsdc: bigint;
}

export interface RewardIndexUpdatedEvent {
  rewardIndex: bigint;
  newRewards:  bigint;
}

export interface CompoundedRewardEvent {
  owner:  PublicKey;
  amount: bigint;
  tier:   number;
}
