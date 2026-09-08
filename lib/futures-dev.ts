import { fetch, ProxyAgent } from 'undici';
import type { Plugin } from 'vite';
const allowed = new Set([
  '/fapi/v1/exchangeInfo',
  '/fapi/v1/ticker/24hr',
  '/fapi/v1/premiumIndex',
  '/fapi/v1/fundingInfo',
  '/fapi/v1/ticker/bookTicker',
  '/fapi/v1/klines',
  '/futures/data/openInterestHist',
]);
/** Local-only transport for public Binance data. No arbitrary hosts or writes. */
export function futuresDevTransport(proxy: string): Plugin {
  const agent = proxy ? new ProxyAgent(proxy) : undefined;
  return {
    name: 'local-futures-public-data',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('close', () => {
        void agent?.close().catch(() => {});
      });
      server.middlewares.use('/__binance-futures', (request, response) => {
        if (request.method !== 'GET') {
          response.statusCode = 405;
          response.end();
          return;
        }
        const url = new URL(request.url || '/', 'http://127.0.0.1');
        if (!allowed.has(url.pathname)) {
          response.statusCode = 404;
          response.end();
          return;
        }
        // Only the fixed Binance host can be reached. Strip headers/cookies and
        // reject signed or credential-bearing queries rather than forwarding them.
        if (
          [...url.searchParams.keys()].some(
            (k) => !['symbol', 'interval', 'limit', 'period'].includes(k),
          )
        ) {
          response.statusCode = 400;
          response.end();
          return;
        }
        void (async () => {
          try {
            const upstream = await fetch(
              'https://fapi.binance.com' + url.pathname + url.search,
              {
                dispatcher: agent,
                signal: AbortSignal.timeout(15000),
                redirect: 'error',
              },
            );
            response.statusCode = upstream.status;
            response.setHeader('Content-Type', 'application/json');
            response.setHeader('Cache-Control', 'no-store');
            const retry = upstream.headers.get('retry-after');
            if (retry) response.setHeader('Retry-After', retry);
            response.end(await upstream.text());
          } catch {
            response.statusCode = 503;
            response.setHeader('Content-Type', 'application/json');
            response.end(
              JSON.stringify({
                msg: '合约行情暂时无法连接，请确认现有代理正在运行',
              }),
            );
          }
        })();
      });
    },
  };
}
