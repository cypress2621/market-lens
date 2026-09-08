import { binance } from './binance';
import type { Candle } from './analytics';
type Raw = (string | number)[][];
const saved = new Map<string, { hour: number; candles: Candle[] }>();
const inflight = new Map<string, Promise<Candle[]>>();

/** Up to 12,000 hourly candles, about 500 days, shared between controls. */
export async function hourlyHistory(symbol: string): Promise<Candle[]> {
  const hour = Math.floor(Date.now() / 3600000),
    hit = saved.get(symbol);
  if (hit?.hour === hour) return hit.candles;
  const pending = inflight.get(symbol);
  if (pending) return pending;
  if (inflight.size >= 2) throw new Error('正在读取其他币种历史，请稍后重试');
  const work = (async () => {
    const all: Candle[] = [];
    let end = hour * 3600000 - 1;
    for (let page = 0; page < 12; page++) {
      const raw = await binance<Raw>(
        `/api/v3/klines?symbol=${symbol}&interval=1h&limit=1000&endTime=${end}`,
        0,
      );
      if (!Array.isArray(raw)) throw new Error('历史 K 线数据格式异常');
      if (!raw.length) break;
      const mapped = raw.map((k) => ({
        time: +k[0],
        open: +k[1],
        high: +k[2],
        low: +k[3],
        close: +k[4],
        volume: +k[5],
        closeTime: +k[6],
      }));
      all.push(...mapped);
      const earliest = mapped[0].time;
      if (raw.length < 1000 || earliest <= 0) break;
      end = earliest - 1;
    }
    const candles = [...new Map(all.map((c) => [c.time, c])).values()].sort(
      (a, b) => a.time - b.time,
    );
    if (saved.size >= 8) saved.delete(saved.keys().next().value!);
    saved.set(symbol, { hour, candles });
    return candles;
  })();
  inflight.set(symbol, work);
  try {
    return await work;
  } finally {
    inflight.delete(symbol);
  }
}
