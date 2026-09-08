const ORIGIN = 'https://data-api.binance.vision';
const cache = new Map<string, { at: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
let blockedUntil = 0;
export async function binance<T>(path: string, ttl = 30000): Promise<T> {
  const saved = cache.get(path);
  if (saved && Date.now() - saved.at < ttl) return saved.value as T;
  if (Date.now() < blockedUntil)
    throw new Error('Binance 请求限流，请稍后重试');
  if (pending.has(path)) return pending.get(path) as Promise<T>;
  const request = (async () => {
    const response = await fetch(ORIGIN + path, {
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 429 || response.status === 418) {
      blockedUntil =
        Date.now() +
        Math.max(60, Number(response.headers.get('retry-after')) || 60) * 1000;
      throw new Error('Binance 请求限流，请稍后重试');
    }
    if (!response.ok)
      throw new Error(`Binance 行情接口返回 ${response.status}`);
    const value = await response.json();
    if (ttl > 0) {
      if (cache.size > 1200) cache.delete(cache.keys().next().value!);
      cache.set(path, { at: Date.now(), value });
    }
    return value;
  })();
  pending.set(path, request);
  try {
    return (await request) as T;
  } finally {
    pending.delete(path);
  }
}
export function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : '行情暂时无法连接';
  return Response.json({ error: message }, { status: 503 });
}
