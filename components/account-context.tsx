'use client';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity } from 'lucide-react';
import {
  accountDataFresh,
  type Position,
  type PositionRule,
} from '@/lib/position-risk';
export type AccountEvent = {
  id: string;
  positionId: string;
  symbol: string;
  severity: 'danger' | 'warning' | 'info';
  message: string;
  time: number;
  acknowledged: boolean;
};
export type AccountState = {
  connected: boolean;
  asOf: number;
  error: string;
  positions: Position[];
  rules: Record<string, PositionRule>;
  events: AccountEvent[];
  wallet: number | null;
  available: number | null;
};
const empty: AccountState = {
  connected: false,
  asOf: 0,
  error: '',
  positions: [],
  rules: {},
  events: [],
  wallet: null,
  available: null,
};
type Context = {
  state: AccountState;
  loading: boolean;
  stale: boolean;
  now: number;
  refresh: () => Promise<void>;
  action: (path: string, data: unknown) => Promise<void>;
  enableSound: () => Promise<void>;
  sound: boolean;
  desktop: string;
  enableDesktop: () => Promise<void>;
};
const AccountContext = createContext<Context | null>(null);
export function useAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error('Account context unavailable');
  return value;
}
export default function AccountShell({ children }: { children: ReactNode }) {
  const [state, setState] = useState(empty),
    [loading, setLoading] = useState(true),
    [sound, setSound] = useState(false),
    [desktop, setDesktop] = useState('未启用'),
    [now, setNow] = useState(0);
  const audio = useRef<AudioContext | null>(null),
    seen = useRef(new Set<string>()),
    busy = useRef(false),
    pathname = usePathname();
  const play = useCallback(() => {
    const context = audio.current;
    if (!context || context.state !== 'running') return;
    const tone = context.createOscillator(),
      gain = context.createGain();
    tone.frequency.value = 660;
    gain.gain.setValueAtTime(0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.5);
    tone.connect(gain);
    gain.connect(context.destination);
    tone.start();
    tone.stop(context.currentTime + 0.5);
  }, []);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const response = await fetch('/__account/snapshot', {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('本地账户服务暂不可用');
      const data = (await response.json()) as AccountState;
      setState(data);
      setNow(Date.now());
      for (const event of [...data.events].reverse()) {
        if (seen.current.has(event.id)) continue;
        seen.current.add(event.id);
        if (event.acknowledged || Date.now() - event.time > 300000) continue;
        if (event.severity !== 'info') play();
        if (
          typeof Notification !== 'undefined' &&
          Notification.permission === 'granted' &&
          localStorage.getItem('market-lens-desktop-alerts') === '1'
        ) {
          try {
            new Notification(
              `${event.severity === 'danger' ? '紧急提醒' : '持仓提醒'} · ${event.symbol}`,
              { body: event.message, tag: event.id },
            );
          } catch {
            setDesktop('当前浏览器未能发送通知');
          }
        }
      }
      seen.current = new Set(data.events.map((event) => event.id));
    } catch {
      setState((old) => ({
        ...old,
        error: '本地账户同步失败，请检查服务和网络。当前风险状态未知。',
      }));
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [play]);
  useEffect(() => {
    const initial = window.setTimeout(() => {
      void refresh();
      if (typeof Notification === 'undefined') setDesktop('当前浏览器不支持');
      else if (
        Notification.permission === 'granted' &&
        localStorage.getItem('market-lens-desktop-alerts') === '1'
      )
        setDesktop('已启用');
    }, 0);
    const timer = window.setInterval(() => {
      void refresh();
    }, 10000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.clearInterval(clock);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);
  const action = useCallback(
    async (path: string, data: unknown) => {
      const response = await fetch('/__account/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Market-Lens': '1' },
        body: JSON.stringify(data),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || '操作失败');
      await refresh();
    },
    [refresh],
  );
  async function enableSound() {
    audio.current ??= new AudioContext();
    await audio.current.resume();
    setSound(audio.current.state === 'running');
    play();
  }
  async function enableDesktop() {
    if (typeof Notification === 'undefined') {
      setDesktop('请用系统浏览器开启桌面通知');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      localStorage.setItem('market-lens-desktop-alerts', '1');
      setDesktop('已启用');
      try {
        new Notification('币析提醒测试', {
          body: '持仓风险提醒已启用。请保持网页与本地服务运行。',
        });
      } catch {
        setDesktop('通知发送失败，请用系统浏览器');
      }
    } else setDesktop('未获授权，可在浏览器设置中开启');
  }
  const stale =
      !!state.error || (state.connected && !accountDataFresh(state.asOf, now)),
    unread = state.events.filter(
      (e) => !e.acknowledged && e.severity === 'danger',
    ).length;
  return (
    <AccountContext.Provider
      value={{
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
      }}
    >
      <div className="workspace">
        <header className="topbar app-topbar">
          <Link className="brand" href="/">
            <span className="brandmark">
              <Activity size={22} />
            </span>
            币析
          </Link>
          <nav aria-label="主要功能">
            {[
              ['/', '我的持仓'],
              ['/opportunities', '合约机会'],
              ['/research', '市场研究'],
            ].map(([href, title]) => (
              <Link
                key={href}
                href={href}
                aria-current={pathname === href ? 'page' : undefined}
              >
                {title}
              </Link>
            ))}
          </nav>
          <span className={`monitor-badge ${stale ? 'negative' : ''}`}>
            {stale
              ? '监控中断'
              : state.connected
                ? `账户已连接${unread ? ` · ${unread} 条紧急提醒` : ''}`
                : '账户未连接'}
          </span>
        </header>
      </div>
      {children}
    </AccountContext.Provider>
  );
}
