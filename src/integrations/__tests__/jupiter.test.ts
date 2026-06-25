import {
  getSwapQuote,
  buildSwapTransaction,
  JUPITER_QUOTE_HOST,
  JUPITER_SWAP_HOST,
  PARQUET_PLATFORM_FEE_BPS,
  type JupiterQuote,
} from "../jupiter";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

/** A minimal but real Jupiter quote-response shape (only the fields we touch). */
function sampleQuote(): JupiterQuote {
  return {
    inputMint: JUP_MINT,
    inAmount: "1000000",
    outputMint: USDC,
    outAmount: "990000", // net of the 1% fee
    otherAmountThreshold: "985050",
    swapMode: "ExactIn",
    slippageBps: 50,
    platformFee: { amount: "10000", feeBps: 100 },
    priceImpactPct: "0.0012",
    routePlan: [],
  } as unknown as JupiterQuote;
}

/** Build a real base64 VersionedTransaction so buildSwapTransaction can decode it. */
function sampleSwapTxBase64(payer: PublicKey): string {
  const ix = SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: payer,
    lamports: 1,
  });
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [ix],
  }).compileToV0Message();
  const vtx = new VersionedTransaction(msg);
  return Buffer.from(vtx.serialize()).toString("base64");
}

describe("jupiter constants", () => {
  it("defaults to the keyless lite host and a 100 bps platform fee", () => {
    expect(JUPITER_QUOTE_HOST).toBe("https://lite-api.jup.ag");
    expect(JUPITER_SWAP_HOST).toBe("https://lite-api.jup.ag");
    expect(PARQUET_PLATFORM_FEE_BPS).toBe(100);
  });
});

describe("getSwapQuote", () => {
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleQuote(),
    } as unknown as Response);
  });
  afterEach(() => fetchSpy.mockRestore());

  it("builds the quote URL with platformFeeBps=100 and the USDC output mint", async () => {
    await getSwapQuote({
      inputMint: JUP_MINT,
      outputMint: USDC,
      amount: 1_000_000n,
      slippageBps: 50,
    });
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain(`${JUPITER_QUOTE_HOST}/swap/v1/quote`);
    expect(url).toContain(`inputMint=${JUP_MINT}`);
    expect(url).toContain(`outputMint=${USDC}`);
    expect(url).toContain("amount=1000000");
    expect(url).toContain("slippageBps=50");
    expect(url).toContain("platformFeeBps=100");
  });

  it("defaults platformFeeBps to PARQUET_PLATFORM_FEE_BPS when omitted", async () => {
    await getSwapQuote({ inputMint: JUP_MINT, outputMint: USDC, amount: 5n });
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("platformFeeBps=100");
  });

  it("accepts a string amount and forwards it verbatim", async () => {
    await getSwapQuote({ inputMint: JUP_MINT, outputMint: USDC, amount: "777" });
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("amount=777");
  });

  it("respects a host override", async () => {
    await getSwapQuote({
      inputMint: JUP_MINT,
      outputMint: USDC,
      amount: 1n,
      host: "https://api.jup.ag",
    });
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url.startsWith("https://api.jup.ag/swap/v1/quote")).toBe(true);
  });

  it("returns the parsed JupiterQuote", async () => {
    const q = await getSwapQuote({ inputMint: JUP_MINT, outputMint: USDC, amount: 1_000_000n });
    expect(q.outputMint).toBe(USDC);
    expect(q.outAmount).toBe("990000");
    expect(q.platformFee?.feeBps).toBe(100);
  });

  it("throws on a non-ok response", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "bad mint",
    } as unknown as Response);
    await expect(
      getSwapQuote({ inputMint: JUP_MINT, outputMint: USDC, amount: 1n }),
    ).rejects.toThrow(/jupiter quote 400/i);
  });
});

describe("buildSwapTransaction", () => {
  let fetchSpy: jest.SpyInstance;
  const payer = Keypair.generate().publicKey;
  const feeAccount = Keypair.generate().publicKey;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ swapTransaction: sampleSwapTxBase64(payer) }),
    } as unknown as Response);
  });
  afterEach(() => fetchSpy.mockRestore());

  it("POSTs to the swap host with the quote, user, and feeAccount in the body", async () => {
    const q = sampleQuote();
    await buildSwapTransaction({
      quoteResponse: q,
      userPublicKey: payer,
      feeAccount,
    });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${JUPITER_SWAP_HOST}/swap/v1/swap`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.quoteResponse).toEqual(q);
    expect(body.userPublicKey).toBe(payer.toBase58());
    expect(body.feeAccount).toBe(feeAccount.toBase58());
    // sane Jupiter defaults
    expect(body.wrapAndUnwrapSol).toBe(true);
    expect(body.dynamicComputeUnitLimit).toBe(true);
  });

  it("omits feeAccount from the body when not provided", async () => {
    await buildSwapTransaction({ quoteResponse: sampleQuote(), userPublicKey: payer });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect("feeAccount" in body).toBe(false);
  });

  it("accepts a base58 string userPublicKey", async () => {
    await buildSwapTransaction({
      quoteResponse: sampleQuote(),
      userPublicKey: payer.toBase58(),
      feeAccount: feeAccount.toBase58(),
    });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.userPublicKey).toBe(payer.toBase58());
  });

  it("decodes the base64 swapTransaction into a VersionedTransaction", async () => {
    const tx = await buildSwapTransaction({
      quoteResponse: sampleQuote(),
      userPublicKey: payer,
      feeAccount,
    });
    expect(tx).toBeInstanceOf(VersionedTransaction);
    expect(tx.message.staticAccountKeys[0].equals(payer)).toBe(true);
  });

  it("throws on a non-ok swap response", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => "route gone",
    } as unknown as Response);
    await expect(
      buildSwapTransaction({ quoteResponse: sampleQuote(), userPublicKey: payer }),
    ).rejects.toThrow(/jupiter swap 422/i);
  });

  it("throws when the swap response has no swapTransaction field", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as unknown as Response);
    await expect(
      buildSwapTransaction({ quoteResponse: sampleQuote(), userPublicKey: payer }),
    ).rejects.toThrow(/swapTransaction/i);
  });
});
