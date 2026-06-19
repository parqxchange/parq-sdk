/**
 * Unified-LP-pool (Phase 3) — off-chain category-shape builder coverage.
 *
 *  1. resolveCategoryTradeAccounts: shape detection + deterministic PDA derivation
 *     (returns null for legacy, the full category set for a CategoryPool).
 *  2. The four perp builders insert the PINNED category remaining-accounts
 *     [2]=marketRisk(writable), [3]=categoryEngineAuth right after the two feeds,
 *     preserving the trailing queue/fee tail — matching tests/category-pool/dual_shape.ts.
 *
 * No live RPC: a minimal Program mock records the remainingAccounts the builder
 * emits. The on-chain contract itself is validated end-to-end on a local validator
 * by tests/category-pool/dual_shape.ts; this locks the off-chain wiring.
 */
import { createHash } from "crypto";
import {
  AccountMeta,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { PerpClient } from "../src/programs/perp";
import {
  resolveCategoryTradeAccounts,
  categoryBuilderArg,
} from "../src/utils/category-shape";
import {
  categoryVaultPDA,
  categoryVaultAuthorityPDA,
  categoryLpMintPDA,
  marketRiskPDA,
  engineAuthPDA,
  feeSettingsPDA,
} from "../src/utils/pda";
import { DISCRIMINATORS } from "../src/decode";

const PERP = new PublicKey("6QrsMTMEu9rsLpyxQgRdvQsWoPgHGY9npNNiwTtXsbdc");
const POOL = new PublicKey("Acme8JzWrvVqGJz7nTKVsLYisN6MtP83nrs4fVAeXJsN");

// ── minimal Program mock that records remainingAccounts ─────────────────────
interface Chain {
  accounts(a: Record<string, unknown>): Chain;
  remainingAccounts(a: AccountMeta[]): Chain;
  instruction(): Promise<TransactionInstruction>;
}
function mockProgram(): any {
  const make = (name: string): Chain => {
    let ra: AccountMeta[] = [];
    const chain: Chain = {
      accounts() { return chain; },
      remainingAccounts(a) { ra = a; return chain; },
      async instruction() {
        const disc = createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
        return new TransactionInstruction({ programId: PERP, keys: ra, data: Buffer.from(disc) });
      },
    };
    return chain;
  };
  return {
    programId: PERP,
    methods: new Proxy({}, { get: (_t, p: string) => () => make(p) }),
  };
}

function catPoolBytes(categoryId: string): Buffer {
  const b = Buffer.alloc(264);
  DISCRIMINATORS.CategoryPool.copy(b, 0);
  Buffer.from(categoryId, "utf8").copy(b, 8); // category_id @ [8..40]
  return b;
}
function legacyPoolBytes(): Buffer {
  const b = Buffer.alloc(260);
  DISCRIMINATORS.PoolState.copy(b, 0);
  return b;
}
function mid(s: string): Uint8Array {
  const u = new Uint8Array(32);
  u.set(Buffer.from(s, "utf8"));
  return u;
}

describe("resolveCategoryTradeAccounts", () => {
  const catPool = Keypair.generate().publicKey;
  const marketId = mid("mstr-usdc");
  const catId = "equity-us";

  it("returns null for a legacy PoolState", () => {
    expect(resolveCategoryTradeAccounts(legacyPoolBytes(), catPool, marketId, POOL, PERP)).toBeNull();
  });

  it("derives the full category account set from CategoryPool bytes", () => {
    const r = resolveCategoryTradeAccounts(catPoolBytes(catId), catPool, marketId, POOL, PERP)!;
    expect(r).not.toBeNull();
    const cidBuf = mid(catId);
    expect(Buffer.from(r.categoryId)).toEqual(Buffer.from(cidBuf));
    expect(r.categoryPool.equals(catPool)).toBe(true);
    expect(r.categoryVault.equals(categoryVaultPDA(cidBuf, POOL)[0])).toBe(true);
    expect(r.categoryVaultAuthority.equals(categoryVaultAuthorityPDA(cidBuf, POOL)[0])).toBe(true);
    expect(r.categoryLpMint.equals(categoryLpMintPDA(cidBuf, POOL)[0])).toBe(true);
    expect(r.categoryFeeSettings.equals(feeSettingsPDA(cidBuf, POOL)[0])).toBe(true);
    // category engine_auth is category_id-seeded (NOT market_id-seeded)
    expect(r.categoryEngineAuth.equals(engineAuthPDA(cidBuf, PERP)[0])).toBe(true);
    expect(r.categoryEngineAuth.equals(engineAuthPDA(marketId, PERP)[0])).toBe(false);
    expect(r.marketRisk.equals(marketRiskPDA(marketId, POOL)[0])).toBe(true);
  });
});

describe("perp builders insert the pinned category remaining-accounts", () => {
  const perp = new PerpClient(mockProgram());
  const catId = "equity-us";
  const marketId = mid("mstr-usdc");
  const r = resolveCategoryTradeAccounts(catPoolBytes(catId), Keypair.generate().publicKey, marketId, POOL, PERP)!;
  const cat = categoryBuilderArg(r);
  const feed1 = Keypair.generate().publicKey;
  const feed2 = Keypair.generate().publicKey;
  const pk = () => Keypair.generate().publicKey;

  const named = {
    marketState: pk(), position: pk(), tradingKey: null, signer: pk(), owner: pk(),
    userUsdc: pk(), poolState: r.categoryPool, poolProgram: POOL, oracleProgram: pk(),
    marketOracle: pk(), vaultUsdc: r.categoryVault, vaultAuthority: r.categoryVaultAuthority,
    engineAuth: engineAuthPDA(marketId, PERP)[0], feeSettings: r.categoryFeeSettings,
    lpMint: r.categoryLpMint, insuranceFund: pk(), insuranceVault: pk(),
  };

  it("closePositionIx: [2]=marketRisk(writable), [3]=categoryEngineAuth, tail stays [queue,claims,fee]", async () => {
    const queueEntry = pk(), userClaims = pk();
    const ix = await perp.closePositionIx(named as any, null, feed1, feed2, 0n, queueEntry, userClaims, cat);
    const k = ix.keys;
    expect(k[0].pubkey.equals(feed1)).toBe(true);
    expect(k[1].pubkey.equals(feed2)).toBe(true);
    expect(k[2].pubkey.equals(r.marketRisk)).toBe(true);
    expect(k[2].isWritable).toBe(true);
    expect(k[3].pubkey.equals(r.categoryEngineAuth)).toBe(true);
    expect(k[3].isWritable).toBe(false);
    // tail preserved: [n-3]=queueEntry, [n-2]=userClaims, [n-1]=feeSettings
    expect(k[k.length - 3].pubkey.equals(queueEntry)).toBe(true);
    expect(k[k.length - 2].pubkey.equals(userClaims)).toBe(true);
    expect(k[k.length - 1].pubkey.equals(r.categoryFeeSettings)).toBe(true);
  });

  it("closePositionIx without category leaves RA legacy-shaped", async () => {
    const queueEntry = pk(), userClaims = pk();
    const ix = await perp.closePositionIx(named as any, null, feed1, feed2, 0n, queueEntry, userClaims);
    const k = ix.keys;
    expect(k.length).toBe(5); // feeds + queue + claims + fee, no category pair
    expect(k[2].pubkey.equals(queueEntry)).toBe(true);
  });

  const openArgs = {
    side: { long: {} }, sizeUsdc: 1_000_000n, walletCollateral: 5_000n,
    fromQueueAmount: 0n, acceptablePrice: 0n, minOutputUsdc: 0n,
    positionNonce: 1n, referralCode: new Array(32).fill(0),
  };

  it("openPositionIx category: RA = [feed,feed,marketRisk(w),engineAuth,feeSettings(last)]", async () => {
    const openNamed = {
      marketState: pk(), position: pk(), tradingKey: null, signer: pk(), signerUsdc: pk(),
      vaultUsdc: r.categoryVault, poolState: r.categoryPool, poolProgram: POOL,
      oracleProgram: pk(), marketOracle: pk(), engineAuth: engineAuthPDA(marketId, PERP)[0],
      userClaims: pk(), feeSettings: r.categoryFeeSettings,
    };
    const ix = await perp.openPositionIx(openNamed as any, openArgs as any, feed1, feed2, cat);
    const k = ix.keys;
    expect(k[0].pubkey.equals(feed1)).toBe(true);
    expect(k[1].pubkey.equals(feed2)).toBe(true);
    expect(k[2].pubkey.equals(r.marketRisk)).toBe(true);
    expect(k[2].isWritable).toBe(true);
    expect(k[3].pubkey.equals(r.categoryEngineAuth)).toBe(true);
    expect(k[3].isWritable).toBe(false);
    expect(k[k.length - 1].pubkey.equals(r.categoryFeeSettings)).toBe(true); // fee_settings.last()
    expect(k.length).toBe(5);
  });

  it("createOrderIx category: RA[0] = category engineAuth (for credit_collateral_category)", async () => {
    const ordNamed = {
      marketState: pk(), poolState: r.categoryPool, orderNonce: pk(), order: pk(),
      owner: pk(), ownerUsdc: pk(), vaultUsdc: r.categoryVault, poolProgram: POOL,
      engineAuth: engineAuthPDA(marketId, PERP)[0],
    };
    const ordArgs = {
      orderType: { limitIncrease: {} }, side: { long: {} }, sizeUsdc: 2_000_000_000n,
      collateralUsdc: 11_000_000n, triggerPrice: 1n, acceptablePrice: 0n, minOutputUsdc: 0n,
      referralCode: new Array(32).fill(0), positionNonce: 1n,
    };
    const ix = await perp.createOrderIx(ordNamed as any, ordArgs as any, cat);
    // create_order has no feeds: the category engine_auth is the SOLE remaining account @0.
    expect(ix.keys.some((k) => k.pubkey.equals(r.categoryEngineAuth))).toBe(true);
    const ra = ix.keys[ix.keys.length - 1];
    expect(ra.pubkey.equals(r.categoryEngineAuth)).toBe(true);
    expect(ra.isWritable).toBe(false);
  });

  it("createOrderIx without category appends no remaining accounts", async () => {
    const ordNamed = {
      marketState: pk(), poolState: pk(), orderNonce: pk(), order: pk(),
      owner: pk(), ownerUsdc: pk(), vaultUsdc: pk(), poolProgram: POOL, engineAuth: pk(),
    };
    const ordArgs = {
      orderType: { stopLossDecrease: {} }, side: { long: {} }, sizeUsdc: 1n,
      collateralUsdc: 0n, triggerPrice: 1n, acceptablePrice: 0n, minOutputUsdc: 0n,
      referralCode: new Array(32).fill(0), positionNonce: 1n,
    };
    const ix = await perp.createOrderIx(ordNamed as any, ordArgs as any);
    expect(ix.keys.some((k) => k.pubkey.equals(r.categoryEngineAuth))).toBe(false);
  });

  it("cancelOrderIx category: RA = [marketRisk(w)@0, categoryEngineAuth@1] (release_and_settle_category)", async () => {
    const cancelNamed = {
      marketState: pk(), order: pk(), signer: pk(), owner: pk(), ownerUsdc: pk(),
      vaultUsdc: r.categoryVault, vaultAuthority: r.categoryVaultAuthority,
      engineAuth: engineAuthPDA(marketId, PERP)[0], poolState: r.categoryPool, poolProgram: POOL,
    };
    const ix = await perp.cancelOrderIx(cancelNamed as any, cat);
    const ra = ix.keys.slice(-2);
    expect(ra[0].pubkey.equals(r.marketRisk)).toBe(true);
    expect(ra[0].isWritable).toBe(true);
    expect(ra[1].pubkey.equals(r.categoryEngineAuth)).toBe(true);
    expect(ra[1].isWritable).toBe(false);
  });

  it("cancelOrderIx without category appends no remaining accounts", async () => {
    const cancelNamed = {
      marketState: pk(), order: pk(), signer: pk(), owner: pk(), ownerUsdc: pk(),
      vaultUsdc: pk(), vaultAuthority: pk(), engineAuth: pk(), poolState: pk(), poolProgram: POOL,
    };
    const ix = await perp.cancelOrderIx(cancelNamed as any);
    expect(ix.keys.some((k) => k.pubkey.equals(r.marketRisk))).toBe(false);
  });

  it("openPositionIx without category leaves RA legacy [feed,feed,feeSettings]", async () => {
    const openNamed = {
      marketState: pk(), position: pk(), tradingKey: null, signer: pk(), signerUsdc: pk(),
      vaultUsdc: pk(), poolState: pk(), poolProgram: POOL, oracleProgram: pk(),
      marketOracle: pk(), engineAuth: pk(), userClaims: pk(), feeSettings: pk(),
    };
    const ix = await perp.openPositionIx(openNamed as any, openArgs as any, feed1, feed2);
    const k = ix.keys;
    expect(k.length).toBe(3);
    expect(k[2].pubkey.equals(openNamed.feeSettings)).toBe(true);
  });

  it("liquidateIx: no-clawback category path emits exactly [feed,feed,marketRisk,engineAuth]", async () => {
    const liqNamed = {
      marketState: pk(), position: pk(), liquidator: pk(), userUsdc: pk(), liquidatorUsdc: pk(),
      poolState: r.categoryPool, poolProgram: POOL, oracleProgram: pk(), marketOracle: pk(),
      vaultUsdc: r.categoryVault, vaultAuthority: r.categoryVaultAuthority, insuranceFund: pk(),
      insuranceVault: pk(), insuranceVaultAuthority: pk(), lpMint: r.categoryLpMint,
      engineAuth: engineAuthPDA(marketId, PERP)[0],
    };
    const ix = await perp.liquidateIx(liqNamed as any, feed1, feed2, [], null, false, undefined, cat);
    const k = ix.keys;
    expect(k.length).toBe(4);
    expect(k[2].pubkey.equals(r.marketRisk)).toBe(true);
    expect(k[2].isWritable).toBe(true);
    expect(k[3].pubkey.equals(r.categoryEngineAuth)).toBe(true);
  });

  it("liquidateIx: category + queue clawback → [feed,feed,marketRisk,engineAuth,...entries,userClaims]", async () => {
    const liqNamed = {
      marketState: pk(), position: pk(), liquidator: pk(), userUsdc: pk(), liquidatorUsdc: pk(),
      poolState: r.categoryPool, poolProgram: POOL, oracleProgram: pk(), marketOracle: pk(),
      vaultUsdc: r.categoryVault, vaultAuthority: r.categoryVaultAuthority, insuranceFund: pk(),
      insuranceVault: pk(), insuranceVaultAuthority: pk(), lpMint: r.categoryLpMint,
      engineAuth: engineAuthPDA(marketId, PERP)[0],
    };
    const entry0 = pk(), entry1 = pk(), userClaims = pk();
    const ix = await perp.liquidateIx(liqNamed as any, feed1, feed2, [entry0, entry1], userClaims, true, undefined, cat);
    const k = ix.keys;
    // clawback_base = 4: pinned pair precedes the entries; user_claims is last.
    expect(k[2].pubkey.equals(r.marketRisk)).toBe(true);
    expect(k[2].isWritable).toBe(true);
    expect(k[3].pubkey.equals(r.categoryEngineAuth)).toBe(true);
    expect(k[4].pubkey.equals(entry0)).toBe(true);
    expect(k[4].isWritable).toBe(true);
    expect(k[5].pubkey.equals(entry1)).toBe(true);
    expect(k[6].pubkey.equals(userClaims)).toBe(true);
    expect(k[6].isWritable).toBe(true);
    expect(k.length).toBe(7);
  });

  it("executeOrderIx: [2]=marketRisk, [3]=engineAuth, fee_settings stays last", async () => {
    const eoNamed = {
      marketState: pk(), order: pk(), position: pk(), keeper: pk(), owner: pk(), ownerUsdc: pk(),
      vaultUsdc: r.categoryVault, poolState: r.categoryPool, poolProgram: POOL, oracleProgram: pk(),
      marketOracle: pk(), vaultAuthority: r.categoryVaultAuthority, engineAuth: engineAuthPDA(marketId, PERP)[0],
      referralConfig: pk(), referralCodeAccount: pk(), traderReferral: pk(), affiliate: pk(), affiliateReward: null,
    };
    const ix = await perp.executeOrderIx(eoNamed as any, feed1, feed2, r.categoryFeeSettings, null, cat);
    const k = ix.keys;
    expect(k[2].pubkey.equals(r.marketRisk)).toBe(true);
    expect(k[3].pubkey.equals(r.categoryEngineAuth)).toBe(true);
    expect(k[k.length - 1].pubkey.equals(r.categoryFeeSettings)).toBe(true);
  });

  it("updatePositionMarginIx: category requires both feeds; emits 4-slot RA", async () => {
    const umNamed = {
      marketState: pk(), position: pk(), tradingKey: null, signer: pk(), owner: pk(), signerUsdc: pk(),
      vaultUsdc: r.categoryVault, userUsdc: pk(), vaultAuthority: r.categoryVaultAuthority,
      poolState: r.categoryPool, poolProgram: POOL, engineAuth: engineAuthPDA(marketId, PERP)[0],
      oracleProgram: pk(), marketOracle: pk(),
    };
    const ix = await perp.updatePositionMarginIx(umNamed as any, 5_000_000n, feed1, feed2, cat);
    const k = ix.keys;
    expect(k.length).toBe(4);
    expect(k[2].pubkey.equals(r.marketRisk)).toBe(true);
    expect(k[3].pubkey.equals(r.categoryEngineAuth)).toBe(true);
    // category without feeds must throw
    await expect(
      perp.updatePositionMarginIx(umNamed as any, 5_000_000n, undefined, undefined, cat),
    ).rejects.toThrow(/category shape requires both feed accounts/);
  });
});
