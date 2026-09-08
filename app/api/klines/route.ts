import { binance, errorResponse } from '@/lib/binance';
import { analyze, type Candle } from '@/lib/analytics';
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams,
    symbol = q.get('symbol') || 'BTCUSDT',
    interval = q.get('interval') || '1h';
  if (
    !/^[A-Z0-9]{2,30}USDT$/.test(symbol) ||
    !['15m', '1h', '4h', '1d'].includes(interval)
  )
    return Response.json({ error: '交易对或周期无效' }, { status: 400 });
  try {
    const raw = await binance<(string | number)[][]>(
      `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=240`,
      60000,
    );
    const candles: Candle[] = raw.map((k) => ({
      time: +k[0],
      open: +k[1],
      high: +k[2],
      low: +k[3],
      close: +k[4],
      volume: +k[5],
      closeTime: +k[6],
    }));
    return Response.json({
      candles,
      analysis: analyze(candles),
      symbol,
      interval,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
