# Parquet SDK

TypeScript client for the [Parquet](https://parquet.exchange) perpetuals protocol on Solana — Anchor program clients, account decoders, PDA helpers, dual-feed oracle resolution, and a typed indexer client.

Instruction builders return `TransactionInstruction[]` only. **You build, sign, and send** — the SDK never holds keys or sends transactions for you.

## Installation

```bash
npm install @parqxchange/sdk
# or: yarn add @parqxchange/sdk / pnpm add @parqxchange/sdk
```

Depends directly on `@solana/web3.js` ^1.98 and `@coral-xyz/anchor` ^0.32 — match these versions in your app to avoid duplicate web3.js instances. Node `>=18` for the indexer client (`AbortSignal.timeout`); discriminators are computed with `@noble/hashes`, so the main and `/minimal` entries carry no Node-only crypto — only `/node` requires Node.

## Getting Started

```typescript
import { Connection, PublicKey } from "@solana/web3.js";
import {
  PROGRAM_IDS_V4,
  IndexerClient,
  getMarketOracleFeeds,
  openPosition,
  PerpClient,
} from "@parqxchange/sdk";

const connection = new Connection("https://api.mainnet-beta.solana.com");

// 1. Read market stats from the indexer.
const indexer = new IndexerClient("https://api.parquet.exchange");
const stats = await indexer.getStats("aapl-usdc");
console.log(stats.markPrice, stats.openInterest);

// 2. Resolve the dual-feed oracle accounts for a market.
const oracleProgramId = new PublicKey(PROGRAM_IDS_V4.ORACLE_ADAPTER);
const marketId = new TextEncoder().encode("aapl-usdc"); // market id = ascii symbol
const { primaryFeed, secondaryFeed } = await getMarketOracleFeeds(
  connection,
  marketId,
  oracleProgramId,
);

// 3. Build an openPosition instruction (you sign + send it).
const perpClient = new PerpClient(program); // your Anchor Program for the perp-engine
const ixs = await openPosition(
  {
    perpClient,
    perpEngineId: new PublicKey(PROGRAM_IDS_V4.PERP_ENGINE),
    poolProgramId: new PublicKey(PROGRAM_IDS_V4.POOL_PROGRAM),
    oracleProgramId,
    marketId,
    primaryFeedAccount: primaryFeed,
    secondaryFeedAccount: secondaryFeed,
  },
  { signer: wallet.publicKey, signerUsdc: usdcAta },
  {
    side: { long: {} },
    sizeUsdc: 1_000_000_000n,      // 1,000 USDC notional (6 decimals)
    walletCollateral: 100_000_000n, // 100 USDC margin
    fromQueueAmount: 0n,
    acceptablePrice: 0n,            // ⚠️ 0 = no slippage guard — set a real limit in prod
    minOutputUsdc: 0n,
    positionNonce: 0n,
    referralCode: Array(32).fill(0),
  },
);
// → add ixs to a transaction, sign with `wallet`, and send.
```

## Entry points

| Import | Use |
|--------|-----|
| `@parqxchange/sdk` | Full surface — program clients, decoders, events, indexer, PDA + oracle helpers. |
| `@parqxchange/sdk/minimal` | Perp trading actions + `getMarketOracleFeeds` only (smaller dependency graph). |
| `@parqxchange/sdk/node` | `loadTradingKeypair` and other Node/`fs` helpers. **Never import from browser bundles.** |
| `@parqxchange/sdk/risk/score` | Health→risk-score + named-state ladder (`riskScoreFromHealthMilli`, `RISK_STATES`) only — tiny, dependency-free. |

## API surface

- **Program clients** — `PerpClient`, `PoolClient`, `OracleClient`, `PriceFeedClient`, `FeeDistributorClient`, `StakingClient`
- **Actions** (build instructions) — `openPosition`, `closePosition`, `updateMargin`, `addLiquidity`, `removeLiquidity`, `crankFundingRate`
- **Account resolvers** — `resolveOpenPositionAccounts`, `resolveClosePositionAccounts`, `resolveUpdateMarginAccounts`, `resolveLiquidityAccounts`
- **Unified-LP-pool (category) helpers** — `resolveCategoryTradeAccounts`, `categoryBuilderArg` for markets backed by a shared `CategoryPool` (the consolidated `equity-us` pool)
- **Oracle** — `getMarketOracleFeeds`, `clearMarketOracleFeedsCache`
- **Decoders** — `decodePosition`, `decodeMarketState`, `decodePoolState`, `decodeCategoryPool`, `decodeMarketRisk`, `decodeOrder`, … and `identifyAccountType` (`poolShapeOf` distinguishes a legacy `PoolState` from a `CategoryPool`)
- **Events** — `ParquetEventEmitter`, `decodeAnchorEvent`
- **Indexer** — `IndexerClient` (`getStats`)
- **Auth** — `registerTradingKey` / `revokeTradingKey` (+ `buildRegisterTradingKeyIx` / `buildRevokeTradingKeyIx`)
- **Session keys** — `generateSessionKey`, `buildEnableSession`, `signWithSession` (ephemeral delegate keys for delegated / one-click trading)
- **Risk score** — `riskScoreFromHealthMilli`, `riskStateFromHealthMilli`, `RISK_STATES` (also a standalone `@parqxchange/sdk/risk/score` entry)
- **Deposit (Jupiter)** — `getSwapQuote`, `buildSwapTransaction` (keyless swap-to-USDC; returns an unsigned transaction)
- **Constants / utils** — `PROGRAM_IDS_V4`, `withComputeBudget`, `buildVersionedTransaction`, PDA helpers

## Decoding on-chain errors

```typescript
import { decodeError, isParquetError, ParquetError } from "@parqxchange/sdk";

try {
  await program.methods.openPosition(/* … */).rpc();
} catch (err) {
  // Pass the caught error OBJECT (Anchor error or RPC "custom program error: 0x…").
  if (isParquetError(err, ParquetError.BelowMinCollateral)) {
    // handle insufficient collateral
  }
  console.log(decodeError(err)); // → ParquetError code, or null
}
```

`decodeError` takes the caught error object, never a raw number.

## Production notes

- **Set slippage guards.** `acceptablePrice` / `minOutputUsdc` of `0n` disable protection.
- **Always pass both oracle feeds** from `getMarketOracleFeeds` (or a resolver) on open/close — never hardcode feed PDAs.
- **Keep `loadTradingKeypair` server-side** (`/node` entry) so bundlers don't pull `fs` into the browser.
- `decodeAnchorEvent` returns `null` for unknown/malformed/truncated payloads — validate at app boundaries.

## Documentation

Full reference, market ids, and the complete production checklist: **[docs.parquet.exchange/developer/sdk](https://docs.parquet.exchange/developer/sdk)**

## License

MIT
