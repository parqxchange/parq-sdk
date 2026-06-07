/**
 * Codes mirror the generated IDL `errors[].code` (Anchor 0.31 = Rust discriminant + 6000).
 * Regenerate from the program IDL on any program error change.
 */
export enum ParquetError {
  // perp-engine — oracle (7xxx)
  PriceStale           = 7001,
  PriceUncertain       = 7002,
  OracleNoReturnData   = 7003,
  OracleReturnMismatch = 7004,
  // perp-engine — pool/position (8xxx)
  InsufficientPool            = 8001,
  LeverageExceeded            = 8002,
  BelowMinSize                = 8003,
  WrongPool                   = 8004,
  OiCapExceeded               = 8005,
  BelowMinCollateral          = 8006,
  InvalidConfig               = 8007,
  QueueCollateralExceedsClaim = 8008,
  WalletAndQueueZero          = 8009,
  MissingQueueEntryAccount    = 8010,
  LeverageExceedsTierCap      = 8011,
  MalformedQueueEntry         = 8012,
  QueueOwnerMismatch          = 8013,
  QueueMarketMismatch         = 8014,
  InitialMarginUnmet          = 8015,
  // perp-engine — health (9xxx)
  HealthFactorTooLow = 9001,
  PositionHealthy    = 9002,
  // perp-engine — auth/state (10xxx)
  TradingKeyExpired = 10001,
  Unauthorized      = 10002,
  PositionNotFound  = 10003,
  MarketPaused      = 10004,
  ProtocolHalted    = 10005,
  InvalidHaltMode   = 10006,
  // perp-engine — math (11xxx)
  MathOverflow = 11001,
  // perp-engine — orders (12xxx)
  SlippageExceeded  = 12001,
  OrderNotTriggered = 12002,
  WrongOrderType    = 12003,
  // perp-engine — referral (13xxx)
  ReferralCodeTaken     = 13001,
  ReferralCodeNotFound  = 13002,
  TraderAlreadyReferred = 13003,
  InvalidTier           = 13004,
  // perp-engine — funding (14xxx)
  FundingCadenceTooFast = 14001,
  // perp-engine — migration/fee-distribution (15xxx)
  InvalidOptimalUsage           = 15001,
  MustBePaused                  = 15002,
  MissingFeeSettings            = 15003,
  MissingAffiliateReward        = 15004,
  MissingAffiliateRewardBump    = 15005,
  MissingFeeDistributorAccounts = 15006,
  // pool-program — queue errors (Anchor base 6000 + enum index)
  QueueEntryNotPending          = 6012,
  QueueNonEmpty                 = 6013,
  PhantomEmpty                  = 6014,
  InsufficientClaim             = 6015,
  PhantomDrainInsufficientFunds = 6016,
  MissingAccount                = 6017,
  WrongEntryIndex               = 6018,
  WrongMarketId                 = 6019,
  OwnerMismatch                 = 6020,
}

