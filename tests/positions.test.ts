import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import type { ViteDevServer } from 'vite';
import {
  accountDev,
  accountOriginAllowed,
  keyIsReadOnly,
  normalizePositions,
  signedReadPaths,
} from '../lib/account-dev.ts';
import {
  accountDataFresh,
  defaultRule,
  liquidationDistance,
  positionRisks,
  validateRule,
  type Position,
} from '../lib/position-risk.ts';

const position: Position = {
  id: 'TESTUSDT:long',
  symbol: 'TESTUSDT',
  unit: 'TEST',
  side: 'long',
  quantity: 2,
  entry: 100,
  mark: 100,
  unrealized: 0,
  liquidation: 80,
  margin: 20,
  mode: 'isolated',
  leverage: null,
  trend: 'unknown',
};
const permissions = {
  enableReading: true,
  enableSpotAndMarginTrading: false,
  enableFutures: false,
  enableWithdrawals: false,
  enableInternalTransfer: false,
  permitsUniversalTransfer: false,
};
const riskRow = {
  symbol: '1000TESTUSDT',
  positionSide: 'BOTH',
  positionAmt: '-2',
  entryPrice: '100',
  markPrice: '95',
  unRealizedProfit: '10',
  liquidationPrice: '130',
};
const credentials = {
  key: 'TESTKEY01234567890123456789012345',
  secret: 'TESTSECRET0123456789012345678901',
};

