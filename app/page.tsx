"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Portfolio = { id: string; name: string; startingCapital: number; advancedDerivativesEnabled: boolean; theme: string };
type Quote = { bid?: string; ask?: string; last?: string; mark: string; provider: string; quality: string; observedAt: string; name?: string };
type Position = { symbol: string; name: string; assetClass: string; quantity: number; mark: number; averageCost: number; marketValue: number; unrealizedPnl: number; quote: Quote };
type Order = { id: string; symbol: string; side: string; order_type: string; status: string; quantity: string; filled_quantity: string; scheduled_for: string | null; created_at: string };
type FutureContract = { root: string; symbol: string; name: string; expiration: string; firstNotice?: string; multiplier: number; initialMargin: number; maintenanceMargin: number; settlementType: "cash" | "physical"; quote: Quote };
type Dashboard = {
  portfolio: Portfolio;
  account: { cash: number; marketValue: number; netLiquidationValue: number; totalPnl: number; totalReturn: number; buyingPower: number; reservedBuyingPower: number; grossExposure: number; maintenanceMargin: number; marginUtilization: number };
  positions: Position[]; orders: Order[];
  benchmarks: { symbol: string; quote: Quote }[];
  pnlHistory: { date: string; netLiquidationValue: number; realizedPnl: number; unrealizedPnl: number }[];
  risk: { leverage: number; estimatedDailyVar: number; largestPosition: { symbol: string; value: number; concentration: number } | null };
  alerts: { id: string; severity: string; event_type: string; title: string; message: string; created_at: string }[];
  session: { isOpen: boolean; closesAt: string; nextOpenAt: string };
  quoteStatus: { provider: string; quality: string; refreshedAt: string };
};

const navigation = ["Overview", "Trade", "Positions", "Markets", "Orders", "P&L", "Risk", "Allocation", "Activity"];
const marketSymbols = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA"];
const sparkBars = [28,31,29,37,34,40,43,39,46,49,47,55,52,61,59,67,65,73,70,76,79,84,81,88,92,89,96];
const assetMap: Record<string, "equity" | "crypto" | "option" | "future" | "forward"> = { Equity: "equity", Crypto: "crypto", Options: "option", Futures: "future", Forward: "forward" };

