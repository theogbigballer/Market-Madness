"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import StrategyBuilder from "./components/StrategyBuilder";
import CorporateActionsPanel, { type CorporateAction } from "./components/CorporateActionsPanel";

type Portfolio = { id: string; name: string; startingCapital: number; advancedDerivativesEnabled: boolean; theme: string };
type Quote = { bid?: string; ask?: string; last?: string; mark: string; provider: string; quality: string; observedAt: string; name?: string };
type Position = { instrumentId: string; symbol: string; name: string; assetClass: string; quantity: number; mark: number; averageCost: number; marketValue: number; unrealizedPnl: number; quote: Quote; optionGreeks?: { delta: number; gamma: number; theta: number; vega: number }; optionContract?: { underlying: string; expiration: string; strike: number; right: "call" | "put"; exerciseStyle: "american" | "european" } };
type Order = { id: string; symbol: string; side: string; order_type: string; status: string; quantity: string; filled_quantity: string; limit_price: string | null; scheduled_for: string | null; created_at: string; leg_count: number };
type FutureContract = { root: string; symbol: string; name: string; expiration: string; firstNotice?: string; multiplier: number; initialMargin: number; maintenanceMargin: number; settlementType: "cash" | "physical"; quote: Quote };
type Dashboard = {
  portfolio: Portfolio;
  account: { cash: number; marketValue: number; netLiquidationValue: number; totalPnl: number; totalReturn: number; netExternalFlows: number; buyingPower: number; reservedBuyingPower: number; grossExposure: number; maintenanceMargin: number; marginUtilization: number };
  positions: Position[]; orders: Order[];
  benchmarks: { symbol: string; quote: Quote }[];
  allocations: { bucket: string; targetWeight: number; minimumWeight: number | null; maximumWeight: number | null }[];
  corporateActions: CorporateAction[];
  performanceSeries: { key: string; label: string; quality: string; return: number; points: { at: string; value: number; return: number }[] }[];
  ledgerReport: { transactions: { id: string; eventType: string; amount: number; description: string; effectiveAt: string }[]; attribution: { trading: number; dividends: number; settlements: number; externalFlows: number } };
  closureReport: { trades: { id: string; symbol: string; name: string; assetClass: string; quantity: number; entryPrice: number; exitPrice: number; multiplier: number; realizedPnl: number; reason: string; basisTransferred: boolean; closedAt: string; orderId: string | null; strategyLegCount: number }[]; byAssetClass: { key: string; realizedPnl: number; closures: number }[]; byInstrument: { key: string; realizedPnl: number; closures: number }[]; summary: { realizedPnl: number; winners: number; losers: number; winRate: number } };
  pnlHistory: { date: string; netLiquidationValue: number; realizedPnl: number; unrealizedPnl: number }[];
  risk: { leverage: number; estimatedDailyVar: number; largestPosition: { symbol: string; value: number; concentration: number } | null; greeks: { delta: number; gamma: number; theta: number; vega: number }; scenarios: { shock: number; estimatedPnl: number }[] };
  alerts: { id: string; severity: string; event_type: string; title: string; message: string; created_at: string }[];
  session: { isOpen: boolean; closesAt: string; nextOpenAt: string };
  quoteStatus: { provider: string; quality: string; refreshedAt: string };
};

