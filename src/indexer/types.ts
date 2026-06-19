/**
 * Indexer HTTP response types. Keep in sync with the indexer's actual JSON
 * surface in services/indexer/src/. When a route's response shape changes,
 * update the matching type here AND bump the SDK minor version.
 */

/** Response of GET /stats?market=<symbol> */
export interface StatsResponse {
  /** Sum of (PositionOpened + PositionClosed).payload.sizeUsdc over last 24h, as a u64 string. */
  volume24h: string;
  high24h: number;
  low24h: number;
  priceChange24h: number;
  priceChangePct24h: number;
  tradeCount24h: number;
  /** Reserved field; not yet wired. */
  feeApr: number | null;
}
