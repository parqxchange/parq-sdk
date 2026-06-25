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
  /** Which baseline produced priceChange24h. */
  baselineSource?: "daily_closes" | "price_24h_ago" | null;

  // ── HL-compatible additive aliases (feature #11) ───────────────────────────
  // Strictly additive per the #250 no-rename contract — the camelCase keys above
  // are unchanged. All `*Px` aliases are RAW MANTISSA at the market's native
  // scale (equity=2, crypto/forex=8 — divide by 10^scale). `markPx == oraclePx
  // == midPx` while price_impact_factor = 0 venue-wide (no skew impact, no order
  // book → midPx is a synthetic alias of mark, never a real bid/ask mid). The
  // three `*Px` aliases are null when the indexer's MarkPriceManager is disabled
  // (MARK_PRICE_ENABLED=false) or the market has no oracle price yet.
  /** Raw oracle price mantissa @ native scale, or null. */
  oraclePx?: string | null;
  /** Raw mark price mantissa @ native scale (== oraclePx today), or null. */
  markPx?: string | null;
  /** Synthetic mid (== markPx; no order book), or null. */
  midPx?: string | null;
  /** Previous trading-day close baseline (the prevDayPx HL alias), or null. */
  prevDayPx?: number | null;
  /** 24h notional volume (the dayNtlVlm HL alias) — aliases volume24h, u64 string. */
  dayNtlVlm?: string;
}

/**
 * One bar of GET /ohlcv?market=&resolution=&from=&to=.
 *
 * `tradeCount` (feature #11) is the per-bar count of PositionOpened +
 * PositionClosed events. It is non-null only on intraday resolutions (5s/1m/5m/
 * 15m/1h/4h); the 1d rollup (prices_daily) has no per-bar event join and emits
 * `tradeCount: null`. Like venue volume, it includes the OI-aware trader +
 * volume-tool synthetic flow.
 */
export interface OhlcvBar {
  /** Bucket start, unix seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Per-bar trade count; null on the 1d resolution, 0 on forward-filled flats. */
  tradeCount?: number | null;
}

/** Response of GET /ohlcv. */
export interface OhlcvResponse {
  bars: OhlcvBar[];
  truncatedToRetention: boolean;
}

/** Resolutions accepted by GET /ohlcv (feature #11 added "5s"). */
export type OhlcvResolution = "5s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

/** A market's CategoryPool / category id. */
export type IndexerCategoryId =
  | "equity-us"
  | "crypto-usd"
  | "commodities-usd"
  | "forex-usd";

/** A market's feed/session class (feature #11). */
export type IndexerSessionClass =
  | "free-rth"
  | "relayed-24-7"
  | "relayed-24-5"
  | "hl-sole"
  | "warm-crypto"
  | "commodity"
  | "forex";

/** One market entry in GET /market-info. */
export interface MarketInfoEntry {
  name: string;
  category: IndexerCategoryId;
  /** CategoryPool id (== category id). */
  pool: IndexerCategoryId;
  /** Price mantissa scale (equity=2, crypto/forex=8). */
  scale: number;
  /** Smallest representable price step as a decimal string (e.g. "0.01"). */
  tickSize: string;
  sessionClass: IndexerSessionClass;
  /** Live per-market max leverage (from the 60s on-chain sampler; venue default if absent). */
  maxLeverage: number;
  mmrBps: number;
  imBps: number;
  isPaused: boolean;
}

/** Venue-wide risk block in GET /market-info. */
export interface MarketInfoVenue {
  maxLeverage: number;
  fundingCapApr: number;
  imBps: number;
  mmrBps: number;
  baseFeeBps: number;
  oiCaps: { rthUsd: number; offHoursUsd: number };
}

/** Response of GET /market-info (feature #11). */
export interface MarketInfoResponse {
  generatedAt: string;
  /** Sampler snapshot timestamp (null before the first on-chain sample). */
  sampledAt: string | null;
  venue: MarketInfoVenue;
  markets: MarketInfoEntry[];
  caveats: {
    volumeIncludesProtocolTool: boolean;
    markEqualsOracle: boolean;
    riskLiveFromSampler60s: boolean;
  };
  sources: { static: string; risk: string };
}

/** PnL resolution for GET /pnl (feature #11). */
export type PnlResolution = "hourly" | "daily";

/** One bucket of GET /pnl. */
export interface PnlBucket {
  /** Bucket start, unix seconds. */
  time: number;
  /** Realized PnL in this bucket, USDC (÷1e6, matching the leaderboard display). */
  realizedPnl: number;
  /** PositionClosed count in this bucket. */
  closes: number;
}

/**
 * Response of GET /pnl?owner=&resolution=&from=&to= (feature #11).
 *
 * REALIZED PnL ONLY — no unrealized/open-mark component, consistent with the
 * leaderboard/competition "realized PnL" definition (net = netReturn −
 * collateral when present, gross `pnl` fallback for legacy rows).
 */
export interface PnlResponse {
  owner: string;
  resolution: PnlResolution;
  from: number;
  to: number;
  buckets: PnlBucket[];
  cumulativeRealizedPnl: number;
  realizedOnly: true;
  updatedAt: string;
}
