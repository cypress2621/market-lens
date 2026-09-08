import { binance, errorResponse } from '@/lib/binance';
import { hourlyHistory } from '@/lib/history';
import { estimateProbability } from '@/lib/probability';
type Ticker = { lastPrice: string; closeTime: number };
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams,
    symbol = q.get('symbol') || 'BTCUSDT',
    horizon = Number(q.get('horizon') || 4),
    threshold = Number(q.get('threshold') || 1);
  if (
    !/^[A-Z0-9]{2,30}USDT$/.test(symbol) ||
    ![1, 4, 24].includes(horizon) ||
    ![0.5, 1, 2, 3, 5].includes(threshold)
  )
    return Response.json(
      { error: '交易对、时间或涨跌门槛无效' },
      { status: 400 },
    );
  try {
    const history = await hourlyHistory(symbol);
    const quote = await binance<Ticker>(
      `/api/v3/ticker/24hr?symbol=${symbol}`,
      15000,
    );
    const referencePrice = Number(quote.lastPrice),
      asOf = Number(quote.closeTime);
    if (
      !Number.isFinite(referencePrice) ||
      referencePrice <= 0 ||
      !Number.isFinite(asOf)
    )
      throw new Error('当前参考价格无效');
    const now = Date.now();
    if (
      now - asOf > 120000 ||
      !history.length ||
      now - history.at(-1)!.closeTime > 3900000
    )
      throw new Error('行情数据已过期，请刷新后重试');
    const estimate = estimateProbability(history, horizon, threshold, now);
    return Response.json({
      ...estimate,
      symbol,
      referencePrice,
      asOf,
      targetTime: asOf + horizon * 3600000,
      upPrice: referencePrice * (1 + threshold / 100),
      downPrice: referencePrice * (1 - threshold / 100),
      method: 'historical-analogs-v1',
      calibrated: false,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
