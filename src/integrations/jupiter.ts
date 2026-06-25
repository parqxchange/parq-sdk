/**
 * Keyless Jupiter swap client — quote + build-swap-tx over Jupiter's lite-api
 * HTTP surface, used by Parquet's "Swap to USDC" deposit flow (#14).
 *
 * Why it lives in the SDK and not the app: the static-export frontend ships no
 * server and holds no key, and the RN mobile app needs the SAME quote/build
 * logic. This module is therefore PURE HTTP + tx-decode — it holds no key and
 * does NO signing. `buildSwapTransaction` returns an UNSIGNED
 * `VersionedTransaction` (with Jupiter's own ALTs), which the caller signs with
 * the already-connected Solana wallet (wallet-adapter on web, MWA on mobile)
 * and submits through its own pipeline (`submitAndReconcile`).
 *
 * The 1% Parquet platform fee is taken via Jupiter's first-class
 * `platformFeeBps` (= {@link PARQUET_PLATFORM_FEE_BPS}) + a Parquet-owned
 * referral `feeAccount`, skimmed atomically inside the swap route — no extra ix,
 * no extra signature, no double-spend window. Because the fee is taken on the
 * OUTPUT mint (USDC), a single USDC referral fee account covers every input
 * token.
 *
 * Spec: docs/specs/2026-06-24-swap-to-usdc-deposit-design.md §4.3.
 */
import { PublicKey, VersionedTransaction } from "@solana/web3.js";

/** Default keyless Jupiter host. Both quote and swap live under `/swap/v1/*`.
 * Overridable per-call (`host`) for the keyed `https://api.jup.ag` host if a
 * Cloudflare Worker is ever introduced (see spec §9 static-export limitation). */
export const JUPITER_QUOTE_HOST = "https://lite-api.jup.ag";
export const JUPITER_SWAP_HOST = "https://lite-api.jup.ag";

/** Parquet's swap platform fee, in basis points (1%). */
export const PARQUET_PLATFORM_FEE_BPS = 100;

/** Jupiter's quote-response shape (only the fields we read are typed; the rest
 * is passed back to `/swap` verbatim). */
export interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  /** Expected output in base units, NET of the platform fee. */
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee: { amount: string; feeBps: number } | null;
  priceImpactPct: string;
  routePlan: unknown[];
  /** Jupiter may return additional fields; preserved opaquely for the POST. */
  [k: string]: unknown;
}

export interface GetSwapQuoteParams {
  inputMint: string;
  outputMint: string;
  /** Input amount in base units (the input mint's smallest unit). */
  amount: bigint | number | string;
  /** Slippage tolerance, bps. Defaults to 50 (0.5%) — a sane swap default. */
  slippageBps?: number;
  /** Platform fee, bps. Defaults to {@link PARQUET_PLATFORM_FEE_BPS}. */
  platformFeeBps?: number;
  /** Host override (default {@link JUPITER_QUOTE_HOST}). */
  host?: string;
  /** Abort/timeout signal. */
  signal?: AbortSignal;
}

/**
 * GET a Jupiter swap quote. Returns the raw quote-response, which is passed
 * verbatim to {@link buildSwapTransaction} (Jupiter requires the exact object
 * back, untouched).
 */
export async function getSwapQuote(params: GetSwapQuoteParams): Promise<JupiterQuote> {
  const {
    inputMint,
    outputMint,
    amount,
    slippageBps = 50,
    platformFeeBps = PARQUET_PLATFORM_FEE_BPS,
    host = JUPITER_QUOTE_HOST,
    signal,
  } = params;

  const qs = new URLSearchParams({
    inputMint,
    outputMint,
    amount: String(amount),
    slippageBps: String(slippageBps),
    platformFeeBps: String(platformFeeBps),
  });
  const url = `${host.replace(/\/+$/, "")}/swap/v1/quote?${qs.toString()}`;

  const res = await fetch(url, {
    signal: signal ?? AbortSignal.timeout(15_000),
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`jupiter quote ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as JupiterQuote;
}

export interface BuildSwapTransactionParams {
  /** The EXACT quote-response from {@link getSwapQuote} (passed back untouched). */
  quoteResponse: JupiterQuote;
  /** The wallet that will sign + own the destination USDC. */
  userPublicKey: PublicKey | string;
  /** Parquet's USDC referral fee account — receives the 1% on the output side.
   * Omit only when the platform fee is intentionally not taken. */
  feeAccount?: PublicKey | string;
  /** Host override (default {@link JUPITER_SWAP_HOST}). */
  host?: string;
  /** Abort/timeout signal. */
  signal?: AbortSignal;
}

/**
 * POST the quote to Jupiter's `/swap` and decode the returned base64
 * `swapTransaction` into an UNSIGNED `VersionedTransaction`. The caller signs +
 * submits. No key is held here and nothing is signed.
 */
export async function buildSwapTransaction(
  params: BuildSwapTransactionParams,
): Promise<VersionedTransaction> {
  const { quoteResponse, userPublicKey, feeAccount, host = JUPITER_SWAP_HOST, signal } = params;

  const userB58 =
    typeof userPublicKey === "string" ? userPublicKey : userPublicKey.toBase58();

  const body: Record<string, unknown> = {
    quoteResponse,
    userPublicKey: userB58,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
  };
  if (feeAccount != null) {
    body.feeAccount =
      typeof feeAccount === "string" ? feeAccount : feeAccount.toBase58();
  }

  const url = `${host.replace(/\/+$/, "")}/swap/v1/swap`;
  const res = await fetch(url, {
    method: "POST",
    signal: signal ?? AbortSignal.timeout(15_000),
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`jupiter swap ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = (await res.json()) as { swapTransaction?: string };
  if (!json.swapTransaction || typeof json.swapTransaction !== "string") {
    throw new Error("jupiter swap response missing swapTransaction");
  }

  const raw = Buffer.from(json.swapTransaction, "base64");
  return VersionedTransaction.deserialize(raw);
}
