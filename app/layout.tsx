import type { Metadata } from 'next';
import './globals.css';
import AccountShell from '@/components/account-context';
export const metadata: Metadata = {
  title: '币析 Market Lens · Binance 行情分析',
  description: 'Binance USDT 永续合约入场候选、现货市场扫描与涨跌概率参考。',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <AccountShell>{children}</AccountShell>
      </body>
    </html>
  );
}
