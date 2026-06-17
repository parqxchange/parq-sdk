import { Keypair, PublicKey } from "@solana/web3.js";
import { StakingClient } from "../src/programs/staking";

/**
 * Regression guard for the 2026-06-07 live /stake claim incident.
 *
 * `claim_reward` / `unstake` each carry FOUR `Option<>` reward accounts — the
 * BalanceBased pair (`reward_usdc` / `owner_usdc_account`) and the
 * EmissionSchedule pair (`reward_vault` / `owner_reward_account`). A caller only
 * supplies one pair. The builders MUST still pass the unused pair explicitly,
 * using the program ID as Anchor's None sentinel — Anchor 0.31 throws
 * "Account `X` not provided." if an optional account key is omitted entirely
 * (the bug: conditional `if (accounts.x) accs.x = ...` dropped the key → every
 * BalanceBased claim/unstake reverted client-side before broadcast).
 */

const PROGRAM_ID = new PublicKey("35HddZHf84u6DeyLoZL3Z3a8pZ59594xu1aizj7VrAGR");
const k = () => Keypair.generate().publicKey;

// Minimal Program mock: captures the object passed to `.accounts()` so we can
// assert the builder did NOT omit the unused optional accounts.
function mockProgram() {
  const captured: Record<string, Record<string, unknown>> = {};
  const builder = (method: string) => ({
    accounts(accs: Record<string, unknown>) {
      captured[method] = accs;
      return { instruction: async () => ({ keys: [], programId: PROGRAM_ID, data: Buffer.alloc(0) }) };
    },
  });
  const program = {
    programId: PROGRAM_ID,
    methods: {
      claimReward: () => builder("claimReward"),
      unstake: () => builder("unstake"),
    },
  };
  // StakingClient only reads `.programId` + `.methods.*` from the program.
  return { client: new StakingClient(program as never), captured };
}

describe("staking account builders — optional reward accounts (None sentinel)", () => {
  test("claimRewardIx (BalanceBased: no reward_vault) passes the None sentinel, not omit", async () => {
    const { client, captured } = mockProgram();
    const rewardUsdc = k();
    const ownerUsdcAccount = k();
    await client.claimRewardIx({
      owner: k(), stakingPool: k(), stakePosition: k(),
      rewardMint: k(), rewardUsdc, ownerUsdcAccount,
    });
    const accs = captured.claimReward;
    // The unused EmissionSchedule pair must be present == program ID (None), NOT undefined.
    expect(accs.rewardVault).toBeDefined();
    expect(accs.ownerRewardAccount).toBeDefined();
    expect((accs.rewardVault as PublicKey).equals(PROGRAM_ID)).toBe(true);
    expect((accs.ownerRewardAccount as PublicKey).equals(PROGRAM_ID)).toBe(true);
    // The supplied BalanceBased pair is preserved verbatim.
    expect((accs.rewardUsdc as PublicKey).equals(rewardUsdc)).toBe(true);
    expect((accs.ownerUsdcAccount as PublicKey).equals(ownerUsdcAccount)).toBe(true);
  });

  test("unstakeIx (BalanceBased: no reward_vault) passes the None sentinel, not omit", async () => {
    const { client, captured } = mockProgram();
    await client.unstakeIx({
      owner: k(), stakingPool: k(), stakePosition: k(),
      stakedVault: k(), ownerTokenAccount: k(), stakedMint: k(), rewardMint: k(),
      rewardUsdc: k(), ownerUsdcAccount: k(),
    });
    const accs = captured.unstake;
    expect(accs.rewardVault).toBeDefined();
    expect(accs.ownerRewardAccount).toBeDefined();
    expect((accs.rewardVault as PublicKey).equals(PROGRAM_ID)).toBe(true);
    expect((accs.ownerRewardAccount as PublicKey).equals(PROGRAM_ID)).toBe(true);
  });

  test("EmissionSchedule side is preserved when supplied (vault, not USDC)", async () => {
    const { client, captured } = mockProgram();
    const rewardVault = k();
    const ownerRewardAccount = k();
    await client.claimRewardIx({
      owner: k(), stakingPool: k(), stakePosition: k(),
      rewardMint: k(), rewardVault, ownerRewardAccount,
    });
    const accs = captured.claimReward;
    expect((accs.rewardVault as PublicKey).equals(rewardVault)).toBe(true);
    expect((accs.ownerRewardAccount as PublicKey).equals(ownerRewardAccount)).toBe(true);
    // Unused BalanceBased pair → None sentinel.
    expect((accs.rewardUsdc as PublicKey).equals(PROGRAM_ID)).toBe(true);
    expect((accs.ownerUsdcAccount as PublicKey).equals(PROGRAM_ID)).toBe(true);
  });
});