const navigation = ["Overview", "Trade", "Strategies", "Positions", "Markets", "Orders", "P&L", "Blotter", "Risk", "Allocation", "Corporate actions", "Activity"];
const marketSymbols = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA"];
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
          <button className={active === "Data providers" ? "nav-item active" : "nav-item"} onClick={() => setActive("Data providers")}><span className="nav-dot" />Data providers</button><button className={active === "Settings" ? "nav-item active" : "nav-item"} onClick={() => setActive("Settings")}><span className="nav-dot" />Settings</button>
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
          {dashboard && active === "Positions" && <PositionsTable positions={dashboard.positions} expanded portfolioId={dashboard.portfolio.id} sessionOpen={dashboard.session.isOpen} onRefresh={refreshDashboard} onNotice={setNotice} onError={setError} />}
          {dashboard && active === "Strategies" && <StrategyBuilder portfolioId={dashboard.portfolio.id} buyingPower={dashboard.account.buyingPower} sessionOpen={dashboard.session.isOpen} onComplete={async (message) => { setNotice(message); setActive("Overview"); await refreshDashboard(); }} onError={setError} />}
          {dashboard && active === "Orders" && <OrdersTable orders={dashboard.orders} portfolioId={dashboard.portfolio.id} onRefresh={refreshDashboard} onNotice={setNotice} onError={setError} />}
          {dashboard && active === "Markets" && <MarketsPanel />}
          {dashboard && active === "P&L" && <PnlPanel dashboard={dashboard} />}
          {dashboard && active === "Blotter" && <BlotterPanel dashboard={dashboard} />}
          {dashboard && active === "Risk" && <RiskPanel dashboard={dashboard} />}
          {dashboard && active === "Activity" && <ActivityPanel dashboard={dashboard} />}
          {dashboard && active === "Allocation" && <AllocationPanel key={dashboard.portfolio.id} dashboard={dashboard} onRefresh={refreshDashboard} onNotice={setNotice} onError={setError} />}
          {dashboard && active === "Corporate actions" && <CorporateActionsPanel actions={dashboard.corporateActions} onRefresh={refreshDashboard} onNotice={setNotice} onError={setError} />}
          {dashboard && active === "Settings" && <SettingsPanel key={dashboard.portfolio.id} dashboard={dashboard} onRefresh={async () => { await loadPortfolios(); await refreshDashboard(); }} onPortfolioRemoved={async () => { setPortfolioId(""); setDashboard(null); await loadPortfolios(); }} onNotice={setNotice} onError={setError} />}
          {dashboard && !["Overview", "Strategies", "Positions", "Orders", "Markets", "Trade", "P&L", "Blotter", "Risk", "Activity", "Allocation", "Corporate actions", "Settings"].includes(active) && <ModulePanel title={active} />}
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
      <PerformanceChart series={dashboard.performanceSeries} />
      <article className="panel exposure-panel"><div className="panel-head"><div><span className="panel-title">Gross exposure</span><p>By asset class</p></div></div><div className="exposure-total"><strong>{money(account.grossExposure)}</strong><span>{account.netLiquidationValue ? `${number(account.grossExposure / account.netLiquidationValue * 100)}% of equity` : "No exposure"}</span></div><div className="allocation-bar">{allocation.length ? allocation.map((item) => <i key={item.label} className={item.label} style={{ width: `${item.value * 100}%` }} />) : <i className="cash" style={{ width: "100%" }} />}</div><div className="legend">{allocation.length ? allocation.map((item) => <div key={item.label}><span><i className={`swatch ${item.label}`}/>{item.label}</span><strong>{number(item.value * 100)}%</strong></div>) : <div><span><i className="swatch cash"/>Cash</span><strong>100%</strong></div>}</div></article>
    </section>
    <PositionsTable positions={dashboard.positions} portfolioId={dashboard.portfolio.id} sessionOpen={dashboard.session.isOpen} onRefresh={onRefresh} onNotice={onNotice} onError={onError} />
  </>;
}

function PerformanceChart({ series }: { series: Dashboard["performanceSeries"] }) {
  const visible = series.filter((item) => item.points.length), maxMove = Math.max(0.001, ...visible.flatMap((item) => item.points.map((point) => Math.abs(point.return))));
  return <article className="panel performance-panel"><div className="panel-head"><div><span className="panel-title">Today&apos;s relative performance</span><p>Flow-adjusted portfolio return versus every selected benchmark</p></div><span className="quality-badge">30 sec samples</span></div>{visible.length ? <div className="relative-chart">{visible.map((item) => { const points = item.points.slice(-48); return <div className="relative-series" key={item.key}><div className="series-label"><strong>{item.label}</strong><span className={item.return >= 0 ? "positive" : "negative"}>{pct(item.return)}</span><small>{item.quality}</small></div><div className="series-track" aria-label={`${item.label} intraday return ${pct(item.return)}`}><span className="zero-line"/>{points.map((point, index) => { const magnitude = Math.max(1, Math.abs(point.return) / maxMove * 45); return <i key={point.at} className={point.return >= 0 ? "up" : "down"} title={`${new Date(point.at).toLocaleTimeString()} · ${pct(point.return)}`} style={{ left: `${points.length === 1 ? 50 : index / (points.length - 1) * 100}%`, height: `${magnitude}%`, bottom: point.return >= 0 ? "50%" : `${50 - magnitude}%` }}/>; })}</div></div>; })}<div className="relative-axis"><span>First sample</span><span>Current session</span><span>Now</span></div></div> : <div className="panel-empty compact"><strong>Collecting the first sample</strong><span>Returns begin at zero and update with the 30-second quote cycle.</span></div>}</article>;
}

