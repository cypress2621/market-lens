import FuturesPanel from '@/components/futures-panel';
export default function Opportunities() {
  return (
    <main className="workspace">
      <section className="page-heading">
        <div>
          <p className="eyebrow">寻找机会 / OPPORTUNITIES</p>
          <h1>
            合约机会<span>.</span>
          </h1>
          <p className="subtext">先明确触发与失效条件，再考虑新开仓。</p>
        </div>
      </section>
      <FuturesPanel />
    </main>
  );
}
