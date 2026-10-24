/** Fixed-window limits per key (visitor stall, IP) so the public demo can't exhaust the free AI quota. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; used: number }>();

  /** Returns 0 if allowed, otherwise the seconds until the window resets. */
  hit(key: string, max: number, windowMs: number): number {
    const now = Date.now();
    const w = this.windows.get(key);
    if (!w || now - w.start >= windowMs) {
      this.windows.set(key, { start: now, used: 1 });
      if (this.windows.size > 50_000) this.prune(now);
      return 0;
    }
    if (w.used >= max) return Math.ceil((w.start + windowMs - now) / 1000);
    w.used++;
    return 0;
  }

  private prune(now: number) {
    for (const [k, w] of this.windows) if (now - w.start > 24 * 3600 * 1000) this.windows.delete(k);
  }
}

export interface Limit {
  name: string;
  max: number;
  windowMs: number;
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export const LIMITS = {
  extract: { name: "AI listing drafts", max: 15, windowMs: HOUR },
  shop: { name: "shopping assistant runs", max: 10, windowMs: HOUR },
  simulate: { name: "test shopper batches", max: 4, windowMs: 10 * MIN },
  instagram: { name: "Instagram imports", max: 10, windowMs: HOUR },
  aiDaily: { name: "AI requests across the whole demo today", max: 1500, windowMs: 24 * HOUR },
} satisfies Record<string, Limit>;