function PositionsTable({ positions, expanded = false, portfolioId, sessionOpen, onRefresh, onNotice, onError }: { positions: Position[]; expanded?: boolean; portfolioId?: string; sessionOpen?: boolean; onRefresh?: () => Promise<void>; onNotice?: (message: string) => void; onError?: (message: string) => void }) {
  async function exercise(position: Position) {
    const quantity = Number(window.prompt(`Contracts to exercise (maximum ${position.quantity})`, Math.floor(position.quantity).toString())); if (!quantity) return;
    const response = await fetch("/api/options/exercise", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ portfolioId, instrumentId: position.instrumentId, quantity }) });
    const payload = await response.json() as { error?: string }; if (!response.ok) return onError?.(payload.error || "Unable to exercise option.");
    onNotice?.("American option exercised into the underlying shares."); await onRefresh?.();
  }
  return <section className={`panel positions-panel ${expanded ? "standalone-panel" : ""}`}><div className="panel-head"><div><span className="panel-title">Open positions</span><p>Marks refresh every 30 seconds with source and quality attached</p></div><span className="quality-badge">Simulated</span></div>{positions.length ? <div className="table-wrap"><table><thead><tr><th>Instrument</th><th>Type</th><th className="number">Quantity</th><th className="number">Avg. cost</th><th className="number">Mark</th><th className="number">Market value</th><th className="number">Unrealized P&amp;L</th>{portfolioId && <th></th>}</tr></thead><tbody>{positions.map((position) => <tr key={`${position.assetClass}:${position.symbol}`}><td><strong>{position.symbol}</strong><small>{position.name}</small></td><td><span className="type-pill">{position.assetClass}</span></td><td className="number">{number(position.quantity, 6)}</td><td className="number">{money(position.averageCost)}</td><td className="number">{money(position.mark)}<small>{position.quote.quality}</small></td><td className="number">{money(position.marketValue)}</td><td className={`number ${position.unrealizedPnl >= 0 ? "positive" : "negative"}`}><strong>{signedMoney(position.unrealizedPnl)}</strong></td>{portfolioId && <td>{position.optionContract?.exerciseStyle === "american" && position.quantity > 0 && <button className="text-button" disabled={!sessionOpen} title={sessionOpen ? "Exercise an in-the-money American option" : "Available during the regular session"} onClick={() => exercise(position)}>Exercise</button>}</td>}</tr>)}</tbody></table></div> : <div className="panel-empty"><strong>No open positions</strong><span>Your first fill will appear here with its live mark and cost basis.</span></div>}</section>;
}