void test('long and short stop/profit triggers use mark price in the right direction', () => {
  const rule = { ...defaultRule, stop: 95, takeProfit: 110 };
  assert.equal(positionRisks({ ...position, mark: 95 }, rule)[0].code, 'stop');
  assert.equal(
    positionRisks({ ...position, mark: 110 }, rule)[0].code,
    'profit',
  );
  assert.deepEqual(positionRisks(position, rule), []);
  const short = { ...position, side: 'short' as const, liquidation: 130 };
  assert.equal(
    positionRisks(
      { ...short, mark: 105 },
      { ...rule, stop: 105, takeProfit: 90 },
    )[0].code,
    'stop',
  );
  assert.equal(
    positionRisks(
      { ...short, mark: 90 },
      { ...rule, stop: 105, takeProfit: 90 },
    )[0].code,
    'profit',
  );
});
void test('loss is based on actual unrealized USDT loss, not margin times leverage', () => {
  assert.equal(
    positionRisks(
      { ...position, unrealized: -10 },
      { ...defaultRule, maxLoss: 10 },
    )[0].code,
    'loss',
  );
  assert.deepEqual(
    positionRisks(
      { ...position, unrealized: 10 },
      { ...defaultRule, maxLoss: 10 },
    ),
    [],
  );
});
void test('liquidation is directional and missing liquidation is unknown', () => {
  assert.equal(liquidationDistance(position), 20);
  assert.equal(
    liquidationDistance({ ...position, side: 'short', liquidation: 120 }),
    20,
  );
  assert.equal(liquidationDistance({ ...position, liquidation: null }), null);
  assert.deepEqual(
    positionRisks({ ...position, liquidation: null }, defaultRule),
    [],
  );
  assert.equal(
    positionRisks({ ...position, liquidation: 99.5 }, defaultRule)[0].severity,
    'danger',
  );
  assert.equal(
    positionRisks({ ...position, liquidation: 98.5 }, defaultRule)[0].severity,
    'warning',
  );
  assert.equal(
    positionRisks({ ...position, mark: 79 }, defaultRule)[0].code,
    'liquidation-danger',
  );
});
void test('actual quantities and 1000-token units are preserved; missing mode/leverage stay unknown', () => {
  const [p] = normalizePositions(
    [riskRow],
    {},
    new Map([['1000TESTUSDT', '1000TEST']]),
  );
  assert.equal(p.quantity, 2);
  assert.equal(p.side, 'short');
  assert.equal(p.unit, '1000TEST');
  assert.equal(p.mode, 'unknown');
  assert.equal(p.leverage, null);
  assert.equal(p.liquidation, 130);
  const rows = normalizePositions(
    [
      {
        ...riskRow,
        positionSide: 'LONG',
        positionAmt: '2',
        liquidationPrice: '0',
      },
      { ...riskRow, positionSide: 'SHORT' },
    ],
    {
      positions: [
        { symbol: riskRow.symbol, positionSide: 'LONG', isolated: true },
      ],
    },
    new Map(),
  );
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].id, rows[1].id);
  assert.equal(rows[0].mode, 'isolated');
  assert.equal(rows[0].liquidation, null);
  assert.throws(() =>
    normalizePositions([{ ...riskRow, markPrice: '' }], {}, new Map()),
  );
});
void test('threshold validation rejects NaN, zero, and reversed warning/danger thresholds', () => {
  assert.deepEqual(validateRule(defaultRule), defaultRule);
  for (const rule of [
    { ...defaultRule, stop: 0 },
    { ...defaultRule, maxLoss: NaN },
    { ...defaultRule, liquidationDanger: 3 },
  ])
    assert.throws(() => validateRule(rule));
});
void test('freshness rejects old, absent and future timestamps', () => {
  assert.equal(accountDataFresh(100000, 130000), true);
  assert.equal(accountDataFresh(100000, 130001), false);
  assert.equal(accountDataFresh(0, 100), false);
  assert.equal(accountDataFresh(101, 100), false);
});
void test('only proven read-only keys and fixed read endpoints are accepted', () => {
  assert.equal(keyIsReadOnly(permissions), true);
  assert.equal(keyIsReadOnly({ enableReading: true }), false);
  for (const key of Object.keys(permissions).filter(
    (k) => k !== 'enableReading',
  ))
    assert.equal(keyIsReadOnly({ ...permissions, [key]: true }), false);
  assert.equal(
    keyIsReadOnly({ ...permissions, enableVanillaOptions: true }),
    false,
  );
  assert.deepEqual(signedReadPaths, [
    '/fapi/v3/account',
    '/fapi/v3/positionRisk',
    '/sapi/v1/account/apiRestrictions',
  ]);
});
void test('cross-site, mismatching origin, and non-local hosts are rejected', () => {
  assert.equal(accountOriginAllowed('127.0.0.1:3000', undefined, 'GET'), true);
  assert.equal(
    accountOriginAllowed('127.0.0.1:3000', undefined, 'POST'),
    false,
  );
  assert.equal(
    accountOriginAllowed('evil.example', 'http://evil.example', 'POST'),
    false,
  );
  assert.equal(
    accountOriginAllowed('127.0.0.1:3000', 'http://evil.example', 'POST'),
    false,
  );
  assert.equal(
    accountOriginAllowed(
      'localhost:3000',
      'http://localhost:3000',
      'POST',
      'cross-site',
    ),
    false,
  );
});

