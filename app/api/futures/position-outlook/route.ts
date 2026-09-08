import { futuresJson } from '@/lib/futures-api';
import { horizonOutlook } from '@/lib/position-outlook';
import type { Candle } from '@/lib/analytics';
export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get('symbol') || '';
  if (!/^[A-Z0-9_]{2,30}USDT$/.test(symbol))
    return Response.json({ error: '合约名称无效' }, { status: 400 });
  try {
    const [raw, mark, info] = await Promise.all([
      futuresJson<(string | number)[][]>(
        `/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=1000`,
        120000,
      ),
      futuresJson<{ markPrice: string; time: number }>(
        `/fapi/v1/premiumIndex?symbol=${symbol}`,
        15000,
      ),
      futuresJson<{
        symbols: {
          symbol: string;
          contractType: string;
          filters: { filterType: string; tickSize?: string }[];
        }[];
      }>('/fapi/v1/exchangeInfo', 3600000),
    ]);
    const now = Date.now(),
      referencePrice = Number(mark.markPrice),
      asOf = Number(mark.time);
    const contract = info.symbols.find(
      (s) => s.symbol === symbol && s.contractType === 'PERPETUAL',
    );
    const tickSize = Number(
      contract?.filters.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize,
    );
    const bars: Candle[] = raw
      .map((k) => ({
        time: +k[0],
        open: +k[1],
        high: +k[2],
        low: +k[3],
        close: +k[4],
        volume: +k[5],
        closeTime: +k[6],
      }))
      .filter((c) => c.closeTime < now);
    if (!contract || !Number.isFinite(tickSize) || tickSize <= 0)
      throw new Error('合约规格暂不可用');
    if (
      !Number.isFinite(referencePrice) ||
      referencePrice <= 0 ||
      !Number.isFinite(asOf) ||
      asOf > now + 5000 ||
      now - asOf > 120000 ||
      !bars.length ||
      now - bars.at(-1)!.closeTime > 3900000
    )
      throw new Error('合约数据过期');
    return Response.json(
      {
        symbol,
        asOf,
        referencePrice,
        tickSize,
        historyStart: bars[0].time,
        historyEnd: bars.at(-1)!.closeTime,
        rows: [1, 4, 24].map((h) => horizonOutlook(bars, h, now)),
        chart: bars
          .slice(-72)
          .map((c) => ({ time: c.closeTime, close: c.close })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { error: '合约参考暂不可用，请稍后更新；仍可手动设置计划' },
      { status: 503 },
    );
  }
}
