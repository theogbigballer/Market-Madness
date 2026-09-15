"use client";

import { useEffect, useState } from "react";

const positions = [
  { symbol: "NVDA", name: "NVIDIA Corp.", type: "Equity", qty: "1,250", mark: "$184.92", value: "$231,150", pnl: "+$8,437", pct: "+3.79%", tone: "positive" },
  { symbol: "BTC-USD", name: "Bitcoin", type: "Crypto", qty: "2.40", mark: "$116,842", value: "$280,421", pnl: "+$4,926", pct: "+1.79%", tone: "positive" },
  { symbol: "ESZ6", name: "E-mini S&P 500 Dec 26", type: "Future", qty: "-2", mark: "6,742.25", value: "-$674,225", pnl: "-$2,175", pct: "-0.32%", tone: "negative" },
  { symbol: "SPY 700C", name: "17 Dec 2026 · Call", type: "Option", qty: "10", mark: "$14.28", value: "$14,280", pnl: "+$1,840", pct: "+14.79%", tone: "positive" },
];

const sparkBars = [28, 31, 29, 37, 34, 40, 43, 39, 46, 49, 47, 55, 52, 61, 59, 67, 65, 73, 70, 76, 79, 84, 81, 88, 92, 89, 96];

export default function Home() {
  const [dark, setDark] = useState(true);
  const [active, setActive] = useState("Overview");
  const [tradeOpen, setTradeOpen] = useState(false);
  const [assetClass, setAssetClass] = useState("Equity");

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">MM</span><span>Market Madness</span></div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {["Overview", "Trade", "Positions", "Markets", "Orders", "P&L", "Risk", "Allocation", "Activity"].map((item) => (
            <button key={item} aria-current={active === item ? "page" : undefined} className={active === item ? "nav-item active" : "nav-item"} onClick={() => setActive(item)}><span className="nav-dot" />{item}</button>
          ))}
          <p className="nav-label secondary-label">System</p>
          <button className="nav-item"><span className="nav-dot" />Data providers</button>
          <button className="nav-item"><span className="nav-dot" />Settings</button>
        </nav>
        <div className="feed-card"><div><span className="status-dot" /> Market data</div><strong>Connected</strong><span>Updated 8 sec ago</span></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="portfolio-switcher"><span className="eyebrow">Portfolio</span><button>Core Opportunities <span>⌄</span></button></div>
          <div className="topbar-actions">
            <div className="market-clock"><span className="status-dot" /><span><strong>US markets open</strong><small>Closes in 3h 42m</small></span></div>
            <button className="theme-toggle" onClick={() => setDark((value) => !value)} aria-label="Toggle color theme">{dark ? "☼" : "◐"}</button>
            <button className="trade-button" onClick={() => setTradeOpen(true)}>Place trade</button>
          </div>
        </header>

        <div className="content">
          <div className="page-heading">
            <div><p className="eyebrow">Monday, September 14</p><h1>{active === "Overview" ? "Portfolio overview" : active}</h1></div>
            <div className="benchmark">Benchmark <strong>SPY</strong><span className="positive">+0.42%</span></div>
          </div>

          <section className="metrics-grid" aria-label="Portfolio summary">
            <article className="metric primary-metric"><span>Net liquidation value</span><strong>$512,846.20</strong><small className="positive">+$7,942.18 today · +1.57%</small></article>
            <article className="metric"><span>Available buying power</span><strong>$294,108.74</strong><small>57.35% of equity</small></article>
            <article className="metric"><span>Cash balance</span><strong>$126,302.41</strong><small>24.63% allocation</small></article>
            <article className="metric"><span>Margin utilization</span><strong>38.6%</strong><div className="meter"><i /></div><small>$74,392 excess liquidity</small></article>
          </section>

          <section className="dashboard-grid">
            <article className="panel performance-panel">
              <div className="panel-head"><div><span className="panel-title">Portfolio performance</span><p>Net value versus SPY benchmark</p></div><div className="range"><button>1D</button><button>1W</button><button className="selected">1M</button><button>YTD</button><button>1Y</button></div></div>
              <div className="chart-values"><div><span>Portfolio</span><strong className="positive">+6.84%</strong></div><div><span>SPY</span><strong>+3.21%</strong></div></div>
              <div className="chart" aria-label="Portfolio equity chart"><div className="gridline g1"/><div className="gridline g2"/><div className="gridline g3"/><div className="spark-bars">{sparkBars.map((height, index) => <i key={index} style={{height: `${height}%`}} />)}</div><div className="chart-axis"><span>Aug 14</span><span>Aug 24</span><span>Sep 03</span><span>Sep 14</span></div></div>
            </article>

            <article className="panel exposure-panel">
              <div className="panel-head"><div><span className="panel-title">Net exposure</span><p>By asset class</p></div><button className="icon-button">•••</button></div>
              <div className="exposure-total"><strong>$486,972</strong><span>94.95% invested</span></div>
              <div className="allocation-bar"><i className="equity"/><i className="crypto"/><i className="futures"/><i className="options"/><i className="cash"/></div>
              <div className="legend">
                <div><span><i className="swatch equity"/>Equity</span><strong>44.1%</strong></div><div><span><i className="swatch crypto"/>Crypto</span><strong>24.7%</strong></div><div><span><i className="swatch futures"/>Futures</span><strong>13.8%</strong></div><div><span><i className="swatch options"/>Options</span><strong>12.4%</strong></div><div><span><i className="swatch cash"/>Cash</span><strong>5.0%</strong></div>
              </div>
            </article>
          </section>

          <section className="panel positions-panel">
            <div className="panel-head"><div><span className="panel-title">Open positions</span><p>Live marks refresh every 30 seconds</p></div><button className="text-button">View all positions →</button></div>
            <div className="table-wrap"><table><thead><tr><th>Instrument</th><th>Type</th><th className="number">Quantity</th><th className="number">Mark</th><th className="number">Market value</th><th className="number">Today&apos;s P&amp;L</th></tr></thead><tbody>{positions.map((position) => <tr key={position.symbol}><td><strong>{position.symbol}</strong><small>{position.name}</small></td><td><span className="type-pill">{position.type}</span></td><td className="number">{position.qty}</td><td className="number">{position.mark}</td><td className="number">{position.value}</td><td className={`number ${position.tone}`}><strong>{position.pnl}</strong><small>{position.pct}</small></td></tr>)}</tbody></table></div>
          </section>
        </div>
      </section>
      {tradeOpen && <div className="drawer-backdrop">
        <button className="drawer-dismiss" onClick={() => setTradeOpen(false)} aria-label="Close trade ticket overlay" />
        <aside className="trade-drawer" aria-label="Trade ticket">
          <div className="drawer-head"><div><p className="eyebrow">Core Opportunities</p><h2>New order</h2></div><button onClick={() => setTradeOpen(false)} aria-label="Close trade ticket">×</button></div>
          <div className="asset-tabs">{["Equity", "Crypto", "Futures", "Options", "Forward"].map((item) => <button key={item} className={assetClass === item ? "selected" : ""} onClick={() => setAssetClass(item)}>{item}</button>)}</div>
          <label>Instrument<input defaultValue={assetClass === "Equity" ? "NVDA" : ""} placeholder={`Search ${assetClass.toLowerCase()} instruments`} /></label>
          <div className="quote-strip"><span>Bid<strong>$184.90</strong></span><span>Ask<strong>$184.94</strong></span><span>Mark<strong>$184.92</strong></span><span>Quality<strong className="positive">Live</strong></span></div>
          <div className="field-row"><label>Side<select defaultValue="buy"><option value="buy">Buy</option><option value="sell">Sell</option></select></label><label>Order type<select defaultValue="market"><option value="market">Market</option><option value="limit">Limit</option><option value="stop">Stop</option><option value="stop_limit">Stop limit</option></select></label></div>
          <div className="field-row"><label>Quantity<input type="number" min="0" defaultValue="100" /></label><label>Time in force<select defaultValue="day"><option value="day">Day</option><option value="gtc">Good til canceled</option></select></label></div>
          <div className="estimate-card"><div><span>Estimated fill</span><strong>$184.96</strong></div><div><span>Estimated slippage</span><strong>$4.00</strong></div><div><span>Buying power after</span><strong>$275,612.74</strong></div><p><span className="status-dot" /> Eligible for immediate execution during the regular session.</p></div>
          <button className="review-button">Review order</button>
          <p className="ticket-note">Scaffold preview · Orders are not submitted until the execution engine is connected.</p>
        </aside>
      </div>}
    </main>
  );
}