function OrdersTable({ orders, portfolioId, onRefresh, onNotice, onError }: { orders: Order[]; portfolioId?: string; onRefresh?: () => Promise<void>; onNotice?: (message: string) => void; onError?: (message: string) => void }) {
  async function cancel(orderId: string) {
    const response = await fetch(`/api/orders?portfolioId=${encodeURIComponent(portfolioId || "")}&orderId=${encodeURIComponent(orderId)}`, { method: "DELETE" });
    const payload = await response.json() as { error?: string };
    if (!response.ok) return onError?.(payload.error || "Unable to cancel order.");
    onNotice?.("Order canceled before execution."); await onRefresh?.();
  }
  return <section className="panel positions-panel standalone-panel"><div className="panel-head"><div><span className="panel-title">Order activity</span><p>Scheduled equity and option orders are evaluated automatically at the next regular session</p></div></div>{orders.length ? <div className="table-wrap"><table><thead><tr><th>Instrument</th><th>Side</th><th>Type</th><th>Status</th><th className="number">Quantity</th><th className="number">Submitted</th><th></th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><strong>{order.leg_count ? `${order.leg_count}-leg strategy` : order.symbol}</strong>{order.leg_count > 0 && <small>{order.symbol} lead contract</small>}</td><td>{order.side}</td><td>{order.order_type}{order.order_type === "limit" && order.limit_price && <small>{order.side === "buy" ? "Max debit" : "Min credit"} {money(Number(order.limit_price))}</small>}</td><td><span className={`status-pill ${order.status}`}>{order.status.replace("_", " ")}</span>{order.scheduled_for && <small>Activates {new Date(order.scheduled_for).toLocaleString()}</small>}</td><td className="number">{order.quantity}</td><td className="number">{new Date(order.created_at).toLocaleString()}</td><td>{["scheduled", "accepted", "submitted"].includes(order.status) && portfolioId && <button className="text-button danger" onClick={() => cancel(order.id)}>Cancel</button>}</td></tr>)}</tbody></table></div> : <div className="panel-empty"><strong>No orders yet</strong><span>Submitted and queued orders will appear here.</span></div>}</section>;
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
  const latest = dashboard.pnlHistory.at(-1), exportBase = `/api/exports?portfolioId=${encodeURIComponent(dashboard.portfolio.id)}&report=`;
  return <section className="analytics-grid"><article className="panel analytics-card"><span>Realized P&amp;L</span><strong className={(latest?.realizedPnl || 0) >= 0 ? "positive" : "negative"}>{signedMoney(latest?.realizedPnl || 0)}</strong><small>Cash ledger reconciled</small></article><article className="panel analytics-card"><span>Unrealized P&amp;L</span><strong className={(latest?.unrealizedPnl || 0) >= 0 ? "positive" : "negative"}>{signedMoney(latest?.unrealizedPnl || 0)}</strong><small>Current position marks</small></article><article className="panel analytics-card"><span>Flow-adjusted total</span><strong className={dashboard.account.totalPnl >= 0 ? "positive" : "negative"}>{signedMoney(dashboard.account.totalPnl)}</strong><small>{dashboard.account.netExternalFlows ? `${signedMoney(dashboard.account.netExternalFlows)} external flows excluded` : "No external flows affecting return"}</small></article><article className="panel history-card"><div className="panel-head"><div><span className="panel-title">Realized attribution</span><p>Income and derivative settlements separated from trading</p></div></div><div className="attribution-grid">{Object.entries(dashboard.ledgerReport.attribution).map(([key, value]) => <div key={key}><span>{key.replace(/([A-Z])/g, " $1")}</span><strong className={value >= 0 ? "positive" : "negative"}>{signedMoney(value)}</strong></div>)}</div></article><article className="panel history-card"><div className="panel-head"><div><span className="panel-title">Daily ledger snapshots</span><p>One reconciled close per New York trading date</p></div><div className="export-actions"><a href={`${exportBase}pnl`}>P&amp;L CSV</a><a href={`${exportBase}positions`}>Positions CSV</a><a href={`${exportBase}transactions`}>Ledger CSV</a></div></div><div className="history-list">{dashboard.pnlHistory.map((item) => <div key={item.date}><span>{item.date}</span><strong>{money(item.netLiquidationValue)}</strong><span className={item.realizedPnl + item.unrealizedPnl >= 0 ? "positive" : "negative"}>{signedMoney(item.realizedPnl + item.unrealizedPnl)}</span></div>)}</div></article><article className="panel history-card"><div className="panel-head"><div><span className="panel-title">Transaction ledger</span><p>Most recent immutable cash events</p></div></div>{dashboard.ledgerReport.transactions.length ? <div className="table-wrap"><table><thead><tr><th>Time</th><th>Event</th><th>Description</th><th className="number">Cash amount</th></tr></thead><tbody>{dashboard.ledgerReport.transactions.map((transaction) => <tr key={transaction.id}><td>{new Date(transaction.effectiveAt).toLocaleString()}</td><td><span className="type-pill">{transaction.eventType.replace("_", " ")}</span></td><td>{transaction.description}</td><td className={`number ${transaction.amount >= 0 ? "positive" : "negative"}`}>{signedMoney(transaction.amount)}</td></tr>)}</tbody></table></div> : <div className="panel-empty compact"><strong>No ledger events</strong><span>Cash activity will appear here.</span></div>}</article></section>;
}

