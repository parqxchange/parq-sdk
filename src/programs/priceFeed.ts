import { Program } from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

/** Canonical price-feed program ID (same on all clusters). */
export const PRICE_FEED_PROGRAM_ID = new PublicKey(
  "Dgorf5LPiMttdTxWcrsiA2j94kWKw55gJLRJm8P4E1Hn",
);

/**
 * Instruction builders for the `price-feed` program.
 */
export class PriceFeedClient {
  constructor(private readonly program: Program) {}

  /**
   * Build a set_admin instruction — rotate `feed.admin` to `newAdmin`.
   *
   * Mirrors programs/price-feed/src/instructions/set_admin.rs:
   *   args  = new_admin: Pubkey
   *   accts = [feed (mut, constraint current_admin == feed.admin),
   *            current_admin (signer)]
   *
   * Single-key handover (no pending-admin two-step). `newAdmin` is a plain
   * Pubkey arg, not an account, so the incoming admin need not be online.
   */
  async setAdminIx(
    accounts: {
      feed: PublicKey;
      currentAdmin: PublicKey;
    },
    args: {
      newAdmin: PublicKey;
    },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .setAdmin(args.newAdmin)
      .accounts({
        feed: accounts.feed,
        currentAdmin: accounts.currentAdmin,
      })
      .instruction();
  }
}
