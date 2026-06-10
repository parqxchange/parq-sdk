import { IndexerClient } from "../client";
import type { StatsResponse } from "../types";

describe("IndexerClient.getStats", () => {
  let fetchSpy: jest.SpyInstance;
  const sample: StatsResponse = {
    volume24h: "125000000000",
    high24h: 115.5,
    low24h: 113.8,
    priceChange24h: 0.45,
    priceChangePct24h: 0.39,
    tradeCount24h: 12,
    feeApr: null,
  };

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sample,
    } as unknown as Response);
  });
  afterEach(() => fetchSpy.mockRestore());

  it("builds the URL with the configured baseUrl", async () => {
    const client = new IndexerClient("https://api.example.com");
    await client.getStats("AAPL");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.example.com/stats?market=AAPL",
      expect.any(Object),
    );
  });

  it("returns the parsed StatsResponse", async () => {
    const client = new IndexerClient("https://api.example.com");
    const r = await client.getStats("AAPL");
    expect(r).toEqual(sample);
  });

  it("encodes the market parameter", async () => {
    const client = new IndexerClient("https://api.example.com");
    await client.getStats("A&B");
    expect(fetchSpy.mock.calls[0][0]).toContain("market=A%26B");
  });

  it("trims a trailing slash on baseUrl", async () => {
    const client = new IndexerClient("https://api.example.com/");
    await client.getStats("AAPL");
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.example.com/stats?market=AAPL");
  });

  it("throws IndexerError on non-ok response", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "internal" }),
      text: async () => "internal",
    } as unknown as Response);
    const client = new IndexerClient("https://api.example.com");
    await expect(client.getStats("AAPL")).rejects.toMatchObject({
      name: "IndexerError",
      status: 500,
    });
  });

  it("passes AbortSignal.timeout and Accept header to fetch", async () => {
    const client = new IndexerClient("https://api.example.com", 30_000);
    await client.getStats("AAPL");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.example.com/stats?market=AAPL",
      expect.objectContaining({
        headers: { accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
