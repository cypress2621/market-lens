const cache = new Map<string, { at: number; data: unknown }>(),
  pending = new Map<string, Promise<unknown>>();
let blockedUntil = 0;
let inFlight = 0;
const queue: (() => void)[] = [];
async function acquire() {
  if (inFlight < 6) inFlight++;
  else await new Promise<void>((resolve) => queue.push(resolve));
}
function release() {
  const next = queue.shift();
  if (next) next();
  else inFlight--;
}
export async function futuresJson<T>(path: string, ttl = 30000): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttl) return hit.data as T;
  if (Date.now() < blockedUntil)
    throw new Error('合约接口请求限流，请稍后刷新');
  const active = pending.get(path);
  if (active) return active as Promise<T>;
  const work = (async () => {
    await acquire();
    try {
      if (Date.now() < blockedUntil)
        throw new Error('合约接口请求限流，请稍后刷新');
      const base =
        process.env.NODE_ENV === 'development'
          ? 'http://127.0.0.1:3000/__binance-futures'
          : 'https://fapi.binance.com';
      const response = await fetch(base + path, {
        signal: AbortSignal.timeout(20000),
      });
      if (response.status === 429 || response.status === 418) {
        blockedUntil =
          Date.now() +
          Math.max(60, Number(response.headers.get('retry-after')) || 60) *
            1000;
        throw new Error('合约接口请求限流，请稍后刷新');
      }
      if (!response.ok)
        throw new Error(
          `合约数据连接失败 (${response.status})，请确认现有代理可用`,
        );
      const data = await response.json();
      if (cache.size >= 400) cache.delete(cache.keys().next().value!);
      cache.set(path, { at: Date.now(), data });
      return data;
    } finally {
      release();
    }
  })();
  pending.set(path, work);
  try {
    return (await work) as T;
  } finally {
    pending.delete(path);
  }
}
