import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

/**
 * Probe a mint's owning token program by reading its `AccountInfo.owner`.
 *
 * The staking program accepts both legacy SPL Token and Token-2022 mints on its
 * staked side (PARQ is Token-2022; USDC reward stays legacy). The client picks
 * the program dynamically from the mint owner rather than reading a stored field
 * (`StakingPool` byte layout is unchanged — see the migration spec §5).
 *
 * @returns `TOKEN_2022_PROGRAM_ID` or `TOKEN_PROGRAM_ID`.
 * @throws if the mint account does not exist or is owned by a non-token program.
 */
export async function probeTokenProgram(
  connection: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint);
  if (!info) {
    throw new Error(`probeTokenProgram: mint ${mint.toBase58()} not found`);
  }
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  throw new Error(
    `probeTokenProgram: mint ${mint.toBase58()} is owned by ${info.owner.toBase58()}, ` +
      `not a recognized token program`,
  );
}
