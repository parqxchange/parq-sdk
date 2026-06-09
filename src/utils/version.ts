import { Connection, PublicKey } from "@solana/web3.js";

/**
 * `MarketState` account data length classification for deployed perp-engine layouts.
 *
 * Layouts: `LEN_V1` (460), `LEN_V2` (476), current `MarketState::LEN`
 * (511 — ADL block + `initial_margin_bps` tail).
 *
 * - **`v3_511`** — current mainnet layout (after `migrate_market_state_v3`).
 * - **`v2_476`** — off-hours OI caps surface (pre-ADL block).
 * - **`v1_460`** — legacy `LEN_V1`.
 * - **`v2_adl_surface`** — intermediate ADL-era sizes 484..510 if ever observed on-chain.
 * - **`legacy_tiny`** — pre-modern layouts (≤256 bytes); treat as unsupported for v4+ flows.
 */
export type MarketStateDataLayout =
  | "unknown"
  | "legacy_tiny"
  | "v1_460"
  | "v2_476"
  | "v2_adl_surface"
  | "v3_511";

/**
 * Classify `MarketState` account size at `marketStatePda` (one `getAccountInfo`).
 */
export async function detectProgramVersion(
  connection: Connection,
  marketStatePda: PublicKey,
): Promise<MarketStateDataLayout> {
  const info = await connection.getAccountInfo(marketStatePda);
  if (!info) return "unknown";
  const len = info.data.length;
  if (len <= 256) return "legacy_tiny";
  if (len === 511) return "v3_511";
  if (len === 476) return "v2_476";
  if (len === 460) return "v1_460";
  if (len >= 484 && len <= 510) return "v2_adl_surface";
  return "unknown";
}

/**
 * Canonical Parquet program IDs. The same six program keypairs are deployed on
 * every cluster (localnet / devnet / mainnet), so these IDs are valid in all
 * environments.
 *
 * Field names are kept in SCREAMING_SNAKE_CASE for back-compat with existing
 * callers that re-export this constant. A rename to `{ perpEngine, poolProgram,
 * … }` is deferred to a future SDK major bump, since it would force a
 * coordinated downstream update for marginal ergonomic benefit.
 */
export const PROGRAM_IDS_V4 = {
  POOL_PROGRAM:    "Acme8JzWrvVqGJz7nTKVsLYisN6MtP83nrs4fVAeXJsN",
  PERP_ENGINE:     "6QrsMTMEu9rsLpyxQgRdvQsWoPgHGY9npNNiwTtXsbdc",
  ORACLE_ADAPTER:  "6fsnWa9tcKcPiuQgdUbTMsiwUr43MNoxa1FECPFrvSpd",
  PRICE_FEED:      "Dgorf5LPiMttdTxWcrsiA2j94kWKw55gJLRJm8P4E1Hn",
  FEE_DISTRIBUTOR: "CHTpVtZQboxjM6N9xk1RR29jZyWqFNV77cmQNJ18RNNL",
  STAKING_PROGRAM: "35HddZHf84u6DeyLoZL3Z3a8pZ59594xu1aizj7VrAGR",
} as const;