function BlotterPanel({ dashboard }: { dashboard: Dashboard }) {
  const report = dashboard.closureReport, exportUrl = `/api/exports?portfolioId=${encodeURIComponent(dashboard.portfolio.id)}&report=closed-trades`;
  return <section className="analytics-grid"><article className="panel analytics-card"><span>Closed-lot realized P&amp;L</span><strong className={report.summary.realizedPnl >= 0 ? "positive" : "negative"}>{signedMoney(report.summary.realizedPnl)}</strong><small>FIFO lot closures · basis transfers excluded</small></article><article className="panel analytics-card"><span>Win rate</span><strong>{pct(report.summary.winRate)}</strong><small>{report.summary.winners} winners · {report.summary.losers} losers</small></article><article className="panel analytics-card"><span>Audited closures</span><strong>{report.trades.length}</strong><small>Partial closes are recorded independently</small></article><article className="panel history-card"><div className="panel-head"><div><span className="panel-title">Attribution</span><p>Durable realized P&amp;L grouped by asset class and instrument</p></div><div className="export-actions"><a href={exportUrl}>Closed trades CSV</a></div></div><div className="blotter-attribution"><div><span className="panel-title">Asset class</span>{report.byAssetClass.map((item) => <p key={item.key}><span>{item.key} · {item.closures}</span><strong className={item.realizedPnl >= 0 ? "positive" : "negative"}>{signedMoney(item.realizedPnl)}</strong></p>)}</div><div><span className="panel-title">Instrument</span>{report.byInstrument.slice(0, 8).map((item) => <p key={item.key}><span>{item.key} · {item.closures}</span><strong className={item.realizedPnl >= 0 ? "positive" : "negative"}>{signedMoney(item.realizedPnl)}</strong></p>)}</div></div></article><article className="panel history-card"><div className="panel-head"><div><span className="panel-title">Closed-trades blotter</span><p>Entry-to-exit audit trail with strategy and lifecycle context</p></div></div>{report.trades.length ? <div className="table-wrap"><table><thead><tr><th>Closed</th><th>Instrument</th><th>Reason</th><th className="number">Quantity</th><th className="number">Entry</th><th className="number">Exit</th><th className="number">Realized P&amp;L</th></tr></thead><tbody>{report.trades.map((trade) => <tr key={trade.id}><td>{new Date(trade.closedAt).toLocaleString()}</td><td><strong>{trade.symbol}</strong><small className="table-subline">{trade.assetClass}{trade.strategyLegCount ? ` · ${trade.strategyLegCount}-leg strategy` : ""}</small></td><td><span className="type-pill">{trade.reason.replaceAll("_", " ")}</span>{trade.basisTransferred && <small className="table-subline">basis transferred</small>}</td><td className="number">{number(trade.quantity, 6)}</td><td className="number">{money(trade.entryPrice)}</td><td className="number">{money(trade.exitPrice)}</td><td className={`number ${trade.realizedPnl >= 0 ? "positive" : "negative"}`}>{trade.basisTransferred ? "Transferred" : signedMoney(trade.realizedPnl)}</td></tr>)}</tbody></table></div> : <div className="panel-empty"><strong>No closed lots yet</strong><span>Close part or all of a position to create an auditable realized P&amp;L record.</span></div>}</article></section>;
}

function RiskPanel({ dashboard }: { dashboard: Dashboard }) {
  return <section className="analytics-grid"><article className="panel analytics-card"><span>Gross leverage</span><strong>{dashboard.risk.leverage.toFixed(2)}×</strong><small>Gross exposure / equity</small></article><article className="panel analytics-card"><span>Estimated daily risk</span><strong>{money(dashboard.risk.estimatedDailyVar)}</strong><small>Transparent sensitivity estimate, not historical VaR</small></article><article className="panel analytics-card"><span>Largest concentration</span><strong>{dashboard.risk.largestPosition ? `${(dashboard.risk.largestPosition.concentration * 100).toFixed(1)}%` : "0%"}</strong><small>{dashboard.risk.largestPosition?.symbol || "No open positions"}</small></article><article className="panel history-card"><div className="panel-head"><div><span className="panel-title">Portfolio Greeks</span><p>Contract-adjusted exposure across all option positions</p></div></div><div className="control-list greek-controls"><div><strong>{dashboard.risk.greeks.delta.toFixed(2)}</strong><span>Delta-equivalent shares</span></div><div><strong>{dashboard.risk.greeks.gamma.toFixed(3)}</strong><span>Gamma</span></div><div><strong>{dashboard.risk.greeks.theta.toFixed(2)}</strong><span>Theta / day</span></div><div><strong>{dashboard.risk.greeks.vega.toFixed(2)}</strong><span>Vega / vol point</span></div></div></article><article className="panel history-card"><div className="panel-head"><div><span className="panel-title">Underlying shock scenarios</span><p>Delta-gamma approximation for options; linear marks for other assets</p></div></div><div className="scenario-grid">{dashboard.risk.scenarios.map((scenario) => <div key={scenario.shock}><span>{pct(scenario.shock)} shock</span><strong className={scenario.estimatedPnl >= 0 ? "positive" : "negative"}>{signedMoney(scenario.estimatedPnl)}</strong></div>)}</div></article><article className="panel history-card"><div className="panel-head"><div><span className="panel-title">Risk controls</span><p>Enforced automatically</p></div></div><div className="control-list"><div><strong>110%</strong><span>Maintenance liquidation buffer</span></div><div><strong>Reg T</strong><span>Equity buying-power model</span></div><div><strong>First notice</strong><span>Physical futures close safeguard</span></div></div></article></section>;
}

function ActivityPanel({ dashboard }: { dashboard: Dashboard }) {
  return <section className="panel positions-panel standalone-panel"><div className="panel-head"><div><span className="panel-title">System activity</span><p>Lifecycle and risk events generated by the simulator</p></div></div>{dashboard.alerts.length ? <div className="activity-list">{dashboard.alerts.map((alert) => <div key={alert.id}><span className={`severity ${alert.severity}`}>{alert.severity}</span><div><strong>{alert.title}</strong><p>{alert.message}</p></div><time>{new Date(alert.created_at).toLocaleString()}</time></div>)}</div> : <div className="panel-empty"><strong>No system events</strong><span>Exercises, settlements, and liquidations will appear here.</span></div>}</section>;
}

