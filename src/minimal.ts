/**
 * Narrow `@parqxchange/sdk` surface — perp trading actions + dual-feed `MarketOracle` helpers.
 * Does not import account decoders or event/crypto subgraphs (see root barrel for full SDK).
 *
 * Read the [Sharp corners](https://github.com/parqxchange/parq-sdk/blob/main/README.md#sharp-corners)
 * section in `sdk/README.md` before production use.
 */
export { PerpClient, type OpenPositionArgs } from "./programs/perp";
export { openPosition, closePosition, updateMargin, type TradingOpts } from "./actions/trading";
export {
  getMarketOracleFeeds,
  clearMarketOracleFeedsCache,
  MARKET_ORACLE_V2_LEN,
  type MarketOracleFeeds,
} from "./accounts/marketOracle";
