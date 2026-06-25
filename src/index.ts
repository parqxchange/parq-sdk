/**
 * @packageDocumentation
 * Production checklist + full reference: https://docs.parquet.exchange/developer/sdk
 */
// Utilities
export * from "./utils/pda";
export * from "./utils/errors";
export * from "./utils/priceMath";
export { withComputeBudget, SUGGESTED_CU } from "./utils/computeBudget";
export { buildVersionedTransaction } from "./utils/transaction";
export {
  detectProgramVersion,
  PROGRAM_IDS_V4,
  type MarketStateDataLayout,
} from "./utils/version";
export { probeTokenProgram } from "./utils/tokenProgram";

// Types
export * from "./types";

// Decoders
export {
  decodePosition, decodeMarketState, decodePoolState,
  decodeOrder, decodeOrderNonce, decodeTradingKey,
  decodeReferralConfig, decodeReferralCode, decodeTraderReferral,
  decodeAffiliateReward, decodeFeePool, decodeStakingPool,
  decodeStakePosition, decodePayoutQueueEntry, decodeUserQueueClaims,
  decodeCategoryPool, decodeMarketRisk, poolShapeOf,
  decodeBuilderRegistry, decodeBuilderReward,
  identifyAccountType,
  DecoderError, DISCRIMINATORS,
  POSITION_ACCT_DISC, ORDER_ACCT_DISC, discToBase58,
  type AccountTypeName,
} from "./decode";

// Unified-LP-pool (Phase 3) category trade-shape resolver
export {
  resolveCategoryTradeAccounts, categoryBuilderArg,
  type CategoryTradeAccounts,
} from "./utils/category-shape";

// Program clients
export { PoolClient } from "./programs/pool";
export {
  PerpClient,
  type OpenPositionArgs,
  type ExitRung,
  resolveExitMinOutput,
  MARK_TP_SLIPPAGE_BPS,
  MARK_SL_SLIPPAGE_BPS,
  MAX_EXIT_RUNGS,
} from "./programs/perp";
export { OracleClient } from "./programs/oracle";
export { PriceFeedClient, PRICE_FEED_PROGRAM_ID } from "./programs/priceFeed";
export { FeeDistributorClient } from "./programs/feeDistributor";
export { StakingClient } from "./programs/staking";

// Actions
export { addLiquidity, removeLiquidity, type LiquidityOpts } from "./actions/liquidity";
export { openPosition, closePosition, updateMargin, type TradingOpts } from "./actions/trading";
export { crankFundingRate } from "./actions/cranks";

// Account resolvers
export {
  resolveOpenPositionAccounts, resolveClosePositionAccounts,
  resolveUpdateMarginAccounts, resolveLiquidityAccounts,
  type ProgramIds,
} from "./accounts/resolve";

// MarketOracle dual-feed lookup
export {
  getMarketOracleFeeds, clearMarketOracleFeedsCache, MARKET_ORACLE_V2_LEN,
  // Off-chain price-read decoders — the documented public read path (developer/sdk.mdx):
  // getMarketOracleFeeds resolves the feed accounts, these decode each into {price, confidence, timestamp}.
  decodePythPriceUpdate, decodeSwitchboardPriceFeed,
  type MarketOracleFeeds, type DecodedFeedPrice,
} from "./accounts/marketOracle";

// Auth (`loadTradingKeypair` lives on `@parqxchange/sdk/node` — keeps `fs` off the default graph)
export {
  registerTradingKey,
  revokeTradingKey,
  buildRegisterTradingKeyIx,
  buildRevokeTradingKeyIx,
} from "./auth/tradingKey";

// Session-key helpers (ephemeral delegate keys for delegated trading)
export {
  generateSessionKey,
  buildEnableSession,
  signWithSession,
} from "./auth/session";

// Events
export { ParquetEventEmitter, type ParquetEventType, type ParquetEventEmitterEvents } from "./events/emitter";
export { decodeAnchorEvent, type DecodedEvent } from "./events/decoder";

// Risk score + named-state ladder (Feature #8) — inverse-normalized healthMilli
// → [0,1000] + the 4-rung ladder (Safe/AtRisk/NearLiquidation/Liquidatable).
export {
  RISK_STATES,
  riskScoreFromHealthMilli,
  riskStateFromHealthMilli,
  nearMilliFromWarnBand,
  defaultBreakpoints,
  LIQ_LINE_MILLI,
  DEFAULT_SAFE_FLOOR_MILLI,
  DEFAULT_NEAR_MILLI,
  DEFAULT_LIQ_WARN_DISTANCE_BPS,
  type RiskState,
  type RiskBreakpoints,
} from "./risk/score";

// Indexer client
export { IndexerClient, IndexerError } from "./indexer/client";
export type {
  StatsResponse,
  OhlcvBar, OhlcvResponse, OhlcvResolution,
  IndexerCategoryId, IndexerSessionClass,
  MarketInfoEntry, MarketInfoVenue, MarketInfoResponse,
  PnlResolution, PnlBucket, PnlResponse,
} from "./indexer/types";

// Jupiter swap-to-USDC deposit helper (Feature #14) — keyless quote/build over
// the lite-api host; returns an UNSIGNED VersionedTransaction (no key, no sign).
export {
  getSwapQuote,
  buildSwapTransaction,
  JUPITER_QUOTE_HOST,
  JUPITER_SWAP_HOST,
  PARQUET_PLATFORM_FEE_BPS,
  type JupiterQuote,
  type GetSwapQuoteParams,
  type BuildSwapTransactionParams,
} from "./integrations/jupiter";