/** Human-readable messages matching the IDL `errors[].msg` annotations. */
const ERROR_MESSAGES: Partial<Record<ParquetError, string>> = {
  [ParquetError.PriceStale]:           "Price feed is stale",
  [ParquetError.PriceUncertain]:       "Price confidence too wide",
  [ParquetError.OracleNoReturnData]:   "Oracle returned no data",
  [ParquetError.OracleReturnMismatch]: "Oracle return data mismatch",
  [ParquetError.InsufficientPool]:     "Insufficient pool liquidity",
  [ParquetError.LeverageExceeded]:     "Leverage exceeds max",
  [ParquetError.BelowMinSize]:         "Size below minimum",
  [ParquetError.WrongPool]:            "Wrong pool account",
  [ParquetError.OiCapExceeded]:        "Open interest cap exceeded",
  [ParquetError.BelowMinCollateral]:   "Collateral below minimum ($10)",
  [ParquetError.InvalidConfig]:        "Invalid market config — inconsistent or default-pubkey field",
  [ParquetError.QueueCollateralExceedsClaim]: "Position's collateral_from_queue exceeds available user claim",
  [ParquetError.WalletAndQueueZero]:          "Both wallet_collateral and from_queue_amount are zero",
  [ParquetError.MissingQueueEntryAccount]:    "Liquidation flow: required queue entry account missing",
  [ParquetError.LeverageExceedsTierCap]: "Requested leverage exceeds the current-session tier cap for this wallet's notional",
  [ParquetError.MalformedQueueEntry]:    "Liquidation clawback: queue entry/claims account malformed or too short",
  [ParquetError.QueueOwnerMismatch]:     "Liquidation clawback: queue entry/claims owner != liquidated position owner",
  [ParquetError.QueueMarketMismatch]:    "Liquidation clawback: queue entry/claims belongs to a different market",
  [ParquetError.InitialMarginUnmet]:     "Initial margin requirement not met (collateral below notional * initial_margin_bps)",
  [ParquetError.HealthFactorTooLow]:   "Health factor too low",
  [ParquetError.PositionHealthy]:      "Position health >= 1000, not liquidatable",
  [ParquetError.TradingKeyExpired]:    "Trading key expired",
  [ParquetError.Unauthorized]:         "Unauthorized",
  [ParquetError.PositionNotFound]:     "Position not found",
  [ParquetError.MarketPaused]:         "Market is paused",
  [ParquetError.ProtocolHalted]:       "Protocol trading is halted",
  [ParquetError.InvalidHaltMode]:      "Invalid halt mode — must be 0 (None), 1 (ReduceOnly), or 2 (Full)",
  [ParquetError.MathOverflow]:         "Math overflow",
  [ParquetError.SlippageExceeded]:     "Slippage tolerance exceeded",
  [ParquetError.OrderNotTriggered]:    "Order not triggered",
  [ParquetError.WrongOrderType]:       "Wrong order type",
  [ParquetError.ReferralCodeTaken]:    "Referral code already taken",
  [ParquetError.ReferralCodeNotFound]: "Referral code not found",
  [ParquetError.TraderAlreadyReferred]:"Trader already has a referral",
  [ParquetError.InvalidTier]:          "Invalid tier — must be 0–3",
  [ParquetError.FundingCadenceTooFast]:"update_funding_rate called within 5s of last update",
  [ParquetError.InvalidOptimalUsage]:  "Invalid optimal usage factor — must be < PRECISION",
  [ParquetError.MustBePaused]:         "Market must be paused for migration",
  [ParquetError.MissingFeeSettings]:   "Missing fee_settings remaining account",
  [ParquetError.MissingAffiliateReward]:     "Missing affiliate_reward remaining account",
  [ParquetError.MissingAffiliateRewardBump]: "Missing affiliate_reward_bump in args",
  [ParquetError.MissingFeeDistributorAccounts]: "Missing fee-distributor remaining accounts (need 4: program, fee_pool, referral_reserve, token_program)",
  // pool-program — queue
  [ParquetError.QueueEntryNotPending]:        "Queue entry is not in Pending status",
  [ParquetError.QueueNonEmpty]:               "Queue is non-empty; phantom drain requires queue_total_owed == 0",
  [ParquetError.PhantomEmpty]:                "Phantom credit is zero",
  [ParquetError.InsufficientClaim]:           "Insufficient claim for the requested from_queue_amount",
  [ParquetError.PhantomDrainInsufficientFunds]: "Pool insufficient funds to satisfy phantom drain",
  [ParquetError.MissingAccount]:              "Required account missing from remaining_accounts",
  [ParquetError.WrongEntryIndex]:             "Queue entry idx does not match queue_head_idx",
  [ParquetError.WrongMarketId]:               "Queue entry market_id mismatch",
  [ParquetError.OwnerMismatch]:               "UserQueueClaims owner mismatch with queue entry owner",
};

/** Returns the human-readable message for a ParquetError code. */
export function errorMessage(code: ParquetError): string {
  return (ERROR_MESSAGES as Record<number, string>)[code] ?? `Unknown error: ${code}`;
}

/** Set of known ParquetError numeric values for fast membership check. */
const KNOWN_ERROR_CODES = new Set<number>(
  Object.values(ParquetError).filter((v): v is number => typeof v === "number")
);

/** Extract a ParquetError code from an Anchor/RPC error, or null if not a known error. */
export function decodeError(err: unknown): ParquetError | null {
  if (typeof err !== "object" || err === null) return null;

  // Anchor structured error object
  const code = (err as { error?: { errorCode?: { number?: number } } })
    ?.error?.errorCode?.number;
  if (code !== undefined && KNOWN_ERROR_CODES.has(code)) return code as ParquetError;

  // RPC message string: "custom program error: 0x<hex>"
  const message = (err as { message?: string })?.message;
  if (typeof message === "string") {
    const match = message.match(/custom program error: 0x([0-9a-fA-F]+)/);
    if (match) {
      const parsed = parseInt(match[1], 16);
      if (KNOWN_ERROR_CODES.has(parsed)) return parsed as ParquetError;
    }
  }

  return null;
}

/** Returns true if the error is a specific ParquetError code. */
export function isParquetError(err: unknown, code: ParquetError): boolean {
  return decodeError(err) === code;
}
