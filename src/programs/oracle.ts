import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

/** Anchor enum-object encoding for the on-chain `OracleType`. */
type OracleType = "pyth" | "switchboard";
function oracleTypeArg(t: OracleType): { pyth: {} } | { switchboard: {} } {
  return t === "pyth" ? { pyth: {} } : { switchboard: {} };
}

export class OracleClient {
  constructor(private readonly program: Program) {}

  /**
   * Build a register_market_oracle instruction (V2 schema).
   *
   * Mirrors programs/oracle-adapter/src/instructions/register_market_oracle.rs:
   *   args  = RegisterMarketOracleArgs { market_id, primary_oracle_type,
   *           primary_feed_account, primary_max_staleness_secs,
   *           max_confidence_pct, price_decimals }
   *   accts = [market_oracle (init,mut), admin (signer,mut),
   *            system_program, oracle_config (has_one = admin)]
   *
   * The secondary feed is left at the on-chain "disabled" sentinel; populate it
   * via {@link updateMarketOracleFeedsIx} when wiring the dual-feed fallback.
   */
  async registerMarketOracleIx(
    accounts: {
      marketOracle: PublicKey;
      admin: PublicKey;
      oracleConfig: PublicKey;
    },
    args: {
      marketId: Uint8Array;
      primaryOracleType: OracleType;
      primaryFeedAccount: PublicKey;
      primaryMaxStalenessSecs: bigint;
      maxConfidencePct: number;
      priceDecimals: number;
    },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .registerMarketOracle({
        marketId: Array.from(args.marketId),
        primaryOracleType: oracleTypeArg(args.primaryOracleType),
        primaryFeedAccount: args.primaryFeedAccount,
        primaryMaxStalenessSecs: new BN(args.primaryMaxStalenessSecs.toString()),
        maxConfidencePct: args.maxConfidencePct,
        priceDecimals: args.priceDecimals,
      })
      .accounts({
        marketOracle: accounts.marketOracle,
        admin: accounts.admin,
        systemProgram: SystemProgram.programId,
        oracleConfig: accounts.oracleConfig,
      })
      .instruction();
  }

  /**
   * Build an update_market_oracle_feeds instruction.
   *
   * Mirrors programs/oracle-adapter/src/instructions/update_market_oracle_feeds.rs:
   *   args  = UpdateMarketOracleFeedsArgs { primary_oracle_type,
   *           primary_feed_account, primary_max_staleness_secs,
   *           secondary_oracle_type, secondary_feed_account,
   *           secondary_max_staleness_secs }
   *   accts = [market_oracle (mut, has_one = admin), admin (signer)]
   *
   * `secondaryMaxStalenessSecs = 0` disables the secondary fallback (the
   * on-chain handler rejects `primaryMaxStalenessSecs = 0`).
   */
  async updateMarketOracleFeedsIx(
    accounts: {
      marketOracle: PublicKey;
      admin: PublicKey;
    },
    args: {
      primaryOracleType: OracleType;
      primaryFeedAccount: PublicKey;
      primaryMaxStalenessSecs: bigint;
      secondaryOracleType: OracleType;
      secondaryFeedAccount: PublicKey;
      secondaryMaxStalenessSecs: bigint;
    },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .updateMarketOracleFeeds({
        primaryOracleType: oracleTypeArg(args.primaryOracleType),
        primaryFeedAccount: args.primaryFeedAccount,
        primaryMaxStalenessSecs: new BN(args.primaryMaxStalenessSecs.toString()),
        secondaryOracleType: oracleTypeArg(args.secondaryOracleType),
        secondaryFeedAccount: args.secondaryFeedAccount,
        secondaryMaxStalenessSecs: new BN(args.secondaryMaxStalenessSecs.toString()),
      })
      .accounts({
        marketOracle: accounts.marketOracle,
        admin: accounts.admin,
      })
      .instruction();
  }
}
