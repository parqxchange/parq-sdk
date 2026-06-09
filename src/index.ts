/**
 * @packageDocumentation
 * Production checklist + full reference: https://docs.parquet.exchange/developer/sdk
 */
// Utilities
export * from "./utils/pda";
export * from "./utils/errors";
export * from "./utils/priceMath";
export { withComputeBudget } from "./utils/computeBudget";
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
  identifyAccountType,
  DecoderError, DISCRIMINATORS,
  type AccountTypeName,
} from "./decode";

// Program clients
export { PoolClient } from "./programs/pool";
export { PerpClient, type OpenPositionArgs } from "./programs/perp";
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
  type MarketOracleFeeds,
} from "./accounts/marketOracle";

// Auth (`loadTradingKeypair` lives on `@parqxchange/sdk/node` — keeps `fs` off the default graph)
export {
  registerTradingKey,
  revokeTradingKey,
  buildRegisterTradingKeyIx,
  buildRevokeTradingKeyIx,
} from "./auth/tradingKey";

// Events
export { ParquetEventEmitter, type ParquetEventType, type ParquetEventEmitterEvents } from "./events/emitter";
export { decodeAnchorEvent, type DecodedEvent } from "./events/decoder";

// Indexer client
export { IndexerClient, IndexerError } from "./indexer/client";
export type { StatsResponse } from "./indexer/types";
