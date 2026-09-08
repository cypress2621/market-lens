'use client';
import { useState } from 'react';
import {
  Bell,
  Volume2,
  RefreshCw,
  ShieldCheck,
  Link2,
  Settings2,
  TriangleAlert,
  Wallet,
  Check,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useAccount } from '@/components/account-context';
import PositionPlan from '@/components/automatic-position-plan';
import {
  defaultRule,
  liquidationDistance,
  positionRisks,
  type Position,
  type PositionRule,
} from '@/lib/position-risk';
const fmt = (n: number | null, d = 2) =>
  n === null
    ? '—'
    : n.toLocaleString('en-US', {
        maximumFractionDigits: d,
        minimumFractionDigits: d,
      });
function RulesForm({
  position,
  initial,
  onDone,
}: {
  position: Position;
  initial: PositionRule;
  onDone: () => void;
}) {
  const { action } = useAccount(),
    [rule, setRule] = useState({ ...defaultRule, ...initial }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const fields: [
    'maxLoss' | 'liquidationWarning' | 'liquidationDanger',
    string,
  ][] = [
    ['maxLoss', '额外亏损上限（USDT，可不填）'],
    ['liquidationWarning', '距币安强平价注意阈值（%）'],
    ['liquidationDanger', '距币安强平价紧急阈值（%）'],
  ];
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        void action('rules', { id: position.id, rule })
          .then(onDone)
          .catch((e) => setError(e.message))
          .finally(() => setBusy(false));
      }}
    >
      <p className="subtext">
        系统会自动生成持仓依据、止损、两档止盈和复核时间。这里仅设置你自己的额外风险上限。
      </p>
      <div className="position-form-grid">
        {fields.map(([key, label]) => (
          <label className="position-field" key={key}>
            {label}
            <input
              type="number"
              step="any"
              min="0"
              required={key !== 'maxLoss'}
              value={rule[key] ?? ''}
              onChange={(e) =>
                setRule((v) => ({
                  ...v,
                  [key]: e.target.value === '' ? null : Number(e.target.value),
                }))
              }
            />
          </label>
        ))}
      </div>
      {error && (
        <p className="negative" role="alert">
          {error}
        </p>
      )}
      <button className="primary" type="submit" disabled={busy}>
        {busy ? '保存中' : '保存额外提醒'}
      </button>
    </form>
  );
}
export default function PositionsDashboard() {
  const {
    state,
    loading,
    stale,
    now,
    refresh,
    action,
    enableSound,
    sound,
    desktop,
    enableDesktop,
  } = useAccount();
  const [apiKey, setApiKey] = useState(''),
    [secret, setSecret] = useState(''),
    [connecting, setConnecting] = useState(false),
    [error, setError] = useState(''),
    [editing, setEditing] = useState<Position | null>(null);
  function editPlan(p: Position) {
    setEditing(p);
  }
  const pnl = state.positions.reduce((sum, p) => sum + p.unrealized, 0),
    risks = stale
      ? []
      : state.positions.flatMap((p) =>
          positionRisks(p, state.rules[p.id] || defaultRule, now),
        );
  async function connect() {
    setConnecting(true);
    setError('');
    const submitted = { key: apiKey, secret };
    setApiKey('');
    setSecret('');
    try {
      await action('connect', submitted);
    } catch (e) {
      setError(e instanceof Error ? e.message : '连接未完成');
    } finally {
      setConnecting(false);
    }
  }
  return (
    <main className="workspace positions-page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">持仓与风险 / MY POSITIONS</p>
          <h1>
            先看自己的风险<span>.</span>
          </h1>
          <p className="subtext">
            同步币安真实 USDT 合约仓位 · 以标记价检查退出条件
          </p>
        </div>
        <button className="secondary" onClick={() => void refresh()}>
          <RefreshCw size={15} />
          刷新
        </button>
      </section>
      {state.error && (
        <div className="notice" role="alert">
          <TriangleAlert size={18} />
          {state.error}
        </div>
      )}
      {!state.connected ? (
        <section className="panel connect-panel">
          <div>
            <span className="connect-icon">
              <ShieldCheck size={30} />
            </span>
            <h2>连接你自己的币安账户</h2>
            <p>
              直接同步实际数量、开仓均价、未实现盈亏和币安返回的强平价，无需用保证金与杠杆反推。
            </p>
            <ol>
              <li>在币安 API 管理中创建独立的系统生成 HMAC Key。</li>
              <li>
                只开启读取；不要开启交易、划转或提现权限。按币安要求设置 IP
                白名单。
              </li>
              <li>在右侧本机表单粘贴 Key 与 Secret，点击连接验证。</li>
            </ol>
            <p className="subtext">
              当前接入支持标准 USDT 合约账户。若币安不允许该账户用仅读取 Key
              访问合约，不要提高到交易权限；保留手动录入作为后续替代。
            </p>
            <p className="subtext">
              密钥仅保留在本次本地服务内存中，不写入文件、不返回页面。关闭服务后需重新连接。请勿将密钥发到聊天里。
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
          >
            <label className="position-field">
              API Key
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                required
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="仅在本机填写"
              />
            </label>
            <label className="position-field">
              API Secret
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                required
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="不会保存到磁盘"
              />
            </label>
            <button
              className="primary"
              disabled={connecting || loading}
              type="submit"
            >
              <Link2 size={16} />
              {connecting ? '正在验证读取权限…' : '验证并连接账户'}
            </button>
            {error && (
              <p className="negative connection-error" role="alert">
                {error}
              </p>
            )}
            <p className="subtext">
              本网站只实现读取接口，没有开仓、平仓、划转或提现接口。
            </p>
          </form>
        </section>
      ) : (
        <>
          <section className="summary-grid position-summary">
            <div className="summary-card">
              <span>
                当前持仓 <Wallet size={17} />
              </span>
              <strong>
                {state.positions.length}
                <small> 笔</small>
              </strong>
            </div>
            <div className="summary-card">
              <span>USDT 钱包余额</span>
              <strong>{fmt(state.wallet)}</strong>
            </div>
            <div className="summary-card">
              <span>未实现盈亏 · USDT</span>
              <strong className={pnl >= 0 ? 'positive' : 'negative'}>
                {stale ? '数据待更新' : fmt(pnl)}
              </strong>
              <p>未计手续费与资金费用</p>
            </div>
            <div className="summary-card">
              <span>待关注风险条件</span>
              <strong>
                {stale ? '未知' : risks.length}
                <small> 项</small>
              </strong>
              <p>
                {state.asOf
                  ? new Date(state.asOf).toLocaleTimeString('zh-CN')
                  : '—'}{' '}
                同步 · 每 10 秒检查
              </p>
            </div>
          </section>
          <div className="panel notification-bar">
            <div>
              <h3>开启提醒</h3>
              <p>
                保持网页和本地服务运行。后台标签页、系统休眠或通知权限可能影响送达。
              </p>
            </div>
            <button
              className="secondary"
              onClick={() =>
                void enableSound().catch(() =>
                  setError('声音未能启用，请检查浏览器设置'),
                )
              }
            >
              <Volume2 size={16} />
              {sound ? '声音已启用 / 测试' : '启用声音'}
            </button>
            <button
              className="secondary"
              onClick={() =>
                void enableDesktop().catch(() => setError('桌面通知未能启用'))
              }
            >
              <Bell size={16} />
              {desktop === '已启用' ? '桌面通知已启用' : '启用桌面通知'}
            </button>
            <span>{desktop}</span>
          </div>
          {error && (
            <p className="negative" role="alert">
              {error}
            </p>
          )}
          <section className="positions-grid">
            {state.positions.map((p) => {
              const rule = { ...defaultRule, ...state.rules[p.id] },
                alerts = positionRisks(p, rule, now, !stale),
                distance = liquidationDistance(p);
              return (
                <article className="panel position-card" key={p.id}>
                  <div className="section-heading">
                    <h2>
                      {p.symbol.replace(/USDT$/, '')}{' '}
                      <span
                        className={`tag ${p.side === 'long' ? 'green' : 'rose'}`}
                      >
                        {p.side === 'long' ? '多仓' : '空仓'}
                      </span>
                    </h2>
                    <button
                      className="icon-button"
                      aria-label={`设置 ${p.symbol} 预警`}
                      onClick={() => editPlan(p)}
                    >
                      <Settings2 size={17} />
                    </button>
                  </div>
                  <p className="position-meta">
                    {p.mode === 'isolated'
                      ? '逐仓'
                      : p.mode === 'cross'
                        ? '全仓'
                        : '保证金模式未返回'}
                    {p.leverage ? ` · ${p.leverage}×` : ''} · 实际数量{' '}
                    {fmt(p.quantity, 8)} {p.unit}
                  </p>
                  <div className="position-pnl">
                    <span>未实现盈亏</span>
                    <strong
                      className={p.unrealized >= 0 ? 'positive' : 'negative'}
                    >
                      {stale ? '待更新' : fmt(p.unrealized)} <small>USDT</small>
                    </strong>
                  </div>
                  <dl className="position-metrics">
                    <div>
                      <dt>开仓均价</dt>
                      <dd>{fmt(p.entry, 6)}</dd>
                    </div>
                    <div>
                      <dt>当前标记价</dt>
                      <dd>{fmt(p.mark, 6)}</dd>
                    </div>
                    <div>
                      <dt>币安强平价</dt>
                      <dd>{fmt(p.liquidation, 6)}</dd>
                    </div>
                    <div>
                      <dt>距强平价格</dt>
                      <dd>
                        {distance === null ? '未知' : `${distance.toFixed(2)}%`}
                      </dd>
                    </div>
                  </dl>
                  <PositionPlan position={p} stale={stale} now={now} />
                  <div className="position-assessment">
                    {stale ? (
                      <p className="negative">数据过期，当前风险未知</p>
                    ) : alerts.length ? (
                      alerts.map((r) => (
                        <p
                          key={r.code}
                          className={
                            r.severity === 'danger' ? 'negative' : 'amber-text'
                          }
                        >
                          {r.message}
                        </p>
                      ))
                    ) : (
                      <p>
                        {p.trend === 'unknown'
                          ? '价格条件未触发，技术数据暂缺'
                          : '当前未触发系统价格线或额外风险阈值'}
                      </p>
                    )}
                    <small>
                      趋势：
                      {p.trend === 'supports'
                        ? '与持仓方向一致'
                        : p.trend === 'opposes'
                          ? '与持仓方向相反'
                          : p.trend === 'mixed'
                            ? '方向不一致'
                            : '暂不可用'}
                      。未触发预警不代表安全。
                    </small>
                  </div>
                  <button className="secondary" onClick={() => editPlan(p)}>
                    额外风险提醒（可选）
                  </button>
                </article>
              );
            })}
          </section>
          {!state.positions.length && (
            <div className="panel positions-empty">
              <Check size={30} />
              <h2>已连接，当前没有非零 USDT 合约仓位</h2>
              <p>开仓或减仓由你在币安完成，网站会在后续同步中更新。</p>
            </div>
          )}
          <section className="panel alert-history">
            <div className="section-heading">
              <h2>
                <Bell size={18} />
                预警记录
              </h2>
              <span className="subtext">本次服务会话 · 最多 100 条</span>
            </div>
            {!state.events.length ? (
              <p className="subtext">
                尚无预警。强平距离默认 2% 注意、1% 紧急，可在每笔持仓中调整。
              </p>
            ) : (
              state.events.slice(0, 20).map((e) => (
                <div className={`alert-row ${e.severity}`} key={e.id}>
                  <div>
                    <b>{e.symbol}</b>
                    <p>{e.message}</p>
                    <small>{new Date(e.time).toLocaleString('zh-CN')}</small>
                  </div>
                  <button
                    className="text-button"
                    disabled={e.acknowledged}
                    onClick={() =>
                      void action('acknowledge', { id: e.id }).catch((e) =>
                        setError(e.message),
                      )
                    }
                  >
                    {e.acknowledged ? '已知晓' : '我已知晓'}
                  </button>
                </div>
              ))
            )}
          </section>
          <div className="connection-footer">
            <span>
              账户只读连接；网页提醒不替代币安止损委托。全仓强平价还会受账户余额和其他仓位影响。
            </span>
            <button
              className="text-button"
              onClick={() =>
                void action('disconnect', {}).catch((e) => setError(e.message))
              }
            >
              断开账户并清除内存密钥
            </button>
          </div>
        </>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="position-dialog">
          <DialogHeader>
            <DialogTitle>{editing?.symbol} · 额外风险提醒</DialogTitle>
            <DialogDescription>
              仅设置本机提醒，不会向币安发送交易委托。
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <RulesForm
              key={editing.id}
              position={editing}
              initial={{
                ...defaultRule,
                ...state.rules[editing.id],
              }}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
