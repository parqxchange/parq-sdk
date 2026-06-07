/**
 * ParquetEventEmitter — dual-mode event subscription for Parquet.
 *
 * Mode 1 — startEvents():
 *   Uses connection.onLogs(perpEngineId) to receive program log callbacks.
 *   Each log line is tested for the "Program log: " prefix, the remainder
 *   is base64-decoded and matched against the 6 known Anchor event discriminators.
 *   On match, a typed event is emitted.
 *
 * Mode 2 — startAccounts():
 *   Uses connection.onProgramAccountChange(perpEngineId) to receive raw account
 *   data on every write. identifyAccountType() routes the 8-byte discriminator
 *   to the correct decoder. Emits positionChanged, marketStateChanged, or
 *   orderChanged with { pubkey, account } payloads.
 *
 * No auto-reconnection is performed — consumers should implement their own
 * health-check loop (e.g. poll /health or watch slot progression) and call
 * stop() then startEvents()/startAccounts() if the WebSocket drops.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import EventEmitter from "events";
import type {
  Position,
  MarketState,
  Order,
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
} from "../types";
import { decodeAnchorEvent } from "./decoder";
import {
  identifyAccountType,
  decodePosition,
  decodeMarketState,
  decodeOrder,
} from "../decode";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ParquetEventType =
  | "positionOpened"
  | "positionClosed"
  | "liquidated"
  | "badDebt"
  | "fundingUpdated"
  // Queue events (v4)
  | "enqueued"
  | "harvested"
  | "entryVoided"
  | "sideBucketCredited"
  | "queueDrained"
  | "phantomCreditDrained"
  | "feesSwept"
  | "feesDistributed"
  | "treasuryWithdrawal"
  | "staked"
  | "unstaked"
  | "rewardClaimed"
  | "rewardIndexUpdated"
  | "compoundedReward"
  | "positionChanged"
  | "marketStateChanged"
  | "orderChanged";

export interface ParquetEventEmitterEvents {
  // Log-mode events (startEvents)
  positionOpened:       (data: PositionOpenedEvent) => void;
  positionClosed:       (data: PositionClosedEvent) => void;
  liquidated:           (data: LiquidatedEvent) => void;
  badDebt:              (data: BadDebtEvent) => void;
  fundingUpdated:       (data: FundingUpdatedEvent) => void;
  // Queue events (v4 — pool-program)
  enqueued:             (data: EnqueuedEvent) => void;
  harvested:            (data: HarvestedEvent) => void;
  entryVoided:          (data: EntryVoidedEvent) => void;
  sideBucketCredited:   (data: SideBucketCreditedEvent) => void;
  queueDrained:         (data: QueueDrainedEvent) => void;
  phantomCreditDrained: (data: PhantomCreditDrainedEvent) => void;
  feesSwept:            (data: FeesSweptEvent) => void;
  feesDistributed:      (data: FeesDistributedEvent) => void;
  treasuryWithdrawal:   (data: TreasuryWithdrawalEvent) => void;
  staked:               (data: StakedEvent) => void;
  unstaked:             (data: UnstakedEvent) => void;
  rewardClaimed:        (data: RewardClaimedEvent) => void;
  rewardIndexUpdated:   (data: RewardIndexUpdatedEvent) => void;
  compoundedReward:     (data: CompoundedRewardEvent) => void;
  // Account-mode events (startAccounts)
  positionChanged:    (payload: { pubkey: PublicKey; account: Position }) => void;
  marketStateChanged: (payload: { pubkey: PublicKey; account: MarketState }) => void;
  orderChanged:       (payload: { pubkey: PublicKey; account: Order }) => void;
  // Error channel
  error: (err: Error) => void;
}

// ---------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------

const LOG_PREFIX = "Program log: ";

export class ParquetEventEmitter extends EventEmitter {
  private logsSubId:    number | null = null;
  private accountSubId: number | null = null;

  constructor(
    private readonly connection: Connection,
    private readonly perpEngineId: PublicKey,
  ) {
    super();
  }

  // -------------------------------------------------------------------------
  // Mode 1 — log-based Anchor events
  // -------------------------------------------------------------------------

  /**
   * Subscribe to program logs and decode Anchor events.
   * Emits: positionOpened, positionClosed, liquidated, badDebt, fundingUpdated,
   *        enqueued, harvested, entryVoided, sideBucketCredited, queueDrained,
   *        phantomCreditDrained, feesSwept, feesDistributed, treasuryWithdrawal,
   *        staked, unstaked, rewardClaimed, rewardIndexUpdated, compoundedReward.
   *
   * No auto-reconnection — implement your own health-check loop.
   */
  startEvents(): void {
    if (this.logsSubId !== null) return;

    this.logsSubId = this.connection.onLogs(
      this.perpEngineId,
      (logs, _ctx) => {
        try {
          for (const line of logs.logs) {
            if (!line.startsWith(LOG_PREFIX)) continue;
            const base64 = line.slice(LOG_PREFIX.length);
            const decoded = decodeAnchorEvent(base64);
            if (decoded === null) continue;

            switch (decoded.type) {
              case "positionOpened":
                this.emit("positionOpened", decoded.data);
                break;
              case "positionClosed":
                this.emit("positionClosed", decoded.data);
                break;
              case "liquidated":
                this.emit("liquidated", decoded.data);
                break;
              case "badDebt":
                this.emit("badDebt", decoded.data);
                break;
              case "fundingUpdated":
                this.emit("fundingUpdated", decoded.data);
                break;
              case "enqueued":
                this.emit("enqueued", decoded.data);
                break;
              case "harvested":
                this.emit("harvested", decoded.data);
                break;
              case "entryVoided":
                this.emit("entryVoided", decoded.data);
                break;
              case "sideBucketCredited":
                this.emit("sideBucketCredited", decoded.data);
                break;
              case "queueDrained":
                this.emit("queueDrained", decoded.data);
                break;
              case "phantomCreditDrained":
                this.emit("phantomCreditDrained", decoded.data);
                break;
              case "feesSwept":
                this.emit("feesSwept", decoded.data);
                break;
              case "feesDistributed":
                this.emit("feesDistributed", decoded.data);
                break;
              case "treasuryWithdrawal":
                this.emit("treasuryWithdrawal", decoded.data);
                break;
              case "staked":
                this.emit("staked", decoded.data);
                break;
              case "unstaked":
                this.emit("unstaked", decoded.data);
                break;
              case "rewardClaimed":
                this.emit("rewardClaimed", decoded.data);
                break;
              case "rewardIndexUpdated":
                this.emit("rewardIndexUpdated", decoded.data);
                break;
              case "compoundedReward":
                this.emit("compoundedReward", decoded.data);
                break;
            }
          }
        } catch (err) {
          this.emit("error", err instanceof Error ? err : new Error(String(err)));
        }
      },
      "confirmed",
    );
  }

  // -------------------------------------------------------------------------
  // Mode 2 — account-change subscriptions
  // -------------------------------------------------------------------------

  /**
   * Subscribe to program account changes and decode account data.
   * Emits: positionChanged, marketStateChanged, orderChanged.
   *
   * No auto-reconnection — implement your own health-check loop.
   */
  startAccounts(): void {
    if (this.accountSubId !== null) return;

    this.accountSubId = this.connection.onProgramAccountChange(
      this.perpEngineId,
      (keyedAccountInfo, _ctx) => {
        try {
          const pubkey = keyedAccountInfo.accountId;
          const data = Buffer.from(keyedAccountInfo.accountInfo.data);
          if (data.length < 8) return;

          const accountType = identifyAccountType(data);
          if (accountType === null) return;

          switch (accountType) {
            case "Position": {
              const account = decodePosition(data);
              this.emit("positionChanged", { pubkey, account });
              break;
            }
            case "MarketState": {
              const account = decodeMarketState(data);
              this.emit("marketStateChanged", { pubkey, account });
              break;
            }
            case "Order": {
              const account = decodeOrder(data);
              this.emit("orderChanged", { pubkey, account });
              break;
            }
            // Other account types (PoolState, OrderNonce, etc.) are not emitted
            default:
              break;
          }
        } catch (err) {
          this.emit("error", err instanceof Error ? err : new Error(String(err)));
        }
      },
      "confirmed",
    );
  }

  // -------------------------------------------------------------------------
  // Combined start
  // -------------------------------------------------------------------------

  /**
   * Start both log-based and account-based subscriptions.
   */
  startAll(): void {
    this.startEvents();
    this.startAccounts();
  }

  // -------------------------------------------------------------------------
  // Stop
  // -------------------------------------------------------------------------

  /**
   * Remove all active subscriptions. Safe to call when not subscribed.
   */
  async stop(): Promise<void> {
    const removals: Promise<void>[] = [];

    if (this.logsSubId !== null) {
      removals.push(this.connection.removeOnLogsListener(this.logsSubId));
      this.logsSubId = null;
    }

    if (this.accountSubId !== null) {
      removals.push(
        this.connection.removeProgramAccountChangeListener(this.accountSubId),
      );
      this.accountSubId = null;
    }

    await Promise.all(removals);
  }
}
