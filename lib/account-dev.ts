import { createHmac, createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { fetch, ProxyAgent } from 'undici';
import type { Plugin } from 'vite';
import type { Candle } from './analytics.ts';
import {
  buildPositionAnalysis,
  type AutoPositionAnalysis,
} from './position-auto.ts';
import {
  accountDataFresh,
  defaultRule,
  positionRisks,
  validateRule,
  type Position,
  type PositionRule,
} from './position-risk.ts';

type Credentials = { key: string; secret: string };
class AccountError extends Error {}
type Row = Record<string, unknown>;
type Event = {
  id: string;
  positionId: string;
  symbol: string;
  severity: 'danger' | 'warning' | 'info';
  message: string;
  time: number;
  acknowledged: boolean;
};
type Snapshot = {
  connected: boolean;
  asOf: number;
  error: string;
  positions: Position[];
  rules: Record<string, PositionRule>;
  events: Event[];
  wallet: number | null;
  available: number | null;
};
const blank = (): Snapshot => ({
  connected: false,
  asOf: 0,
  error: '',
  positions: [],
  rules: {},
  events: [],
  wallet: null,
  available: null,
});
const numeric = (v: unknown): number | null =>
  v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v))
    ? Number(v)
    : null;
const positive = (v: unknown) => {
  const n = numeric(v);
  return n !== null && n > 0 ? n : null;
};
export const signedReadPaths = [
  '/fapi/v3/account',
  '/fapi/v3/positionRisk',
  '/sapi/v1/account/apiRestrictions',
] as const;
export function keyIsReadOnly(v: Row): boolean {
  return (
    v.enableReading === true &&
    [
      'enableSpotAndMarginTrading',
      'enableFutures',
      'enableWithdrawals',
      'enableInternalTransfer',
      'permitsUniversalTransfer',
    ].every((k) => v[k] === false) &&
    ![
      'enableSpotAndMarginTrading',
      'enableFutures',
      'enableWithdrawals',
      'enableInternalTransfer',
      'permitsUniversalTransfer',
      'enableVanillaOptions',
      'enableMargin',
    ].some((k) => v[k] === true)
  );
}
export function accountOriginAllowed(
  host: string | undefined,
  origin: string | undefined,
  method: string,
  site?: string,
): boolean {
  if (
    !['127.0.0.1:3000', 'localhost:3000'].includes(host || '') ||
    site === 'cross-site'
  )
    return false;
  if (origin && origin !== `http://${host}`) return false;
  return method === 'GET' || origin === `http://${host}`;
}
export function normalizePositions(
  risks: Row[],
  account: Row,
  units: Map<string, string>,
): Position[] {
  const balances = Array.isArray(account.positions)
    ? (account.positions as Row[])
    : [];
  return risks.flatMap((p) => {
    const amount = numeric(p.positionAmt),
      entry = positive(p.entryPrice),
      mark = positive(p.markPrice),
      pnl = numeric(p.unRealizedProfit);
    if (amount === null || amount === 0) return [];
    if (
      !entry ||
      !mark ||
      pnl === null ||
      typeof p.symbol !== 'string' ||
      !p.symbol.endsWith('USDT')
    )
      throw new AccountError('部分仓位字段缺失，暂不能完整同步');
    const side =
      p.positionSide === 'SHORT'
        ? 'short'
        : p.positionSide === 'LONG'
          ? 'long'
          : amount < 0
            ? 'short'
            : 'long';
    const a = balances.find(
      (x) => x.symbol === p.symbol && x.positionSide === p.positionSide,
    );
    const mode =
      p.marginType === 'isolated' || a?.isolated === true
        ? 'isolated'
        : p.marginType === 'cross' || a?.isolated === false
          ? 'cross'
          : 'unknown';
    return [
      {
        id: `${p.symbol}:${side}`,
        symbol: p.symbol,
        side,
        quantity: Math.abs(amount),
        unit: units.get(p.symbol) || '合约计价单位',
        entry,
        mark,
        unrealized: pnl,
        liquidation: positive(p.liquidationPrice),
        margin:
          positive(p.positionInitialMargin) ||
          positive(a?.positionInitialMargin),
        mode,
        leverage: positive(p.leverage) || positive(a?.leverage),
        trend: 'unknown',
        analysisMode: 'automatic',
      } as Position,
    ];
  });
}
async function body(request: IncomingMessage): Promise<Row> {
  let text = '';
  for await (const chunk of request) {
    text += String(chunk);
    if (text.length > 8192) throw new AccountError('请求过大');
  }
  return JSON.parse(text) as Row;
}
export function accountDev(proxy: string, root: string): Plugin {
  const agent = proxy ? new ProxyAgent(proxy) : undefined;
  let credentials: Credentials | null = null,
    generation = 0,
    loading = false,
    enriching = false,
    snapshot = blank(),
    accountId = '',
    rulesError = '',
    allRules: Record<string, Record<string, PositionRule>> = {};
  const analysisErrors = new Map<string, string>();
  const active = new Map<string, number>(),
    publicCache = new Map<string, { at: number; data: unknown }>();
  const autoPlans = new Map<string, AutoPositionAnalysis>();
  const rulesPath = join(root, '.local-data', 'position-rules.json');
  let serialWrite = Promise.resolve();
  const saveRule = (owner: string, id: string, rule: PositionRule) => {
    serialWrite = serialWrite
      .catch(() => {})
      .then(async () => {
        const next = {
          ...allRules,
          [owner]: { ...allRules[owner], [id]: rule },
        };
        await mkdir(join(root, '.local-data'), { recursive: true });
        await writeFile(rulesPath + '.tmp', JSON.stringify(next), {
          encoding: 'utf8',
          mode: 0o600,
        });
        await rename(rulesPath + '.tmp', rulesPath);
        allRules = next;
      });
    return serialWrite;
  };
  async function readPublic<T>(path: string, ttl = 60000): Promise<T> {
    const hit = publicCache.get(path);
    if (hit && Date.now() - hit.at < ttl) return hit.data as T;
    const r = await fetch('https://fapi.binance.com' + path, {
      dispatcher: agent,
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new AccountError('合约行情暂时无法连接');
    const d = await r.json();
    if (publicCache.size > 150)
      publicCache.delete(publicCache.keys().next().value!);
    publicCache.set(path, { at: Date.now(), data: d });
    return d as T;
  }
  async function signed(
    c: Credentials,
    path:
      | '/fapi/v3/account'
      | '/fapi/v3/positionRisk'
      | '/sapi/v1/account/apiRestrictions',
  ): Promise<unknown> {
    if (!signedReadPaths.includes(path))
      throw new AccountError('不支持的账户读取接口');
    const clock = await readPublic<{ serverTime: number }>('/fapi/v1/time', 0);
    const query = new URLSearchParams({
      timestamp: String(clock.serverTime),
      recvWindow: '5000',
    }).toString();
    const signature = createHmac('sha256', c.secret)
      .update(query)
      .digest('hex');
    const host = path.startsWith('/sapi/')
      ? 'https://api.binance.com'
      : 'https://fapi.binance.com';
    const r = await fetch(`${host}${path}?${query}&signature=${signature}`, {
      dispatcher: agent,
      redirect: 'error',
      headers: { 'X-MBX-APIKEY': c.key },
      signal: AbortSignal.timeout(12000),
    });
    const result = (await r.json()) as Row;
    if (!r.ok) {
      const code = Number(result.code);
      throw new AccountError(
        code === -2015 || code === -2014
          ? '币安拒绝读取：请核对 API 读取权限和 IP 限制，不要为此开启交易或提现权限'
          : code === -1021
            ? '请求时间校验失败，请重试'
            : `账户读取失败（${Number.isFinite(code) ? code : r.status}），请稍后重试`,
      );
    }
    return result;
  }
  async function collect(c: Credentials): Promise<{
    positions: Position[];
    wallet: number | null;
    available: number | null;
    asOf: number;
  }> {
    // Conservative freshness: start of account request, never completion of analytics.
    const asOf = Date.now();
    const [account, risks, info] = await Promise.all([
      signed(c, '/fapi/v3/account'),
      signed(c, '/fapi/v3/positionRisk'),
      readPublic<{ symbols: { symbol: string; baseAsset: string }[] }>(
        '/fapi/v1/exchangeInfo',
        3600000,
      ),
    ]);
    if (!account || !Array.isArray(risks))
      throw new AccountError('账户响应格式异常');
    const positions = normalizePositions(
      risks as Row[],
      account as Row,
      new Map(info.symbols.map((s) => [s.symbol, s.baseAsset])),
    );
    for (const p of positions) {
      p.analysisMode = 'automatic';
      p.analysisError = analysisErrors.get(p.id);
      const auto = autoPlans.get(p.id);
      if (auto?.basisEntry === p.entry) {
        p.auto = auto;
        p.trend =
          !auto.error && Date.now() - auto.updatedAt <= 180000
            ? auto.trend
            : 'unknown';
      } else autoPlans.delete(p.id);
    }
    for (const id of autoPlans.keys())
      if (!positions.some((p) => p.id === id)) autoPlans.delete(id);
    const a = account as Row,
      usdt = Array.isArray(a.assets)
        ? (a.assets as Row[]).find((x) => x.asset === 'USDT')
        : undefined;
    return {
      positions,
      wallet: numeric(usdt?.walletBalance),
      available: numeric(usdt?.availableBalance),
      asOf,
    };
  }
  async function enrichPositions() {
    if (enriching || !credentials) return;
    enriching = true;
    const current = generation,
      positions = snapshot.positions.map((p) => ({ ...p }));
    let index = 0;
    async function worker() {
      while (index < positions.length && current === generation) {
        const p = positions[index++];
        const previous = autoPlans.get(p.id);
        if (
          previous &&
          !previous.error &&
          Date.now() - previous.updatedAt < 120000
        )
          continue;
        try {
          const load = async (interval: string) => {
            const raw = await readPublic<(string | number)[][]>(
              '/fapi/v1/klines?symbol=' +
                p.symbol +
                '&interval=' +
                interval +
                '&limit=240',
              120000,
            );
            return raw.map((k) => ({
              time: +k[0],
              open: +k[1],
              high: +k[2],
              low: +k[3],
              close: +k[4],
              volume: +k[5],
              closeTime: +k[6],
            })) as Candle[];
          };
          const [h, f, q, info] = await Promise.all([
            load('1h'),
            load('4h'),
            load('15m'),
            readPublic<{
              symbols: {
                symbol: string;
                filters: { filterType: string; tickSize?: string }[];
              }[];
            }>('/fapi/v1/exchangeInfo', 3600000),
          ]);
          if (current !== generation) return;
          const live = snapshot.positions.find(
            (x) => x.id === p.id && x.entry === p.entry,
          );
          if (!live || snapshot.error || !accountDataFresh(snapshot.asOf))
            continue;
          const tick = Number(
            info.symbols
              .find((x) => x.symbol === p.symbol)
              ?.filters?.find((x) => x.filterType === 'PRICE_FILTER')?.tickSize,
          );
          const auto = buildPositionAnalysis(
            live,
            h,
            f,
            q,
            tick,
            autoPlans.get(p.id),
          );
          autoPlans.set(p.id, auto);
          analysisErrors.delete(p.id);
          snapshot.positions = snapshot.positions.map((x) =>
            x.id === p.id
              ? { ...x, auto, trend: auto.trend, analysisError: undefined }
              : x,
          );
          check();
        } catch {
          if (current !== generation) return;
          const message =
            '技术行情不足或暂不可用，系统不生成新的止盈止损；稍后会自动重试';
          analysisErrors.set(p.id, message);
          snapshot.positions = snapshot.positions.map((x) =>
            x.id === p.id
              ? { ...x, analysisError: message, trend: 'unknown' }
              : x,
          );
          const old = autoPlans.get(p.id);
          if (old) {
            const auto = {
              ...old,
              error: '技术行情暂缺，保留此前系统价格线；当前趋势未知',
            };
            autoPlans.set(p.id, auto);
            snapshot.positions = snapshot.positions.map((x) =>
              x.id === p.id ? { ...x, auto, trend: 'unknown' } : x,
            );
          }
        }
      }
    }
    try {
      await Promise.all([worker(), worker(), worker()]);
    } finally {
      enriching = false;
    }
  }
  function check() {
    if (!snapshot.connected) return;
    const fresh = !snapshot.error && accountDataFresh(snapshot.asOf);
    const present = new Set<string>();
    for (const p of snapshot.positions) {
      for (const r of positionRisks(
        p,
        snapshot.rules[p.id] || defaultRule,
        Date.now(),
        fresh,
      )) {
        const key = `${p.id}:${r.code}`;
        present.add(key);
        const previous = active.get(key);
        if (
          !previous ||
          (r.severity === 'danger' && Date.now() - previous > 300000)
        ) {
          snapshot.events.unshift({
            id: randomUUID(),
            positionId: p.id,
            symbol: p.symbol,
            severity: r.severity,
            message: r.message,
            time: Date.now(),
            acknowledged: false,
          });
          active.set(key, Date.now());
        }
      }
    }
    for (const key of active.keys())
      if (!present.has(key) && (fresh || key.endsWith(':deadline')))
        active.delete(key);
    snapshot.events = snapshot.events.slice(0, 100);
  }
  async function poll() {
    if (!credentials || loading) return;
    loading = true;
    const current = generation,
      c = credentials;
    try {
      const data = await collect(c);
      if (current !== generation) return;
      if (!accountDataFresh(data.asOf))
        throw new AccountError('账户同步耗时过长');
      snapshot = {
        ...snapshot,
        ...data,
        connected: true,
        error: '',
        rules: allRules[accountId] || {},
      };
      active.delete('monitor:error');
      check();
      void enrichPositions();
    } catch {
      if (current !== generation) return;
      snapshot.error =
        '账户同步中断，当前数据可能已过期，不能据此判断风险已解除';
      if (!active.has('monitor:error')) {
        snapshot.events.unshift({
          id: randomUUID(),
          positionId: 'monitor',
          symbol: '账户监控',
          severity: 'warning',
          message: snapshot.error,
          time: Date.now(),
          acknowledged: false,
        });
        snapshot.events = snapshot.events.slice(0, 100);
        active.set('monitor:error', Date.now());
      }
    } finally {
      loading = false;
      check();
    }
  }
  return {
    name: 'local-readonly-account',
    apply: 'serve',
    configureServer(server) {
      const ready = readFile(rulesPath, 'utf8')
        .then((s) => {
          const parsed = JSON.parse(s);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            throw new AccountError();
          for (const [owner, rules] of Object.entries(parsed)) {
            if (
              !/^[a-f0-9]{64}$/.test(owner) ||
              !rules ||
              typeof rules !== 'object' ||
              Array.isArray(rules)
            )
              throw new AccountError();
            for (const [id, rule] of Object.entries(rules)) {
              if (!/^[A-Z0-9_]+USDT:(long|short)$/.test(id))
                throw new AccountError();
              (rules as Record<string, PositionRule>)[id] = validateRule(rule);
            }
          }
          allRules = parsed;
        })
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') {
            rulesError =
              '预警规则文件无法读取，请恢复 .local-data/position-rules.json 后重启服务；账户连接已暂停，避免丢失规则';
            snapshot.error = rulesError;
          }
        });
      const timer = setInterval(() => {
        void poll();
      }, 10000);
      server.httpServer?.once('close', () => {
        clearInterval(timer);
        credentials = null;
        generation++;
        void agent?.close().catch(() => {});
      });
      server.middlewares.use('/__account', (request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        const reply = (status: number, data: unknown) => {
          response.statusCode = status;
          response.end(JSON.stringify(data));
        };
        const method = request.method || 'GET';
        if (
          !accountOriginAllowed(
            request.headers.host,
            request.headers.origin,
            method,
            request.headers['sec-fetch-site'] as string | undefined,
          )
        ) {
          reply(403, { error: '只允许本机网站访问账户功能' });
          return;
        }
        if (
          method !== 'GET' &&
          (request.headers['x-market-lens'] !== '1' ||
            !request.headers['content-type']?.startsWith('application/json'))
        ) {
          reply(403, { error: '请求来源校验失败' });
          return;
        }
        void (async () => {
          try {
            await ready;
            const path = new URL(request.url || '/', 'http://127.0.0.1')
              .pathname;
            if (path === '/snapshot' && method === 'GET') {
              reply(200, snapshot);
              return;
            }
            if (path === '/connect' && method === 'POST') {
              if (loading || credentials) {
                reply(409, {
                  error: '已有账户连接或同步正在进行，请先断开后重试',
                });
                return;
              }
              const current = generation;
              const data = await body(request),
                key = typeof data.key === 'string' ? data.key.trim() : '',
                secret =
                  typeof data.secret === 'string' ? data.secret.trim() : '';
              if (
                !/^[A-Za-z0-9]{16,256}$/.test(key) ||
                !/^[A-Za-z0-9]{16,256}$/.test(secret)
              ) {
                reply(400, { error: '请填写有效的 HMAC API Key 与 Secret' });
                return;
              }
              if (rulesError) throw new AccountError(rulesError);
              if (current !== generation) {
                reply(409, { error: '账户连接已取消' });
                return;
              }
              if (loading || credentials) {
                reply(409, { error: '账户连接正在进行' });
                return;
              }
              loading = true;
              try {
                const candidate = { key, secret };
                const permissions = (await signed(
                  candidate,
                  '/sapi/v1/account/apiRestrictions',
                )) as Row;
                if (!keyIsReadOnly(permissions))
                  throw new AccountError(
                    '此 Key 未启用读取，或带有交易、划转、提现权限；请使用独立的仅读取 Key',
                  );
                const data = await collect(candidate);
                if (current !== generation) {
                  reply(409, { error: '账户连接已取消' });
                  return;
                }
                if (!accountDataFresh(data.asOf))
                  throw new AccountError('账户同步耗时过长，请重试');
                credentials = candidate;
                generation++;
                accountId = createHash('sha256').update(key).digest('hex');
                snapshot = {
                  ...blank(),
                  ...data,
                  connected: true,
                  rules: allRules[accountId] || {},
                };
                active.clear();
                check();
                void enrichPositions();
                reply(200, { connected: true });
              } finally {
                loading = false;
              }
              return;
            }
            if (path === '/disconnect' && method === 'POST') {
              generation++;
              credentials = null;
              accountId = '';
              snapshot = { ...blank(), error: rulesError };
              active.clear();
              analysisErrors.clear();
              autoPlans.clear();
              reply(200, { connected: false });
              return;
            }
            if (path === '/rules' && method === 'POST') {
              if (!credentials) {
                reply(401, { error: '请先连接账户' });
                return;
              }
              const owner = accountId,
                current = generation,
                data = await body(request),
                id = typeof data.id === 'string' ? data.id : '';
              if (
                current !== generation ||
                !snapshot.positions.some((p) => p.id === id)
              ) {
                reply(400, { error: '该持仓不在当前账户中' });
                return;
              }
              let rule: PositionRule;
              try {
                rule = validateRule(data.rule);
              } catch (error) {
                throw new AccountError(
                  error instanceof Error ? error.message : '预警条件无效',
                );
              }
              try {
                await saveRule(owner, id, rule);
              } catch {
                throw new AccountError(
                  '预警规则未能保存到磁盘，请检查目录权限后重试',
                );
              }
              if (current === generation) {
                snapshot.rules = allRules[owner];
                check();
              }
              reply(200, { saved: true });
              return;
            }
            if (path === '/acknowledge' && method === 'POST') {
              const data = await body(request);
              const event = snapshot.events.find((e) => e.id === data.id);
              if (event) event.acknowledged = true;
              reply(200, { saved: true });
              return;
            }
            reply(404, { error: '没有这个操作' });
          } catch (error) {
            reply(400, {
              error:
                error instanceof AccountError
                  ? error.message
                  : '操作未完成，请检查输入后重试',
            });
          }
        })();
      });
    },
  };
}