function AllocationPanel({ dashboard, onRefresh, onNotice, onError }: { dashboard: Dashboard; onRefresh: () => Promise<void>; onNotice: (message: string) => void; onError: (message: string) => void }) {
  const buckets = ["equity", "crypto", "options", "futures", "forward", "cash"];
  const initial = Object.fromEntries(buckets.map((bucket) => [bucket, Math.round((dashboard.allocations.find((item) => item.bucket === bucket)?.targetWeight || (bucket === "equity" ? 0.6 : bucket === "cash" ? 0.4 : 0)) * 100)]));
  const [targets, setTargets] = useState<Record<string, number>>(initial), [saving, setSaving] = useState(false);
  const total = Object.values(targets).reduce((sum, value) => sum + value, 0);
  const gross = dashboard.positions.reduce((sum, position) => sum + Math.abs(position.marketValue), 0);
  const allocationBase = gross + Math.max(0, dashboard.account.cash);
  const actual = Object.fromEntries(buckets.map((bucket) => [bucket, bucket === "cash" ? allocationBase ? Math.max(0, dashboard.account.cash) / allocationBase : 1 : allocationBase ? dashboard.positions.filter((position) => position.assetClass === bucket || `${position.assetClass}s` === bucket).reduce((sum, position) => sum + Math.abs(position.marketValue), 0) / allocationBase : 0]));
  async function save() {
    if (total !== 100) return onError("Allocation targets must total 100%.");
    setSaving(true); const response = await fetch("/api/allocations", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ portfolioId: dashboard.portfolio.id, targets: buckets.map((bucket) => ({ bucket, targetWeight: targets[bucket] / 100 })) }) });
    const payload = await response.json() as { error?: string }; setSaving(false); if (!response.ok) return onError(payload.error || "Unable to save allocation targets.");
    onNotice("Allocation targets updated."); await onRefresh();
  }
  return <section className="panel allocation-panel"><div className="panel-head"><div><span className="panel-title">Portfolio allocation</span><p>Set a complete 100% target and monitor current drift</p></div><span className={total === 100 ? "positive" : "negative"}>{total}% total</span></div><div className="allocation-editor"><div className="allocation-row header"><span>Bucket</span><span>Current</span><span>Target</span><span>Drift</span></div>{buckets.map((bucket) => { const target = targets[bucket] || 0, current = (actual[bucket] || 0) * 100, drift = current - target; return <div className="allocation-row" key={bucket}><strong>{bucket}</strong><span>{current.toFixed(1)}%</span><label><input aria-label={`${bucket} target`} type="number" min="0" max="100" value={target} onChange={(event) => setTargets((values) => ({ ...values, [bucket]: Number(event.target.value) }))}/><small>%</small></label><span className={Math.abs(drift) < 2 ? "positive" : "negative"}>{drift >= 0 ? "+" : ""}{drift.toFixed(1)}%</span></div>})}</div><div className="allocation-actions"><span>Targets guide decisions; they do not place rebalance trades.</span><button className="trade-button" disabled={saving || total !== 100} onClick={save}>{saving ? "Saving…" : "Save allocation"}</button></div></section>;
}

