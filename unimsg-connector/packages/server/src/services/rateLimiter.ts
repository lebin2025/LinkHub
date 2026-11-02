/**
 * 限流 + 指数退避重试。
 *
 * 每个平台一个令牌桶（默认容量 60、每秒补 30），发送前取令牌；
 * 发送失败最多重试 SEND_MAX_RETRY 次，间隔 1s/2s/4s（可配 base）；
 * 仍失败则抛错，由消息中枢置 failed、写 DLQ。
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Bucket { tokens: number; last: number; }

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private maxRetry = 3,
    private baseDelayMs = 1000,
    private capacity = 60,
    private refillPerSec = 30,
  ) {}

  async send<T>(platform: string, fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    let lastErr: unknown;
    for (;;) {
      try {
        await this.acquire(platform);
        return await fn();
      } catch (e) {
        lastErr = e;
        if (attempt >= this.maxRetry) break;
        attempt += 1;
        await delay(this.baseDelayMs * Math.pow(2, attempt - 1));
      }
    }
    throw lastErr;
  }

  private async acquire(platform: string): Promise<void> {
    const now = Date.now();
    const b = this.buckets.get(platform) ?? { tokens: this.capacity, last: now };
    const elapsed = (now - b.last) / 1000;
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSec);
    b.last = now;
    if (b.tokens < 1) {
      await delay(((1 - b.tokens) / this.refillPerSec) * 1000);
      b.tokens = 1;
      b.last = Date.now();
    }
    b.tokens -= 1;
    this.buckets.set(platform, b);
  }
}