void test('local account integration with mock Binance only', async (t) => {
  const previous = getGlobalDispatcher(),
    mock = new MockAgent();
  mock.disableNetConnect();
  setGlobalDispatcher(mock);
  const root = await mkdtemp(join(tmpdir(), 'market-lens-test-'));
  const upstream = mock.get('https://fapi.binance.com');
  upstream
    .intercept({ path: '/fapi/v1/time', method: 'GET' })
    .reply(200, () => ({ serverTime: Date.now() }))
    .persist();
  upstream
    .intercept({ path: '/fapi/v1/exchangeInfo', method: 'GET' })
    .reply(200, {
      symbols: [
        {
          symbol: '1000TESTUSDT',
          baseAsset: '1000TEST',
          filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.01' }],
        },
      ],
    })
    .persist();
  upstream
    .intercept({ path: /^\/fapi\/v3\/account\?/, method: 'GET' })
    .reply(200, {
      assets: [
        { asset: 'USDT', walletBalance: '123', availableBalance: '100' },
      ],
      positions: [],
    })
    .persist();
  upstream
    .intercept({ path: /^\/fapi\/v3\/positionRisk\?/, method: 'GET' })
    .reply(200, [riskRow])
    .persist();
  upstream
    .intercept({ path: /^\/fapi\/v1\/klines\?/, method: 'GET' })
    .reply(200, (options) => {
      const interval = new URL(
        options.path,
        'https://fapi.binance.com',
      ).searchParams.get('interval');
      const step =
          interval === '4h' ? 14400000 : interval === '15m' ? 900000 : 3600000,
        now = Date.now();
      return Array.from({ length: 240 }, (_, i) => {
        const close = 100 + i * 0.04;
        return [
          now - (240 - i) * step,
          close,
          close + 0.5,
          close - 0.5,
          close,
          100,
          now - (239 - i) * step - 1,
        ];
      });
    })
    .persist();
  const account = mock.get('https://api.binance.com');
  account
    .intercept({
      path: /^\/sapi\/v1\/account\/apiRestrictions\?/,
      method: 'GET',
      headers: { 'x-mbx-apikey': credentials.key },
    })
    .reply(200, permissions)
    .persist();
  let handler:
    | ((
        req: import('node:http').IncomingMessage,
        res: import('node:http').ServerResponse,
      ) => void)
    | undefined;
  const server = createServer((req, res) => handler?.(req, res));
  const plugin = accountDev('', root);
  assert.equal(typeof plugin.configureServer, 'function');
  (plugin.configureServer as (server: ViteDevServer) => unknown)({
    httpServer: server,
    middlewares: {
      use: (_path: string, fn: typeof handler) => {
        handler = fn;
      },
    },
  } as unknown as ViteDevServer);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  async function call(
    path: string,
    data?: unknown,
    headers: Record<string, string> = {},
  ) {
    return await new Promise<{ status: number; data: Record<string, unknown> }>(
      (resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port: (address as { port: number }).port,
            path,
            method: data === undefined ? 'GET' : 'POST',
            headers: {
              Host: '127.0.0.1:3000',
              Origin: 'http://127.0.0.1:3000',
              'Content-Type': 'application/json',
              'X-Market-Lens': '1',
              ...headers,
            },
          },
          (res) => {
            let text = '';
            res.on('data', (chunk) => {
              text += chunk;
            });
            res.on('end', () =>
              resolve({ status: res.statusCode!, data: JSON.parse(text) }),
            );
          },
        );
        req.on('error', reject);
        req.end(data === undefined ? undefined : JSON.stringify(data));
      },
    );
  }
  try {
    await t.test('HTTP mutation boundaries and no trading routes', async () => {
      assert.equal(
        (
          await call('/connect', credentials, {
            Origin: 'https://evil.example',
          })
        ).status,
        403,
      );
      assert.equal(
        (await call('/connect', credentials, { 'X-Market-Lens': '' })).status,
        403,
      );
      assert.equal((await call('/order', {})).status, 404);
      assert.equal((await call('/snapshot')).data.connected, false);
    });
    await t.test(
      'connect normalizes real-shaped positions, persists only rules, and disconnect clears state',
      async () => {
        assert.equal((await call('/connect', credentials)).status, 200);
        const s = (await call('/snapshot')).data;
        assert.equal(s.connected, true);
        assert.equal(s.wallet, 123);
        let automatic = (
          s.positions as {
            auto?: {
              stop: number;
              target1: number;
              target2: number;
              reasons: string[];
            };
          }[]
        )[0].auto;
        for (let attempt = 0; attempt < 20 && !automatic; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          automatic = (
            (await call('/snapshot')).data.positions as {
              auto?: typeof automatic;
            }[]
          )[0].auto;
        }
        assert.ok(automatic);
        assert.ok(automatic.reasons.length > 0);
        assert.ok(automatic.target2 < automatic.target1);
        assert.ok(automatic.stop > 0);
        assert.ok(!JSON.stringify(s).includes(credentials.key));
        assert.ok(!JSON.stringify(s).includes(credentials.secret));
        assert.equal(
          (
            await call('/rules', {
              id: '1000TESTUSDT:short',
              rule: {
                ...defaultRule,
                stop: 94,
                liquidationWarning: 40,
                liquidationDanger: 39,
                entryReason: '回踩后入场',
                invalidation: '失守支撑人工复核',
                holdHours: 4,
                planStartedAt: Date.UTC(2026, 8, 1),
              },
            })
          ).status,
          200,
        );
        const alerted = (await call('/snapshot')).data;
        const events = alerted.events as { id: string; message: string }[];
        assert.ok(events.some((e) => e.message.includes('强平')));
        await call('/acknowledge', { id: events[0].id });
        assert.equal(
          (
            (await call('/snapshot')).data.events as { acknowledged: boolean }[]
          )[0].acknowledged,
          true,
        );
        assert.equal((await call('/disconnect', {})).status, 200);
        const disconnected = (await call('/snapshot')).data;
        assert.equal(disconnected.connected, false);
        assert.deepEqual(disconnected.positions, []);
        await call('/connect', credentials);
        const restored = (await call('/snapshot')).data.rules as Record<
          string,
          {
            entryReason: string;
            invalidation: string;
            holdHours: number;
            planStartedAt: number;
          }
        >;
        assert.equal(restored['1000TESTUSDT:short'].entryReason, '回踩后入场');
        assert.equal(
          restored['1000TESTUSDT:short'].invalidation,
          '失守支撑人工复核',
        );
        assert.equal(restored['1000TESTUSDT:short'].holdHours, 4);
        assert.equal(
          restored['1000TESTUSDT:short'].planStartedAt,
          Date.UTC(2026, 8, 1),
        );
        assert.equal(
          (
            (await call('/snapshot')).data.rules as Record<
              string,
              { stop: number }
            >
          )['1000TESTUSDT:short'].stop,
          94,
        );
        await call('/disconnect', {});
      },
    );
    await t.test('disconnect cancels an in-flight connection', async () => {
      const pendingKey = {
        ...credentials,
        key: 'CANCELTEST0123456789012345678901',
      };
      let reached: () => void = () => {};
      const reachedUpstream = new Promise<void>((resolve) => {
        reached = resolve;
      });
      account
        .intercept({
          path: /^\/sapi\/v1\/account\/apiRestrictions\?/,
          method: 'GET',
          headers: { 'x-mbx-apikey': pendingKey.key },
        })
        .reply(() => {
          reached();
          return { statusCode: 200, data: permissions };
        })
        .delay(100);
      const connection = call('/connect', pendingKey);
      await reachedUpstream;
      await call('/disconnect', {});
      assert.equal((await connection).status, 409);
      assert.equal((await call('/snapshot')).data.connected, false);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    setGlobalDispatcher(previous);
    await mock.close();
    assert.ok(root.startsWith(join(tmpdir(), 'market-lens-test-')));
    await rm(root, { recursive: true, force: true });
  }
});

void test('corrupt persisted rules block connection instead of silently resetting alerts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'market-lens-corrupt-'));
  await mkdir(join(root, '.local-data'));
  await writeFile(join(root, '.local-data', 'position-rules.json'), '{bad');
  let handler:
    | ((
        req: import('node:http').IncomingMessage,
        res: import('node:http').ServerResponse,
      ) => void)
    | undefined;
  const server = createServer((req, res) => handler?.(req, res));
  const plugin = accountDev('', root);
  (plugin.configureServer as (server: ViteDevServer) => unknown)({
    httpServer: server,
    middlewares: {
      use: (_path: string, fn: typeof handler) => {
        handler = fn;
      },
    },
  } as unknown as ViteDevServer);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const result = await new Promise<string>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: address.port,
          path: '/snapshot',
          headers: { Host: '127.0.0.1:3000' },
        },
        (res) => {
          let s = '';
          res.on('data', (c) => {
            s += c;
          });
          res.on('end', () => resolve(s));
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.match(JSON.parse(result).error, /规则文件无法读取/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
