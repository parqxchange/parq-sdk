import { PublicKey } from "@solana/web3.js";

/**
 * PDA([b"pool", marketId], poolProgramId).
 * @param marketId - 32-byte market identifier
 * @param programId - pool-program's program ID
 * @returns [PDA public key, canonical bump]
 */
export function poolStatePDA(marketId: Uint8Array, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), marketId instanceof Buffer ? marketId : Buffer.from(marketId)],
    programId,
  );
}

/**
 * PDA([b"vault_authority", marketId], poolProgramId).
 * @param marketId - 32-byte market identifier
 * @param programId - pool-program's program ID
 * @returns [PDA public key, canonical bump]
 */
export function vaultAuthorityPDA(marketId: Uint8Array, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), marketId instanceof Buffer ? marketId : Buffer.from(marketId)],
    programId,
  );
}

/**
 * PDA([b"vault", marketId], poolProgramId).
 * This is the token account PDA that holds USDC (not an ATA — a native PDA vault).
 * @param marketId - 32-byte market identifier
 * @param programId - pool-program's program ID
 * @returns [PDA public key, canonical bump]
 */
export function usdcVaultPDA(marketId: Uint8Array, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketId instanceof Buffer ? marketId : Buffer.from(marketId)],
    programId,
  );
}

/**
 * PDA([b"lp_mint", marketId], poolProgramId).
 * @param marketId - 32-byte market identifier
 * @param programId - pool-program's program ID
 * @returns [PDA public key, canonical bump]
 */
export function lpMintPDA(marketId: Uint8Array, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint"), marketId instanceof Buffer ? marketId : Buffer.from(marketId)],
    programId,
  );
}

/**
 * PDA([b"lp_dead", marketId], poolProgramId).
 *
 * The permanently-locked dead-shares vault (Uniswap MINIMUM_LIQUIDITY). The
 * genesis deposit mints MINIMUM_LIQUIDITY LP here (no spend path exists), so
 * `lp_mint.supply` can never return to 0 after genesis. `deposit` creates it
 * lazily (`init_if_needed`) and requires it on every call.
 * @param marketId - 32-byte market identifier
 * @param programId - pool-program's program ID
 * @returns [PDA public key, canonical bump]
 */
export function lpDeadPDA(marketId: Uint8Array, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lp_dead"), marketId instanceof Buffer ? marketId : Buffer.from(marketId)],
    programId,
  );
}

/**
 * PDA([b"market", marketId], perpEngineId).
 * @param marketId - 32-byte market identifier
 * @param programId - perp-engine's program ID
 * @returns [PDA public key, canonical bump]
 */
export function marketStatePDA(marketId: Uint8Array, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), marketId instanceof Buffer ? marketId : Buffer.from(marketId)],
    programId,
  );
}

/**
 * PDA([b"position", owner, marketId, nonce_le8], perpEngineId).
 * @param owner - position owner's public key (or delegate if delegation was used at open)
 * @param marketId - 32-byte market identifier
 * @param nonce - u64 nonce (allows multiple positions per owner per market)
 * @param programId - perp-engine's program ID
 * @returns [PDA public key, canonical bump]
 */
export function positionPDA(
  owner: PublicKey,
  marketId: Uint8Array,
  nonce: bigint,
  programId: PublicKey,
): [PublicKey, number] {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(nonce);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), owner.toBuffer(), marketId instanceof Buffer ? marketId : Buffer.from(marketId), nonceBuf],
    programId,
  );
}

/**
 * PDA([b"trading_key", wallet], perpEngineId).
 * @param wallet - trading wallet's public key
 * @param programId - perp-engine's program ID
 * @returns [PDA public key, canonical bump]
 */
export function tradingKeyPDA(wallet: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("trading_key"), wallet.toBuffer()],
    programId,
  );
}

/**
 * PDA([b"oracle", marketId], oracleProgramId).
 * @param marketId - 32-byte market identifier
 * @param programId - oracle-program's program ID
 * @returns [PDA public key, canonical bump]
 */
export function marketOraclePDA(marketId: Uint8Array, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), marketId instanceof Buffer ? marketId : Buffer.from(marketId)],
    programId,
  );
}

