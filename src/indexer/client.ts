import type { StatsResponse } from "./types";

export class IndexerError extends Error {
  override name = "IndexerError";
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Typed HTTP client for the Parquet indexer.
 *
 * Today's surface is intentionally narrow — only `/stats` is wired. The
 * remaining routes (`/ohlcv`, `/events`, `/queue/:market`, `/queue/user/:wallet`,
 * `/market-hours`, `/staking`, `/staking/history`, `/fees`, `/leaderboard`,
 * `/orderbook`) ship in a future release.
 *
 * The client throws `IndexerError` on non-200 responses so callers can branch
 * on `err.status`. JSON parsing follows the route's documented shape; no
 * runtime schema validation is performed by the client itself — wrap with zod
 * in the caller if you need it (today's hooks do that for backward compat).
 *
 * HTTP requests use `fetch` with `AbortSignal.timeout(defaultTimeoutMs)` (Node 18+)
 * — responses are **not** runtime-validated beyond `JSON.parse`.
 */
export class IndexerClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly defaultTimeoutMs: number = 15_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async getStats(market: string): Promise<StatsResponse> {
    const url = `${this.baseUrl}/stats?market=${encodeURIComponent(market)}`;
    return this.fetchJson<StatsResponse>(url);
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(this.defaultTimeoutMs),
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new IndexerError(res.status, `indexer ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
}