function SettingsPanel({ dashboard, onRefresh, onPortfolioRemoved, onNotice, onError }: { dashboard: Dashboard; onRefresh: () => Promise<void>; onPortfolioRemoved: () => Promise<void>; onNotice: (message: string) => void; onError: (message: string) => void }) {
  const [direction, setDirection] = useState<"deposit" | "withdrawal">("deposit"), [amount, setAmount] = useState(10000), [saving, setSaving] = useState(false);
  async function transfer() {
    setSaving(true); const response = await fetch("/api/cash", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ portfolioId: dashboard.portfolio.id, direction, amount }) });
    const payload = await response.json() as { error?: string }; setSaving(false); if (!response.ok) return onError(payload.error || "Unable to transfer cash.");
    onNotice(`${direction === "deposit" ? "Deposit" : "Withdrawal"} recorded in the cash ledger.`); await onRefresh();
  }
  async function remove(permanent: boolean) {
    const message = permanent ? `Permanently delete ${dashboard.portfolio.name} and all of its local ledger history? This cannot be undone.` : `Archive ${dashboard.portfolio.name}?`;
    if (!window.confirm(message)) return;
    const response = await fetch(permanent ? `/api/portfolios?portfolioId=${encodeURIComponent(dashboard.portfolio.id)}` : "/api/portfolios", { method: permanent ? "DELETE" : "PATCH", headers: { "content-type": "application/json" }, body: permanent ? undefined : JSON.stringify({ portfolioId: dashboard.portfolio.id }) });
    const payload = await response.json() as { error?: string }; if (!response.ok) return onError(payload.error || "Unable to update portfolio.");
    onNotice(permanent ? "Portfolio permanently deleted." : "Portfolio archived."); await onPortfolioRemoved();
  }
  return <div className="settings-grid"><section className="panel settings-card"><div className="panel-head"><div><span className="panel-title">Cash ledger</span><p>Deposits and withdrawals are immutable events</p></div></div><div className="settings-form"><label>Direction<select value={direction} onChange={(event) => setDirection(event.target.value as "deposit" | "withdrawal")}><option value="deposit">Deposit</option><option value="withdrawal">Withdraw</option></select></label><label>Amount<input type="number" min="0.01" step="100" value={amount} onChange={(event) => setAmount(Number(event.target.value))}/></label><button className="trade-button" disabled={saving || amount <= 0} onClick={transfer}>{saving ? "Recording…" : "Record transfer"}</button></div></section><section className="panel settings-card danger-zone"><div className="panel-head"><div><span className="panel-title">Portfolio lifecycle</span><p>Archive for safekeeping or permanently remove local records</p></div></div><div className="lifecycle-actions"><button className="secondary-button" onClick={() => remove(false)}>Archive portfolio</button><button className="delete-button" onClick={() => remove(true)}>Permanently delete</button></div></section></div>;
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
  const [assetClass, setAssetClass] = useState("Equity"), [symbol, setSymbol] = useState("NVDA"), [side, setSide] = useState<"buy" | "sell">("buy"), [orderType, setOrderType] = useState<"market" | "limit" | "stop" | "stop_limit">("market"), [quantity, setQuantity] = useState(100), [limitPrice, setLimitPrice] = useState(""), [stopPrice, setStopPrice] = useState(""), [quote, setQuote] = useState<Quote | null>(null), [submitting, setSubmitting] = useState(false);
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
    const response = await fetch("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ portfolioId: portfolio.id, symbol, assetClass: assetMap[assetClass], side, orderType, quantity, limitPrice: limitPrice ? Number(limitPrice) : undefined, stopPrice: stopPrice ? Number(stopPrice) : undefined, timeInForce: "day", optionContract, futureContract: selectedFuture, forwardContract }) });
    const payload = await response.json() as { status?: string; scheduledFor?: string; error?: string };
    setSubmitting(false); if (!response.ok) return onError(payload.error || "Order rejected.");
    await onComplete(payload.status === "scheduled" ? `Order queued for its next regular session: ${new Date(payload.scheduledFor || "").toLocaleString()}.` : payload.status === "filled" ? `Order filled. Positions, cash, and P&L have been recalculated.` : "Order accepted and is awaiting its trigger or price.");
  }
  return <div className="drawer-backdrop"><button className="drawer-dismiss" onClick={onClose} aria-label="Close trade ticket overlay"/><aside className="trade-drawer" aria-label="Trade ticket"><div className="drawer-head"><div><p className="eyebrow">{portfolio.name}</p><h2>New order</h2></div><button onClick={onClose} aria-label="Close trade ticket">×</button></div><div className="asset-tabs">{["Equity", "Crypto", "Futures", "Options", "Forward"].map((item) => <button key={item} className={assetClass === item ? "selected" : ""} onClick={() => { setAssetClass(item); setSymbol(item === "Crypto" ? "BTC-USD" : item === "Options" || item === "Forward" ? "SPY" : item === "Futures" ? "ESZ6" : "NVDA"); setQuantity(item === "Options" || item === "Futures" ? 1 : item === "Crypto" ? 0.1 : 100); setChain(null); setExpiration(""); setStrike(0); }}>{item}</button>)}</div><label>{["Options", "Forward"].includes(assetClass) ? "Underlying" : "Instrument"}{assetClass === "Options" || assetClass === "Forward" ? <select value={symbol} onChange={(event) => { setSymbol(event.target.value); setExpiration(""); setStrike(0); setDeliveryPrice(0); }}><option>SPY</option><option>QQQ</option><option>AAPL</option><option>MSFT</option><option>NVDA</option><option>TSLA</option><option>BTC-USD</option></select> : assetClass === "Futures" ? <select value={symbol} onChange={(event) => { const next = futureContracts.find((contract) => contract.symbol === event.target.value); setSymbol(event.target.value); if (next) setQuote(next.quote); }}>{futureContracts.map((contract) => <option key={contract.symbol} value={contract.symbol}>{contract.symbol} · {contract.name}</option>)}</select> : <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="Search instruments"/>}</label>{assetClass === "Options" && <div className="contract-grid"><label>Expiration<select value={expiration} onChange={(event) => setExpiration(event.target.value)}>{chain?.expirations.map((item) => <option key={item}>{item}</option>)}</select></label><label>Strike<select value={strike} onChange={(event) => setStrike(Number(event.target.value))}>{chain?.strikes.map((item) => <option key={item} value={item}>{money(item)}</option>)}</select></label><label>Right<select value={right} onChange={(event) => setRight(event.target.value as "call" | "put")}><option value="call">Call</option><option value="put">Put</option></select></label><label>Exercise<select value={exerciseStyle} onChange={(event) => setExerciseStyle(event.target.value as "american" | "european")}><option value="american">American</option><option value="european">European</option></select></label></div>}{assetClass === "Forward" && <div className="contract-grid"><label>Delivery date<input type="date" min={new Date().toISOString().slice(0, 10)} value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)}/></label><label>Delivery price<input type="number" min="0.01" step=".01" value={deliveryPrice || quote?.mark || ""} onChange={(event) => setDeliveryPrice(Number(event.target.value))}/></label></div>}{assetClass === "Futures" && selectedFuture && <div className="contract-summary"><span>Multiplier <strong>{selectedFuture.multiplier}×</strong></span><span>Initial margin <strong>{money(selectedFuture.initialMargin)}</strong></span><span>Settlement <strong>{selectedFuture.settlementType}</strong></span></div>}<div className="quote-strip"><span>Bid<strong>{quote?.bid ? money(Number(quote.bid)) : "—"}</strong></span><span>Ask<strong>{quote?.ask ? money(Number(quote.ask)) : "—"}</strong></span><span>Mark<strong>{quote ? money(Number(quote.mark)) : "—"}</strong></span><span>Quality<strong className="quality-text">{quote?.quality || "Unavailable"}</strong></span></div><div className="field-row"><label>Side<select value={side} onChange={(event) => setSide(event.target.value as "buy" | "sell")}><option value="buy">Buy</option><option value="sell">Sell</option></select></label><label>Order type<select value={orderType} onChange={(event) => setOrderType(event.target.value as "market" | "limit" | "stop" | "stop_limit")}><option value="market">Market</option><option value="limit">Limit</option><option value="stop">Stop</option><option value="stop_limit">Stop limit</option></select></label></div><div className="field-row"><label>Quantity<input type="number" min="0.000001" step={assetClass === "Crypto" ? ".001" : "1"} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))}/></label>{["limit", "stop_limit"].includes(orderType) ? <label>Limit price<input type="number" min="0.01" step=".01" value={limitPrice} onChange={(event) => setLimitPrice(event.target.value)}/></label> : <label>Time in force<select><option>Day</option></select></label>}{["stop", "stop_limit"].includes(orderType) && <label className="stop-field">Stop price<input type="number" min="0.01" step=".01" value={stopPrice} onChange={(event) => setStopPrice(event.target.value)}/></label>}</div><div className="estimate-card"><div><span>Reference notional</span><strong>{money(estimatedNotional)}</strong></div><div><span>Available buying power</span><strong>{money(dashboard.account.buyingPower)}</strong></div><div><span>Execution model</span><strong>{assetClass === "Options" ? "Indicative model + spread" : assetClass === "Forward" ? "Spot reference · zero rate" : "Bid/ask + size impact"}</strong></div><p><span className={`status-dot ${dashboard.session.isOpen || ["Crypto", "Forward", "Futures"].includes(assetClass) ? "" : "closed"}`}/>{["Equity", "Options"].includes(assetClass) && !dashboard.session.isOpen ? "This order will queue for the next regular session." : assetClass === "Futures" ? "CME session rules and first-notice safeguards apply." : "Eligible for current-session evaluation."}</p></div><button className="review-button" disabled={submitting || !quote || quantity <= 0 || (["limit", "stop_limit"].includes(orderType) && !limitPrice) || (["stop", "stop_limit"].includes(orderType) && !stopPrice)} onClick={submit}>{submitting ? "Checking buying power…" : "Submit order"}</button><p className="ticket-note">Zero commissions · Sufficient buying power required · Lifecycle events are automatic</p></aside></div>;
}