/**
 * PDA([b"engine_auth", marketId], perpEngineId).
 * @param marketId - 32-byte market identifier
 * @param programId - perp-engine's program ID
 * @returns [PDA public key, canonical bump]
 */
export function engineAuthPDA(marketId: Uint8Array, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("engine_auth"), marketId instanceof Buffer ? marketId : Buffer.from(marketId)],
    programId,
  );
}

/**
 * PDA([b"protocol_config"], perpEngineId).
 * Singleton per-program protocol authority account holding the admin pubkey and
 * (post-Phase-1 24/7 unlock) the session tier table + RTH window.
 * @param programId - perp-engine's program ID
 * @returns [PDA public key, canonical bump]
 */
export function protocolConfigPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("protocol_config")], programId);
}

/**
 * PDA([b"feed", marketId], priceFeedProgramId).
 * This is the PriceFeed account that stores raw price bytes at offsets 4337/4353/4357.
 * @param marketId - 32-byte market identifier
 * @param programId - price-feed program ID
 * @returns [PDA public key, canonical bump]
 */
export function priceFeedPDA(marketId: Uint8Array, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("feed"), marketId instanceof Buffer ? marketId : Buffer.from(marketId)],
    programId,
  );
}

/**
 * Encode a market string (e.g. `"aapl-usdc"`) as a zero-padded 32-byte
 * `market_id` seed.
 *
 * @throws if UTF-8 encoding exceeds 32 bytes (silent truncation previously derived wrong PDAs).
 * @param s - market identifier string
 * @returns zero-padded 32-byte market identifier
 */
export function marketIdFromString(s: string): Uint8Array {
  const encoded = Buffer.from(s, "utf8");
  if (encoded.length > 32) {
    throw new Error(`marketIdFromString: identifier exceeds 32 bytes (${encoded.length})`);
  }
  const buf = new Uint8Array(32);
  buf.set(encoded);
  return buf;
}

/**
 * PDA([b"referral_config"], perpEngineId).
 * Global referral configuration account (singleton per program).
 * @param programId - perp-engine's program ID
 * @returns [PDA public key, canonical bump]
 */
export function referralConfigPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("referral_config")], programId);
}

/**
 * PDA([b"referral_code", code], perpEngineId).
 * Stores metadata for a 32-byte referral code (affiliate address, fee bps, etc.).
 * @param code - 32-byte referral code
 * @param programId - perp-engine's program ID
 * @returns [PDA public key, canonical bump]
 */
export function referralCodePDA(code: Uint8Array, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("referral_code"), code instanceof Buffer ? code : Buffer.from(code)],
    programId,
  );
}

/**
 * PDA([b"trader_referral", trader], perpEngineId).
 * Per-trader account that records which referral code (if any) this trader used.
 * @param trader - trader's public key
 * @param programId - perp-engine's program ID
 * @returns [PDA public key, canonical bump]
 */
export function traderReferralPDA(trader: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("trader_referral"), trader.toBuffer()],
    programId,
  );
}

/**
 * PDA([b"affiliate_reward", affiliate, marketId], perpEngineId).
 * Tracks accrued affiliate rewards for a given affiliate address and market.
 * @param affiliate - affiliate's public key
 * @param marketId - 32-byte market identifier
 * @param programId - perp-engine's program ID
 * @returns [PDA public key, canonical bump]
 */
export function affiliateRewardPDA(affiliate: PublicKey, marketId: Uint8Array, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("affiliate_reward"), affiliate.toBuffer(), marketId instanceof Buffer ? marketId : Buffer.from(marketId)],
    programId,
  );
}

/**
 * PDA([b"order_nonce", owner], perpEngineId).
 * Stores the current order nonce for an owner; incremented on each createOrder.
 * @param owner - order owner's public key
 * @param programId - perp-engine's program ID
 * @returns [PDA public key, canonical bump]
 */
export function orderNoncePDA(owner: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order_nonce"), owner.toBuffer()],
    programId,
  );
}

/**
 * PDA([b"order", owner, marketId, nonce_le8], perpEngineId).
 * Unique order account; nonce matches the OrderNonce value at time of createOrder.
 * @param owner - order owner's public key
 * @param marketId - 32-byte market identifier
 * @param nonce - u64 nonce (little-endian encoded into 8 bytes for the seed)
 * @param programId - perp-engine's program ID
 * @returns [PDA public key, canonical bump]
 */