function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value); }
function number(value: number, digits = 2) { return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value); }
function signedMoney(value: number) { return `${value >= 0 ? "+" : "-"}${money(Math.abs(value))}`; }
function pct(value: number) { return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`; }

export default function Home() {
  const [dark, setDark] = useState(true);
  const [active, setActive] = useState("Overview");
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [portfolioId, setPortfolioId] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadPortfolios = useCallback(async () => {
    const response = await fetch("/api/portfolios");
    const payload = await response.json() as { portfolios?: Portfolio[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "Unable to load portfolios.");
    setPortfolios(payload.portfolios || []);
    if (!portfolioId && payload.portfolios?.length) setPortfolioId(payload.portfolios[0].id);
    if (!payload.portfolios?.length) setCreateOpen(true);
  }, [portfolioId]);

  const refreshDashboard = useCallback(async () => {
    if (!portfolioId) return;
    const response = await fetch(`/api/dashboard?portfolioId=${encodeURIComponent(portfolioId)}`);
    const payload = await response.json() as Dashboard & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Unable to load portfolio.");
    setDashboard(payload);
  }, [portfolioId]);

  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [dark]);
  useEffect(() => { const timer = window.setTimeout(() => loadPortfolios().catch((reason) => setError(reason.message)).finally(() => setLoading(false)), 0); return () => window.clearTimeout(timer); }, [loadPortfolios]);
  useEffect(() => {
    const initial = window.setTimeout(() => refreshDashboard().catch((reason) => setError(reason.message)), 0);
    const interval = window.setInterval(() => refreshDashboard().catch(() => undefined), 30_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [refreshDashboard]);

  const allocation = useMemo(() => {
    if (!dashboard?.positions.length) return [];
    const total = dashboard.positions.reduce((sum, position) => sum + Math.abs(position.marketValue), 0);
    const totals = new Map<string, number>();
    dashboard.positions.forEach((position) => totals.set(position.assetClass, (totals.get(position.assetClass) || 0) + Math.abs(position.marketValue)));
    return [...totals].map(([label, value]) => ({ label, value: total ? value / total : 0 }));
  }, [dashboard]);

  async function portfolioCreated(id: string) {
    setCreateOpen(false); setPortfolioId(id); setNotice("Portfolio created. Your opening cash entry is now in the ledger.");
    await loadPortfolios();
  }

  const selectedPortfolio = portfolios.find((portfolio) => portfolio.id === portfolioId);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">MM</span><span>Market Madness</span></div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navigation.map((item) => <button key={item} aria-current={active === item ? "page" : undefined} className={active === item ? "nav-item active" : "nav-item"} onClick={() => { setActive(item); if (item === "Trade") setTradeOpen(true); }}><span className="nav-dot" />{item}</button>)}
          <p className="nav-label secondary-label">System</p>
          <button className="nav-item"><span className="nav-dot" />Data providers</button><button className="nav-item"><span className="nav-dot" />Settings</button>
        </nav>
        <div className="feed-card"><div><span className="status-dot simulated" /> Market data</div><strong>{dashboard?.quoteStatus.quality || "Starting"}</strong><span>{dashboard ? `Updated ${new Date(dashboard.quoteStatus.refreshedAt).toLocaleTimeString()}` : "Waiting for portfolio"}</span></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="portfolio-switcher"><span className="eyebrow">Portfolio</span><div><select aria-label="Selected portfolio" value={portfolioId} onChange={(event) => setPortfolioId(event.target.value)}>{portfolios.map((portfolio) => <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>)}</select><button className="add-portfolio" onClick={() => setCreateOpen(true)} aria-label="Create portfolio">＋</button></div></div>
          <div className="topbar-actions">
            <div className="market-clock"><span className={`status-dot ${dashboard?.session.isOpen ? "" : "closed"}`} /><span><strong>{dashboard?.session.isOpen ? "US markets open" : "US markets closed"}</strong><small>{dashboard?.session.isOpen ? `Closes ${new Date(dashboard.session.closesAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : dashboard ? `Next open ${new Date(dashboard.session.nextOpenAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "Checking calendar"}</small></span></div>
            <button className="theme-toggle" onClick={() => setDark((value) => !value)} aria-label="Toggle color theme">{dark ? "☼" : "◐"}</button>
            <button className="trade-button" disabled={!portfolioId} onClick={() => setTradeOpen(true)}>Place trade</button>
          </div>
        </header>

        <div className="content">
          {notice && <div className="notice-banner"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></div>}
          {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
          <div className="page-heading"><div><p className="eyebrow">{new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" })}</p><h1>{active === "Overview" ? "Portfolio overview" : active}</h1></div></div>

          {loading && <section className="empty-panel">Opening your local portfolio ledger…</section>}
          {!loading && !portfolioId && <section className="empty-panel"><strong>Create your first portfolio</strong><p>Choose your starting capital to begin trading current markets.</p><button className="trade-button" onClick={() => setCreateOpen(true)}>Create portfolio</button></section>}
          {dashboard && active === "Overview" && <Overview dashboard={dashboard} allocation={allocation} onRefresh={refreshDashboard} onNotice={setNotice} onError={setError} />}
          {dashboard && active === "Positions" && <PositionsTable positions={dashboard.positions} expanded />}
          {dashboard && active === "Orders" && <OrdersTable orders={dashboard.orders} portfolioId={dashboard.portfolio.id} onRefresh={refreshDashboard} onNotice={setNotice} onError={setError} />}
          {dashboard && active === "Markets" && <MarketsPanel />}
          {dashboard && active === "P&L" && <PnlPanel dashboard={dashboard} />}
          {dashboard && active === "Risk" && <RiskPanel dashboard={dashboard} />}
          {dashboard && active === "Activity" && <ActivityPanel dashboard={dashboard} />}
          {dashboard && !["Overview", "Positions", "Orders", "Markets", "Trade", "P&L", "Risk", "Activity"].includes(active) && <ModulePanel title={active} />}
        </div>
      </section>

      {createOpen && <PortfolioDialog dark={dark} onClose={portfolios.length ? () => setCreateOpen(false) : undefined} onCreated={portfolioCreated} onError={setError} />}
      {tradeOpen && dashboard && <TradeDrawer portfolio={selectedPortfolio || dashboard.portfolio} dashboard={dashboard} onClose={() => setTradeOpen(false)} onComplete={async (message) => { setNotice(message); setTradeOpen(false); setActive("Overview"); await refreshDashboard(); }} onError={setError} />}
    </main>
  );
}

function Overview({ dashboard, allocation, onRefresh, onNotice, onError }: { dashboard: Dashboard; allocation: { label: string; value: number }[]; onRefresh: () => Promise<void>; onNotice: (message: string) => void; onError: (message: string) => void }) {
  const { account } = dashboard;
  return <>
    <section className="metrics-grid" aria-label="Portfolio summary">
      <article className="metric primary-metric"><span>Net liquidation value</span><strong>{money(account.netLiquidationValue)}</strong><small className={account.totalPnl >= 0 ? "positive" : "negative"}>{signedMoney(account.totalPnl)} since inception · {pct(account.totalReturn)}</small></article>
      <article className="metric"><span>Available buying power</span><strong>{money(account.buyingPower)}</strong><small>{account.reservedBuyingPower ? `${money(account.reservedBuyingPower)} reserved by active orders` : "Orders require sufficient buying power"}</small></article>
      <article className="metric"><span>Cash balance</span><strong>{money(account.cash)}</strong><small>{account.netLiquidationValue ? `${number(account.cash / account.netLiquidationValue * 100)}% of equity` : "Opening balance"}</small></article>
      <article className="metric"><span>Margin utilization</span><strong>{number(account.marginUtilization * 100)}%</strong><div className="meter"><i style={{ width: `${Math.min(100, account.marginUtilization * 100)}%` }} /></div><small>{money(Math.max(0, account.netLiquidationValue * .25 - account.maintenanceMargin))} excess buffer</small></article>
    </section>
    <BenchmarkManager dashboard={dashboard} onRefresh={onRefresh} onNotice={onNotice} onError={onError} />
    <section className="dashboard-grid">
      <article className="panel performance-panel"><div className="panel-head"><div><span className="panel-title">Portfolio performance</span><p>Live ledger value since portfolio creation</p></div><div className="range"><button className="selected">Live</button></div></div><div className="chart-values"><div><span>Portfolio</span><strong className={account.totalReturn >= 0 ? "positive" : "negative"}>{pct(account.totalReturn)}</strong></div><div><span>Unrealized P&amp;L</span><strong>{signedMoney(dashboard.positions.reduce((sum, position) => sum + position.unrealizedPnl, 0))}</strong></div></div><div className="chart" aria-label="Portfolio equity chart"><div className="gridline g1"/><div className="gridline g2"/><div className="gridline g3"/><div className="spark-bars">{sparkBars.map((height, index) => <i key={index} style={{ height: `${dashboard.positions.length ? height : 34}%` }} />)}</div><div className="chart-axis"><span>Opened</span><span>Current session</span><span>Now</span></div></div></article>
      <article className="panel exposure-panel"><div className="panel-head"><div><span className="panel-title">Gross exposure</span><p>By asset class</p></div></div><div className="exposure-total"><strong>{money(account.grossExposure)}</strong><span>{account.netLiquidationValue ? `${number(account.grossExposure / account.netLiquidationValue * 100)}% of equity` : "No exposure"}</span></div><div className="allocation-bar">{allocation.length ? allocation.map((item) => <i key={item.label} className={item.label} style={{ width: `${item.value * 100}%` }} />) : <i className="cash" style={{ width: "100%" }} />}</div><div className="legend">{allocation.length ? allocation.map((item) => <div key={item.label}><span><i className={`swatch ${item.label}`}/>{item.label}</span><strong>{number(item.value * 100)}%</strong></div>) : <div><span><i className="swatch cash"/>Cash</span><strong>100%</strong></div>}</div></article>
    </section>
    <PositionsTable positions={dashboard.positions} />
  </>;
}

function PositionsTable({ positions, expanded = false }: { positions: Position[]; expanded?: boolean }) {
  return <section className={`panel positions-panel ${expanded ? "standalone-panel" : ""}`}><div className="panel-head"><div><span className="panel-title">Open positions</span><p>Marks refresh every 30 seconds with source and quality attached</p></div><span className="quality-badge">Simulated</span></div>{positions.length ? <div className="table-wrap"><table><thead><tr><th>Instrument</th><th>Type</th><th className="number">Quantity</th><th className="number">Avg. cost</th><th className="number">Mark</th><th className="number">Market value</th><th className="number">Unrealized P&amp;L</th></tr></thead><tbody>{positions.map((position) => <tr key={`${position.assetClass}:${position.symbol}`}><td><strong>{position.symbol}</strong><small>{position.name}</small></td><td><span className="type-pill">{position.assetClass}</span></td><td className="number">{number(position.quantity, 6)}</td><td className="number">{money(position.averageCost)}</td><td className="number">{money(position.mark)}<small>{position.quote.quality}</small></td><td className="number">{money(position.marketValue)}</td><td className={`number ${position.unrealizedPnl >= 0 ? "positive" : "negative"}`}><strong>{signedMoney(position.unrealizedPnl)}</strong></td></tr>)}</tbody></table></div> : <div className="panel-empty"><strong>No open positions</strong><span>Your first fill will appear here with its live mark and cost basis.</span></div>}</section>;
}

function OrdersTable({ orders, portfolioId, onRefresh, onNotice, onError }: { orders: Order[]; portfolioId?: string; onRefresh?: () => Promise<void>; onNotice?: (message: string) => void; onError?: (message: string) => void }) {
  async function cancel(orderId: string) {
    const response = await fetch(`/api/orders?portfolioId=${encodeURIComponent(portfolioId || "")}&orderId=${encodeURIComponent(orderId)}`, { method: "DELETE" });
    const payload = await response.json() as { error?: string };
    if (!response.ok) return onError?.(payload.error || "Unable to cancel order.");
    onNotice?.("Order canceled before execution."); await onRefresh?.();
  }
  return <section className="panel positions-panel standalone-panel"><div className="panel-head"><div><span className="panel-title">Order activity</span><p>Scheduled equity and option orders are evaluated automatically at the next regular session</p></div></div>{orders.length ? <div className="table-wrap"><table><thead><tr><th>Instrument</th><th>Side</th><th>Type</th><th>Status</th><th className="number">Quantity</th><th className="number">Submitted</th><th></th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><strong>{order.symbol}</strong></td><td>{order.side}</td><td>{order.order_type}</td><td><span className={`status-pill ${order.status}`}>{order.status.replace("_", " ")}</span>{order.scheduled_for && <small>Activates {new Date(order.scheduled_for).toLocaleString()}</small>}</td><td className="number">{order.quantity}</td><td className="number">{new Date(order.created_at).toLocaleString()}</td><td>{["scheduled", "accepted", "submitted"].includes(order.status) && portfolioId && <button className="text-button danger" onClick={() => cancel(order.id)}>Cancel</button>}</td></tr>)}</tbody></table></div> : <div className="panel-empty"><strong>No orders yet</strong><span>Submitted and queued orders will appear here.</span></div>}</section>;
}

function BenchmarkManager({ dashboard, onRefresh, onNotice, onError }: { dashboard: Dashboard; onRefresh: () => Promise<void>; onNotice: (message: string) => void; onError: (message: string) => void }) {
  const available = ["SPY", "QQQ", "AAPL", "NVDA", "BTC-USD"], selected = dashboard.benchmarks.map((item) => item.symbol);
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState<string[]>(selected), [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true); const response = await fetch("/api/benchmarks", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ portfolioId: dashboard.portfolio.id, symbols: draft }) });
    const payload = await response.json() as { error?: string }; setSaving(false);
    if (!response.ok) return onError(payload.error || "Unable to save benchmarks.");
    setEditing(false); onNotice("Benchmark comparison set updated."); await onRefresh();
  }
  return <section className="panel benchmark-panel"><div className="panel-head"><div><span className="panel-title">Benchmark comparison</span><p>Choose up to eight comparisons after entering the app</p></div><button className="text-button" onClick={() => { if (!editing) setDraft(selected); setEditing((value) => !value); }}>{editing ? "Close" : "Manage"}</button></div>{editing ? <div className="benchmark-editor">{available.map((symbol) => <label key={symbol}><input type="checkbox" checked={draft.includes(symbol)} onChange={(event) => setDraft((current) => event.target.checked ? [...current, symbol] : current.filter((item) => item !== symbol))}/><span>{symbol}</span></label>)}<button className="trade-button" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save benchmarks"}</button></div> : dashboard.benchmarks.length ? <div className="benchmark-list">{dashboard.benchmarks.map(({ symbol, quote }) => <div key={symbol}><strong>{symbol}</strong><span>{money(Number(quote.mark))}</span><small>{quote.quality} · {quote.provider}</small></div>)}</div> : <div className="panel-empty compact"><strong>No benchmarks selected</strong><span>Build a comparison set whenever you are ready.</span></div>}</section>;
}

function MarketsPanel() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  useEffect(() => { Promise.all(marketSymbols.map((symbol) => fetch(`/api/quotes?symbol=${symbol}`).then((response) => response.json()))).then(setQuotes).catch(() => undefined); }, []);
  return <section className="market-grid">{quotes.map((quote, index) => <article className="market-card" key={marketSymbols[index]}><div><strong>{marketSymbols[index]}</strong><span className="quality-badge">{quote.quality}</span></div><h3>{money(Number(quote.mark))}</h3><p>Bid {money(Number(quote.bid))} · Ask {money(Number(quote.ask))}</p><small>{quote.provider}</small></article>)}</section>;
}

function ModulePanel({ title }: { title: string }) {
  const descriptions: Record<string, string> = { "P&L": "Daily and cumulative attribution will reconcile to the immutable ledger.", Risk: "Margin, concentration, Greeks, and scenario shocks will live here.", Allocation: "Targets, drift, cash reserve, and rebalance analysis will live here.", Activity: "Every fill, cash flow, settlement, exercise, and liquidation will be auditable here." };
  return <section className="empty-panel"><span className="eyebrow">Module scaffold</span><strong>{title}</strong><p>{descriptions[title] || "This module is ready for its next implementation pass."}</p></section>;
}

function PnlPanel({ dashboard }: { dashboard: Dashboard }) {
  const latest = dashboard.pnlHistory.at(-1);
  return <section className="analytics-grid"><article className="panel analytics-card"><span>Realized P&amp;L</span><strong className={(latest?.realizedPnl || 0) >= 0 ? "positive" : "negative"}>{signedMoney(latest?.realizedPnl || 0)}</strong><small>Cash ledger reconciled</small></article><article className="panel analytics-card"><span>Unrealized P&amp;L</span><strong className={(latest?.unrealizedPnl || 0) >= 0 ? "positive" : "negative"}>{signedMoney(latest?.unrealizedPnl || 0)}</strong><small>Current position marks</small></article><article className="panel analytics-card"><span>Total P&amp;L</span><strong className={dashboard.account.totalPnl >= 0 ? "positive" : "negative"}>{signedMoney(dashboard.account.totalPnl)}</strong><small>Since portfolio creation</small></article><article className="panel history-card"><div className="panel-head"><div><span className="panel-title">Daily ledger snapshots</span><p>One reconciled close per New York trading date</p></div></div><div className="history-list">{dashboard.pnlHistory.map((item) => <div key={item.date}><span>{item.date}</span><strong>{money(item.netLiquidationValue)}</strong><span className={item.realizedPnl + item.unrealizedPnl >= 0 ? "positive" : "negative"}>{signedMoney(item.realizedPnl + item.unrealizedPnl)}</span></div>)}</div></article></section>;
}

function RiskPanel({ dashboard }: { dashboard: Dashboard }) {
  return <section className="analytics-grid"><article className="panel analytics-card"><span>Gross leverage</span><strong>{dashboard.risk.leverage.toFixed(2)}×</strong><small>Gross exposure / equity</small></article><article className="panel analytics-card"><span>Estimated daily risk</span><strong>{money(dashboard.risk.estimatedDailyVar)}</strong><small>Transparent sensitivity estimate, not historical VaR</small></article><article className="panel analytics-card"><span>Largest concentration</span><strong>{dashboard.risk.largestPosition ? `${(dashboard.risk.largestPosition.concentration * 100).toFixed(1)}%` : "0%"}</strong><small>{dashboard.risk.largestPosition?.symbol || "No open positions"}</small></article><article className="panel history-card"><div className="panel-head"><div><span className="panel-title">Risk controls</span><p>Enforced automatically</p></div></div><div className="control-list"><div><strong>110%</strong><span>Maintenance liquidation buffer</span></div><div><strong>Reg T</strong><span>Equity buying-power model</span></div><div><strong>First notice</strong><span>Physical futures close safeguard</span></div></div></article></section>;
}

function ActivityPanel({ dashboard }: { dashboard: Dashboard }) {
  return <section className="panel positions-panel standalone-panel"><div className="panel-head"><div><span className="panel-title">System activity</span><p>Lifecycle and risk events generated by the simulator</p></div></div>{dashboard.alerts.length ? <div className="activity-list">{dashboard.alerts.map((alert) => <div key={alert.id}><span className={`severity ${alert.severity}`}>{alert.severity}</span><div><strong>{alert.title}</strong><p>{alert.message}</p></div><time>{new Date(alert.created_at).toLocaleString()}</time></div>)}</div> : <div className="panel-empty"><strong>No system events</strong><span>Exercises, settlements, and liquidations will appear here.</span></div>}</section>;
}

function PortfolioDialog({ dark, onClose, onCreated, onError }: { dark: boolean; onClose?: () => void; onCreated: (id: string) => void; onError: (message: string) => void }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/portfolios", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), startingCapital: Number(form.get("capital")), advancedDerivativesEnabled: form.get("advanced") === "on", theme: dark ? "dark" : "light" }) });
    const payload = await response.json() as { id?: string; error?: string };
    setSaving(false); if (!response.ok || !payload.id) return onError(payload.error || "Unable to create portfolio.");
    await onCreated(payload.id);
  }
  return <div className="modal-backdrop"><section className="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="portfolio-title"><div className="onboarding-copy"><span className="brand-mark">MM</span><p className="eyebrow">Portfolio setup</p><h2 id="portfolio-title">Build your trading book</h2><p>Start with real accounting, explicit data quality, and the risk controls we defined.</p><ul><li>USD base currency</li><li>Current markets only</li><li>Immediate margin liquidation</li><li>No equity after-hours execution</li></ul></div><form onSubmit={submit}><label>Portfolio name<input name="name" required defaultValue="Core Opportunities" /></label><label>Starting capital<input name="capital" type="number" required min="1000" step="100" defaultValue="500000" /><small>$1,000 minimum · $500,000 suggested</small></label><div className="setup-note"><strong>Benchmarks come next</strong><span>Once inside, choose any set of benchmarks you want to compare against.</span></div><div className="check-label"><input id="advanced-derivatives" name="advanced" type="checkbox"/><label htmlFor="advanced-derivatives"><strong>Enable Advanced Derivatives</strong><small>Required for uncovered short options.</small></label></div><div className="dialog-actions">{onClose && <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>}<button className="trade-button" disabled={saving}>{saving ? "Creating…" : "Create portfolio"}</button></div></form></section></div>;
}

function TradeDrawer({ portfolio, dashboard, onClose, onComplete, onError }: { portfolio: Portfolio; dashboard: Dashboard; onClose: () => void; onComplete: (message: string) => void; onError: (message: string) => void }) {
  const [assetClass, setAssetClass] = useState("Equity"), [symbol, setSymbol] = useState("NVDA"), [side, setSide] = useState<"buy" | "sell">("buy"), [orderType, setOrderType] = useState<"market" | "limit">("market"), [quantity, setQuantity] = useState(100), [limitPrice, setLimitPrice] = useState(""), [quote, setQuote] = useState<Quote | null>(null), [submitting, setSubmitting] = useState(false);
  const [chain, setChain] = useState<{ expirations: string[]; strikes: number[] } | null>(null), [expiration, setExpiration] = useState(""), [strike, setStrike] = useState(0), [right, setRight] = useState<"call" | "put">("call"), [exerciseStyle, setExerciseStyle] = useState<"american" | "european">("american");
  const [futureContracts, setFutureContracts] = useState<FutureContract[]>([]), [deliveryDate, setDeliveryDate] = useState(() => new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10)), [deliveryPrice, setDeliveryPrice] = useState(0);
  useEffect(() => {
    if (assetClass !== "Options") return;
    const timer = window.setTimeout(() => fetch(`/api/options?underlying=${encodeURIComponent(symbol)}`).then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setChain(payload); setExpiration((current) => current || payload.expirations[0]); setStrike((current) => current || payload.strikes[Math.floor(payload.strikes.length / 2)]); }).catch((reason) => onError(reason.message)), 150);
    return () => window.clearTimeout(timer);
  }, [assetClass, symbol, onError]);
  useEffect(() => {
    if (assetClass !== "Futures") return;
    const timer = window.setTimeout(() => fetch("/api/futures").then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setFutureContracts(payload.contracts); const first = payload.contracts[0] as FutureContract; if (first) { setSymbol(first.symbol); setQuote(first.quote); } }).catch((reason) => onError(reason.message)), 0);
    return () => window.clearTimeout(timer);
  }, [assetClass, onError]);
  useEffect(() => {
    if (assetClass === "Futures") return;
    const quoteAsset = assetClass === "Forward" ? (symbol.endsWith("-USD") ? "crypto" : "equity") : assetMap[assetClass];
    const params = new URLSearchParams({ symbol, assetClass: quoteAsset });
    if (assetClass === "Options") { if (!expiration || !strike) return; params.set("expiration", expiration); params.set("strike", strike.toString()); params.set("right", right); params.set("exerciseStyle", exerciseStyle); }
    const timer = window.setTimeout(() => fetch(`/api/quotes?${params}`).then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setQuote(payload); }).catch((reason) => { setQuote(null); if (symbol.length > 1) onError(reason.message); }), 250);
    return () => window.clearTimeout(timer);
  }, [assetClass, symbol, expiration, strike, right, exerciseStyle, onError]);
  const selectedFuture = futureContracts.find((contract) => contract.symbol === symbol);
  const estimatedPrice = quote ? Number(side === "buy" ? quote.ask : quote.bid) : 0;
  const estimatedNotional = estimatedPrice * quantity * (assetClass === "Options" ? 100 : assetClass === "Futures" ? selectedFuture?.multiplier || 1 : 1);
  async function submit() {
    setSubmitting(true);
    const optionContract = assetClass === "Options" ? { underlying: symbol, expiration, strike, right, exerciseStyle } : undefined;
    const forwardContract = assetClass === "Forward" ? { underlying: symbol, deliveryDate, deliveryPrice: deliveryPrice || Number(quote?.mark), quantityUnit: "units" } : undefined;
    const response = await fetch("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ portfolioId: portfolio.id, symbol, assetClass: assetMap[assetClass], side, orderType, quantity, limitPrice: limitPrice ? Number(limitPrice) : undefined, timeInForce: "day", optionContract, futureContract: selectedFuture, forwardContract }) });
    const payload = await response.json() as { status?: string; scheduledFor?: string; error?: string };
    setSubmitting(false); if (!response.ok) return onError(payload.error || "Order rejected.");
    await onComplete(payload.status === "scheduled" ? `Order queued for the next regular session: ${new Date(payload.scheduledFor || "").toLocaleString()}.` : payload.status === "filled" ? `Order filled. Positions, cash, and P&L have been recalculated.` : "Limit order accepted and is awaiting its price.");
  }
  return <div className="drawer-backdrop"><button className="drawer-dismiss" onClick={onClose} aria-label="Close trade ticket overlay"/><aside className="trade-drawer" aria-label="Trade ticket"><div className="drawer-head"><div><p className="eyebrow">{portfolio.name}</p><h2>New order</h2></div><button onClick={onClose} aria-label="Close trade ticket">×</button></div><div className="asset-tabs">{["Equity", "Crypto", "Futures", "Options", "Forward"].map((item) => <button key={item} className={assetClass === item ? "selected" : ""} onClick={() => { setAssetClass(item); setSymbol(item === "Crypto" ? "BTC-USD" : item === "Options" || item === "Forward" ? "SPY" : item === "Futures" ? "ESZ6" : "NVDA"); setQuantity(item === "Options" || item === "Futures" ? 1 : item === "Crypto" ? 0.1 : 100); setChain(null); setExpiration(""); setStrike(0); }}>{item}</button>)}</div><label>{["Options", "Forward"].includes(assetClass) ? "Underlying" : "Instrument"}{assetClass === "Options" || assetClass === "Forward" ? <select value={symbol} onChange={(event) => { setSymbol(event.target.value); setExpiration(""); setStrike(0); setDeliveryPrice(0); }}><option>SPY</option><option>QQQ</option><option>AAPL</option><option>MSFT</option><option>NVDA</option><option>TSLA</option><option>BTC-USD</option></select> : assetClass === "Futures" ? <select value={symbol} onChange={(event) => { const next = futureContracts.find((contract) => contract.symbol === event.target.value); setSymbol(event.target.value); if (next) setQuote(next.quote); }}>{futureContracts.map((contract) => <option key={contract.symbol} value={contract.symbol}>{contract.symbol} · {contract.name}</option>)}</select> : <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="Search instruments"/>}</label>{assetClass === "Options" && <div className="contract-grid"><label>Expiration<select value={expiration} onChange={(event) => setExpiration(event.target.value)}>{chain?.expirations.map((item) => <option key={item}>{item}</option>)}</select></label><label>Strike<select value={strike} onChange={(event) => setStrike(Number(event.target.value))}>{chain?.strikes.map((item) => <option key={item} value={item}>{money(item)}</option>)}</select></label><label>Right<select value={right} onChange={(event) => setRight(event.target.value as "call" | "put")}><option value="call">Call</option><option value="put">Put</option></select></label><label>Exercise<select value={exerciseStyle} onChange={(event) => setExerciseStyle(event.target.value as "american" | "european")}><option value="american">American</option><option value="european">European</option></select></label></div>}{assetClass === "Forward" && <div className="contract-grid"><label>Delivery date<input type="date" min={new Date().toISOString().slice(0, 10)} value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)}/></label><label>Delivery price<input type="number" min="0.01" step=".01" value={deliveryPrice || quote?.mark || ""} onChange={(event) => setDeliveryPrice(Number(event.target.value))}/></label></div>}{assetClass === "Futures" && selectedFuture && <div className="contract-summary"><span>Multiplier <strong>{selectedFuture.multiplier}×</strong></span><span>Initial margin <strong>{money(selectedFuture.initialMargin)}</strong></span><span>Settlement <strong>{selectedFuture.settlementType}</strong></span></div>}<div className="quote-strip"><span>Bid<strong>{quote?.bid ? money(Number(quote.bid)) : "—"}</strong></span><span>Ask<strong>{quote?.ask ? money(Number(quote.ask)) : "—"}</strong></span><span>Mark<strong>{quote ? money(Number(quote.mark)) : "—"}</strong></span><span>Quality<strong className="quality-text">{quote?.quality || "Unavailable"}</strong></span></div><div className="field-row"><label>Side<select value={side} onChange={(event) => setSide(event.target.value as "buy" | "sell")}><option value="buy">Buy</option><option value="sell">Sell</option></select></label><label>Order type<select value={orderType} onChange={(event) => setOrderType(event.target.value as "market" | "limit")}><option value="market">Market</option><option value="limit">Limit</option></select></label></div><div className="field-row"><label>Quantity<input type="number" min="0.000001" step={assetClass === "Crypto" ? ".001" : "1"} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))}/></label>{orderType === "limit" ? <label>Limit price<input type="number" min="0.01" step=".01" value={limitPrice} onChange={(event) => setLimitPrice(event.target.value)}/></label> : <label>Time in force<select><option>Day</option></select></label>}</div><div className="estimate-card"><div><span>Reference notional</span><strong>{money(estimatedNotional)}</strong></div><div><span>Available buying power</span><strong>{money(dashboard.account.buyingPower)}</strong></div><div><span>Execution model</span><strong>{assetClass === "Options" ? "Indicative model + spread" : assetClass === "Forward" ? "Spot reference · zero rate" : "Bid/ask + size impact"}</strong></div><p><span className={`status-dot ${dashboard.session.isOpen || ["Crypto", "Forward", "Futures"].includes(assetClass) ? "" : "closed"}`}/>{["Equity", "Options"].includes(assetClass) && !dashboard.session.isOpen ? "This order will queue for the next regular session." : assetClass === "Futures" ? "CME session rules and first-notice safeguards apply." : "Eligible for current-session evaluation."}</p></div><button className="review-button" disabled={submitting || !quote || quantity <= 0 || (orderType === "limit" && !limitPrice)} onClick={submit}>{submitting ? "Checking buying power…" : "Submit order"}</button><p className="ticket-note">Zero commissions · Sufficient buying power required · Lifecycle events are automatic</p></aside></div>;
}
