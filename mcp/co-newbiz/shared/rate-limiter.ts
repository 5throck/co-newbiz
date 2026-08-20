// @version 1.0.0
// Token-bucket limiter — api-spec.md/mcp-integration.md §5: write-scoped
// tools get a tighter budget than read tools, independent of the web
// session's own rate limits.
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly refillRate: number;

  constructor(
    private readonly maxTokens: number,
    windowMs: number,
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
    this.refillRate = maxTokens / windowMs;
  }

  async acquireToken(): Promise<void> {
    const now = Date.now();
    this.tokens = Math.min(this.maxTokens, this.tokens + (now - this.lastRefill) * this.refillRate);
    this.lastRefill = now;
    if (this.tokens < 1) {
      const waitMs = (1 - this.tokens) / this.refillRate;
      await new Promise((r) => setTimeout(r, waitMs));
      this.tokens = 1;
    }
    this.tokens--;
  }
}