export function orderPDA(owner: PublicKey, marketId: Uint8Array, nonce: bigint, programId: PublicKey): [PublicKey, number] {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(nonce);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order"), owner.toBuffer(), marketId instanceof Buffer ? marketId : Buffer.from(marketId), nonceBuf],
    programId,
  );
}

/**
 * PDA([b"payout_queue_entry", marketId, idx_le8], poolProgramId).
 * Stores a single payout-queue entry for a given market and monotonic index.
 * @param marketId - 32-byte market identifier
 * @param idx - entry index (u64, little-endian encoded into 8 bytes for the seed)
 * @param programId - pool-program's program ID
 * @returns [PDA public key, canonical bump]
 */
export function payoutQueueEntryPDA(
  marketId: Uint8Array,
  idx: bigint,
  programId: PublicKey,
): [PublicKey, number] {
  const idxLe = Buffer.alloc(8);
  idxLe.writeBigUInt64LE(idx);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("payout_queue_entry"),
      marketId instanceof Buffer ? marketId : Buffer.from(marketId),
      idxLe,
    ],
    programId,
  );
}

/**
 * PDA([b"user_queue_claims", marketId, owner], poolProgramId).
 * Tracks an LP's cumulative queue-claim state for a given market.
 * @param marketId - 32-byte market identifier
 * @param owner - LP owner's public key
 * @param programId - pool-program's program ID
 * @returns [PDA public key, canonical bump]
 */
export function userQueueClaimsPDA(
  marketId: Uint8Array,
  owner: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("user_queue_claims"),
      marketId instanceof Buffer ? marketId : Buffer.from(marketId),
      owner.toBuffer(),
    ],
    programId,
  );
}

/**
 * PDA([b"insurance_fund"], poolProgramId).
 * Singleton InsuranceFund state account holding totals + admin pubkey.
 * @param programId - pool-program's program ID
 * @returns [PDA public key, canonical bump]
 */
export function insuranceFundPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("insurance_fund")], programId);
}

/**
 * PDA([b"insurance_vault"], poolProgramId).
 * Singleton USDC vault (token account PDA) backing the insurance fund.
 * Owned by the insurance_vault_authority PDA.
 * @param programId - pool-program's program ID
 * @returns [PDA public key, canonical bump]
 */
export function insuranceVaultPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("insurance_vault")], programId);
}

/**
 * PDA([b"insurance_vault_authority"], poolProgramId).
 * Authority over the insurance vault; signs withdrawals/reimbursements.
 * @param programId - pool-program's program ID
 * @returns [PDA public key, canonical bump]
 */
export function insuranceVaultAuthorityPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("insurance_vault_authority")], programId);
}

/**
 * FeeSettings PDA — seeds: ["fee_settings", marketId]
 * @param marketId 32-byte market identifier
 * @param programId pool-program ID
 */
export function feeSettingsPDA(marketId: Uint8Array, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fee_settings"), marketId instanceof Buffer ? marketId : Buffer.from(marketId)],
    programId,
  );
}

/**
 * PDA([b"fee_pool"], feeDistributorProgramId).
 * Singleton fee-pool account for the fee-distributor program.
 * @param feeDistributorProgramId - fee-distributor program ID
 * @returns [PDA public key, canonical bump]
 */
export function feePoolPDA(feeDistributorProgramId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("fee_pool")], feeDistributorProgramId);
}

/**
 * PDA([b"staking_pool", tokenMint], programId).
 * Per-mint staking-pool account for the staking program.
 * @param tokenMint - the token mint this pool accepts for staking
 * @param programId - staking program ID
 * @returns [PDA public key, canonical bump]
 */
export function stakingPoolPDA(tokenMint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("staking_pool"), tokenMint.toBuffer()],
    programId,
  );
}

/**
 * PDA([b"stake", pool, owner], programId).
 * Per-pool per-owner stake position account.
 * @param pool - the staking pool public key
 * @param owner - staker's public key
 * @param programId - staking program ID
 * @returns [PDA public key, canonical bump]
 */
export function stakePositionPDA(pool: PublicKey, owner: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), pool.toBuffer(), owner.toBuffer()],
    programId,
  );
}
