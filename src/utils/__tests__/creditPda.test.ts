// Jest globals: describe/test/expect available without import

import { PublicKey } from "@solana/web3.js";
import {
  creditTreasuryPda,
  creditAccountPda,
  creditVaultAuthorityPda,
  creditVaultPda,
} from "../pda";

// A stable, arbitrary pool-program ID + owner for determinism checks.
const POOL_PROGRAM = new PublicKey("11111111111111111111111111111112");
const OWNER = new PublicKey("So11111111111111111111111111111111111111112");

describe("credit PDA derivers", () => {
  test("creditTreasuryPda is deterministic and seed-correct", () => {
    const [pda, bump] = creditTreasuryPda(POOL_PROGRAM);
    const [pda2] = creditTreasuryPda(POOL_PROGRAM);
    expect(pda.toBase58()).toBe(pda2.toBase58());
    const [expected, expectedBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("credit_treasury")],
      POOL_PROGRAM,
    );
    expect(pda.toBase58()).toBe(expected.toBase58());
    expect(bump).toBe(expectedBump);
  });

  test("creditVaultPda matches the [b\"credit_vault\"] seed", () => {
    const [pda, bump] = creditVaultPda(POOL_PROGRAM);
    const [expected, expectedBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("credit_vault")],
      POOL_PROGRAM,
    );
    expect(pda.toBase58()).toBe(expected.toBase58());
    expect(bump).toBe(expectedBump);
  });

  test("creditVaultAuthorityPda matches the [b\"credit_vault_authority\"] seed", () => {
    const [pda] = creditVaultAuthorityPda(POOL_PROGRAM);
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("credit_vault_authority")],
      POOL_PROGRAM,
    );
    expect(pda.toBase58()).toBe(expected.toBase58());
  });

  test("creditAccountPda is deterministic and owner-seeded", () => {
    const [pda, bump] = creditAccountPda(OWNER, POOL_PROGRAM);
    const [pda2] = creditAccountPda(OWNER, POOL_PROGRAM);
    expect(pda.toBase58()).toBe(pda2.toBase58());
    const [expected, expectedBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("credit_account"), OWNER.toBuffer()],
      POOL_PROGRAM,
    );
    expect(pda.toBase58()).toBe(expected.toBase58());
    expect(bump).toBe(expectedBump);
  });

  test("creditAccountPda differs per owner", () => {
    const [a] = creditAccountPda(OWNER, POOL_PROGRAM);
    const [b] = creditAccountPda(POOL_PROGRAM, POOL_PROGRAM);
    expect(a.toBase58()).not.toBe(b.toBase58());
  });

  test("the three singleton credit PDAs are distinct from one another", () => {
    const t = creditTreasuryPda(POOL_PROGRAM)[0].toBase58();
    const v = creditVaultPda(POOL_PROGRAM)[0].toBase58();
    const a = creditVaultAuthorityPda(POOL_PROGRAM)[0].toBase58();
    expect(new Set([t, v, a]).size).toBe(3);
  });
});
