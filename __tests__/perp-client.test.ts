/**
 * Tests for PerpClient read accessors.
 *
 * Strategy: construct a minimal Anchor Program mock that records the PDA the
 * client requests, returns a hardcoded `ProtocolConfig` payload, and lets the
 * test assert that BN → bigint conversion and field mapping happen correctly.
 *
 * No live RPC. The mock implements just `programId` and
 * `account.protocolConfig.fetch(pda)` — the subset PerpClient.getProtocolConfig
 * actually exercises.
 */

import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { PerpClient } from "../src/programs/perp";
import { protocolConfigPDA } from "../src/utils/pda";

const PERP_ENGINE_PROGRAM_ID = new PublicKey("6QrsMTMEu9rsLpyxQgRdvQsWoPgHGY9npNNiwTtXsbdc");

/**
 * Mirrors what `program.account.protocolConfig.fetch(pda)` returns for a freshly
 * configured devnet ProtocolConfig with the Phase 1 tier table populated.
 *
 * BN is what Anchor 0.31 actually surfaces for u64 fields; tier_breakpoints is
 * declared `[u64; 5]` on-chain so each element is a BN. u8/u16 arrive as
 * plain JS numbers.
 */
function buildRawProtocolConfig(admin: PublicKey) {
  return {
    admin,
    bump: 255,
    rthOpenMinutesUtc: 13 * 60 + 30, // 13:30 UTC (typical RTH open)
    rthCloseMinutesUtc: 20 * 60,     // 20:00 UTC
    tierBreakpointsUsdc: [
      new BN("5000000000"),       // $5K  in 6dp
      new BN("50000000000"),      // $50K
      new BN("250000000000"),     // $250K
      new BN("1000000000000"),    // $1M
      new BN("18446744073709551615"), // u64::MAX (uncapped top tier)
    ],
    rthMaxLeverage:      [250, 100, 50, 20, 10],
    offHoursMaxLeverage: [25, 15, 10, 5, 3],
  };
}

interface MockProgramShape {
  programId: PublicKey;
  account: {
    protocolConfig: {
      fetch: (pda: PublicKey) => Promise<ReturnType<typeof buildRawProtocolConfig>>;
    };
  };
}

function buildMockProgram(
  programId: PublicKey,
  raw: ReturnType<typeof buildRawProtocolConfig>,
  observedPdas: PublicKey[],
): MockProgramShape {
  return {
    programId,
    account: {
      protocolConfig: {
        fetch: async (pda: PublicKey) => {
          observedPdas.push(pda);
          return raw;
        },
      },
    },
  };
}

describe("PerpClient.getProtocolConfig", () => {
  it("fetches the singleton ProtocolConfig PDA and converts u64 fields to bigint", async () => {
    const admin = Keypair.generate().publicKey;
    const raw = buildRawProtocolConfig(admin);
    const observed: PublicKey[] = [];
    const mock = buildMockProgram(PERP_ENGINE_PROGRAM_ID, raw, observed);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = new PerpClient(mock as unknown as Program<any>);

    const cfg = await client.getProtocolConfig();

    // PDA request goes to the canonical singleton derivation.
    const [expectedPda] = protocolConfigPDA(PERP_ENGINE_PROGRAM_ID);
    expect(observed).toHaveLength(1);
    expect(observed[0]!.equals(expectedPda)).toBe(true);

    // Top-level scalars pass through.
    expect(cfg.admin.equals(admin)).toBe(true);
    expect(cfg.bump).toBe(255);
    expect(cfg.rthOpenMinutesUtc).toBe(810);
    expect(cfg.rthCloseMinutesUtc).toBe(1200);

    // Tier table — BN→bigint conversion preserves the values incl. u64::MAX.
    expect(cfg.tierBreakpointsUsdc).toHaveLength(5);
    expect(cfg.tierBreakpointsUsdc[0]).toBe(5_000_000_000n);
    expect(cfg.tierBreakpointsUsdc[1]).toBe(50_000_000_000n);
    expect(cfg.tierBreakpointsUsdc[2]).toBe(250_000_000_000n);
    expect(cfg.tierBreakpointsUsdc[3]).toBe(1_000_000_000_000n);
    expect(cfg.tierBreakpointsUsdc[4]).toBe(18_446_744_073_709_551_615n);

    // Leverage arrays come through as plain number[].
    expect(cfg.rthMaxLeverage).toEqual([250, 100, 50, 20, 10]);
    expect(cfg.offHoursMaxLeverage).toEqual([25, 15, 10, 5, 3]);
  });
});
