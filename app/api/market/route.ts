import { binance, errorResponse } from '@/lib/binance';
import type { MarketRow } from '@/lib/analytics';
type Ticker = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
  openPrice: string;
  closeTime: number;
};
type Info = {
  symbols: {
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    status: string;
    isSpotTradingAllowed: boolean;
  }[];
};
export async function GET() {
  try {
    const [info, tickers] = await Promise.all([
      binance<Info>('/api/v3/exchangeInfo', 3600000),
      binance<Ticker[]>('/api/v3/ticker/24hr'),
    ]);
    const symbols = new Map(
      info.symbols
        .filter(
          (s) =>
            s.quoteAsset === 'USDT' &&
            s.status === 'TRADING' &&
            s.isSpotTradingAllowed,
        )
        .map((s) => [s.symbol, s.baseAsset]),
    );
    const rows: MarketRow[] = tickers
      .filter((t) => symbols.has(t.symbol) && Number(t.lastPrice) > 0)
      .map((t) => ({
        symbol: t.symbol,
        base: symbols.get(t.symbol)!,
        price: +t.lastPrice,
        change: +t.priceChangePercent,
        volume: +t.quoteVolume,
        high: +t.highPrice,
        low: +t.lowPrice,
        amplitude:
          +t.openPrice > 0
            ? ((+t.highPrice - +t.lowPrice) / +t.openPrice) * 100
            : 0,
        closeTime: t.closeTime,
      }))
      .sort((a, b) => b.volume - a.volume);
    return Response.json({
      rows,
      asOf: Math.max(...rows.map((r) => r.closeTime)),
      source: 'Binance Spot · data-api.binance.vision',
    });
  } catch (e) {
    return errorResponse(e);
  }
}
