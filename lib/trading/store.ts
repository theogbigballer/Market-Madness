import { ensureCoreSchema, getD1 } from "../../db/runtime";
import type { AssetClass, NormalizedQuote } from "../domain";
import { getUsEquitySession } from "../market/exchange-calendar";
import type { ForwardContract, FutureContract } from "../market/derivatives";
import { findFuture, forwardSymbol, getCmeSession, getForwardQuote, getFutureQuote } from "../market/derivatives";
import type { OptionContract } from "../market/options";
import { getOptionQuote, optionSymbol } from "../market/options";
import { estimateExecution, getMarketQuote } from "../market/quotes";
import type { OptionStrategyLeg } from "./strategies";
import { previewOptionStrategy } from "./strategies";
import { calculateFlowAdjustedPnl, calculatePortfolioOptionMargin, calculateRealizedPnl, netSignedQuantity, strategyLimitIsMarketable } from "./accounting";
import { evaluateAlertRules, listAlertRules } from "./alert-rules";
import { buildFillAudit, orderIsMarketable } from "./execution";
import { derivativeSettlementAmount, planOptionExpiry, requiresMarginLiquidation } from "./lifecycle";
import { formatMoney, multiplyMoney, sumMoney } from "./money";

type PortfolioRow = { id: string; name: string; starting_capital: string; benchmark_symbol: string | null; advanced_derivatives_enabled: number; theme: string; created_at: string };
type LotRow = { id: string; instrument_id: string; opening_fill_id: string; remaining_quantity: string; cost_basis: string; opened_at: string; symbol: string; display_name: string; asset_class: AssetClass; multiplier: string; underlying_instrument_id: string | null; expiration_at: string | null; first_notice_at: string | null; strike: string | null; option_right: "call" | "put" | null; exercise_style: "american" | "european" | null; settlement_type: "cash" | "physical" | null };

function recordFill(db: ReturnType<typeof getD1>, input: { id: string; orderId: string; portfolioId: string; instrumentId: string; quantity: number; price: number; slippage: number; model: string; executedAt: string; quote?: NormalizedQuote; context: string }) {
  const audit = buildFillAudit({ quote: input.quote, price: input.price, slippage: input.slippage, model: input.model, context: input.context });
  return db.prepare(`INSERT INTO fills (id, order_id, portfolio_id, instrument_id, quantity, price, slippage, liquidity_model, quote_provider, quote_quality, quote_observed_at, quote_bid, quote_ask, reference_price, execution_assumptions, executed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(input.id, input.orderId, input.portfolioId, input.instrumentId, input.quantity.toString(), input.price.toFixed(6), input.slippage.toFixed(6), input.model, audit.quoteProvider, audit.quoteQuality, audit.quoteObservedAt, audit.quoteBid, audit.quoteAsk, audit.referencePrice, audit.assumptions, input.executedAt);
}

export async function listPortfolios() {
  await ensureCoreSchema();
  const rows = await getD1().prepare("SELECT id, name, starting_capital, benchmark_symbol, advanced_derivatives_enabled, theme, created_at FROM portfolios WHERE status = 'active' ORDER BY created_at").all<PortfolioRow>();
  return rows.results.map((row) => ({ id: row.id, name: row.name, startingCapital: Number(row.starting_capital), advancedDerivativesEnabled: Boolean(row.advanced_derivatives_enabled), theme: row.theme }));
}

export async function createPortfolio(input: { name: string; startingCapital: number; advancedDerivativesEnabled?: boolean; theme?: string }) {
  await ensureCoreSchema();
  if (!input.name.trim()) throw new Error("Portfolio name is required.");
  if (!Number.isFinite(input.startingCapital) || input.startingCapital < 1000) throw new Error("Starting capital must be at least $1,000.");
  const id = crypto.randomUUID(), ledgerId = crypto.randomUUID(), now = new Date().toISOString();
  const db = getD1();
  await db.batch([
    db.prepare("INSERT INTO portfolios (id, name, starting_capital, benchmark_symbol, advanced_derivatives_enabled, theme, last_processed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, input.name.trim(), formatMoney(input.startingCapital), null, input.advancedDerivativesEnabled ? 1 : 0, input.theme || "dark", now, now, now),
    db.prepare("INSERT INTO cash_ledger (id, portfolio_id, event_type, amount, description, effective_at, idempotency_key) VALUES (?, ?, 'initial_capital', ?, ?, ?, ?)")
      .bind(ledgerId, id, formatMoney(input.startingCapital), "Initial portfolio capital", now, `portfolio:${id}:initial-capital`),
  ]);
  return { id };
}

export async function getBenchmarks(portfolioId: string) {
  await ensureCoreSchema();
  const result = await getD1().prepare("SELECT symbol FROM portfolio_benchmarks WHERE portfolio_id = ? ORDER BY created_at").bind(portfolioId).all<{ symbol: string }>();
  return Promise.all(result.results.map(async ({ symbol }) => ({ symbol, quote: await getMarketQuote(symbol, symbol.endsWith("-USD") ? "crypto" : "equity") })));
}

export async function setBenchmarks(portfolioId: string, symbolsInput: string[]) {
  await ensureCoreSchema();
  const symbols = [...new Set(symbolsInput.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].slice(0, 8);
  if (symbols.some((symbol) => !/^[A-Z0-9.^=-]{1,20}$/.test(symbol))) throw new Error("Benchmark tickers may contain only letters, numbers, dots, dashes, equals signs, or carets.");
  await Promise.all(symbols.map((symbol) => getMarketQuote(symbol, symbol.endsWith("-USD") ? "crypto" : "equity")));
  const db = getD1();
  const portfolio = await db.prepare("SELECT id FROM portfolios WHERE id = ? AND status = 'active'").bind(portfolioId).first();
  if (!portfolio) throw new Error("Portfolio not found.");
  await db.prepare("DELETE FROM portfolio_benchmarks WHERE portfolio_id = ?").bind(portfolioId).run();
  if (symbols.length) await db.batch(symbols.map((symbol) => db.prepare("INSERT INTO portfolio_benchmarks (id, portfolio_id, symbol) VALUES (?, ?, ?)").bind(crypto.randomUUID(), portfolioId, symbol)));
  return getBenchmarks(portfolioId);
}

export async function getAllocations(portfolioId: string) {
  await ensureCoreSchema();
  const result = await getD1().prepare("SELECT bucket, target_weight, minimum_weight, maximum_weight FROM allocations WHERE portfolio_id = ? ORDER BY bucket").bind(portfolioId).all<{ bucket: string; target_weight: string; minimum_weight: string | null; maximum_weight: string | null }>();
  return result.results.map((item) => ({ bucket: item.bucket, targetWeight: Number(item.target_weight), minimumWeight: item.minimum_weight === null ? null : Number(item.minimum_weight), maximumWeight: item.maximum_weight === null ? null : Number(item.maximum_weight) }));
}

export async function setAllocations(portfolioId: string, targets: { bucket: string; targetWeight: number }[]) {
  await ensureCoreSchema();
  const normalized = targets.map((item) => ({ bucket: item.bucket.toLowerCase(), targetWeight: Number(item.targetWeight) })).filter((item) => item.targetWeight > 0);
  const total = normalized.reduce((sum, item) => sum + item.targetWeight, 0);
  if (Math.abs(total - 1) > 0.001) throw new Error("Allocation targets must total 100%.");
  const db = getD1();
  await db.prepare("DELETE FROM allocations WHERE portfolio_id = ?").bind(portfolioId).run();
  if (normalized.length) await db.batch(normalized.map((item) => db.prepare("INSERT INTO allocations (id, portfolio_id, bucket, target_weight) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, item.bucket, item.targetWeight.toString())));
  return getAllocations(portfolioId);
}

export async function transferCash(portfolioId: string, direction: "deposit" | "withdrawal", amount: number) {
  await ensureCoreSchema();
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Transfer amount must be greater than zero.");
  const dashboard = await getDashboard(portfolioId) as { account: { cash: number; netLiquidationValue: number; maintenanceMargin: number } };
  if (direction === "withdrawal" && (amount > dashboard.account.cash || dashboard.account.netLiquidationValue - amount < dashboard.account.maintenanceMargin * 1.1)) throw new Error("Withdrawal would violate available cash or the 110% maintenance buffer.");
  const now = new Date().toISOString(), signedAmount = direction === "deposit" ? amount : -amount;
  await getD1().prepare("INSERT INTO cash_ledger (id, portfolio_id, event_type, amount, description, effective_at, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, direction, formatMoney(signedAmount), direction === "deposit" ? "Cash deposit" : "Cash withdrawal", now, `cash-transfer:${crypto.randomUUID()}`).run();
  return { direction, amount: signedAmount };
}

export async function archivePortfolio(portfolioId: string) {
  await ensureCoreSchema();
  const result = await getD1().prepare("UPDATE portfolios SET status = 'archived', updated_at = ? WHERE id = ? AND status = 'active'").bind(new Date().toISOString(), portfolioId).run();
  if (!result.meta.changes) throw new Error("Portfolio not found.");
  return { portfolioId, status: "archived" };
}

export async function permanentlyDeletePortfolio(portfolioId: string) {
  await ensureCoreSchema();
  const db = getD1();
  await db.batch([
    db.prepare("DELETE FROM alert_rules WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM alerts WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM performance_observations WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM portfolio_snapshots WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM portfolio_benchmarks WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM watchlist_items WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM allocations WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM processing_events WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM cash_ledger WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM lot_closures WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM position_lots WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM fills WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM order_legs WHERE order_id IN (SELECT id FROM orders WHERE portfolio_id = ?)").bind(portfolioId),
    db.prepare("DELETE FROM orders WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM portfolios WHERE id = ?").bind(portfolioId),
  ]);
  return { portfolioId, status: "deleted" };
}

async function cashBalance(portfolioId: string) {
  const result = await getD1().prepare("SELECT amount FROM cash_ledger WHERE portfolio_id = ?").bind(portfolioId).all<{ amount: string }>();
  return Number(sumMoney(result.results.map((row) => row.amount)));
}

async function externalCashFlows(portfolioId: string) {
  const result = await getD1().prepare("SELECT amount FROM cash_ledger WHERE portfolio_id = ? AND event_type IN ('deposit', 'withdrawal', 'transfer')").bind(portfolioId).all<{ amount: string }>();
  return Number(sumMoney(result.results.map((row) => row.amount)));
}

function newYorkDayStart(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localNoonUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), 12);
  const zonedNoon = new Date(new Date(localNoonUtc).toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offset = localNoonUtc - zonedNoon.getTime();
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)) + offset).toISOString();
}

async function recordPerformanceObservations(portfolioId: string, portfolioIndexValue: number, benchmarks: { symbol: string; quote: { mark: string; quality: string } }[]) {
  const db = getD1(), bucket = new Date(Math.floor(Date.now() / 30_000) * 30_000).toISOString();
  const rows = [{ key: "PORTFOLIO", value: portfolioIndexValue, quality: "ledger" }, ...benchmarks.map((benchmark) => ({ key: benchmark.symbol, value: Number(benchmark.quote.mark), quality: benchmark.quote.quality }))];
  await db.batch(rows.map((row) => db.prepare("INSERT OR IGNORE INTO performance_observations (id, portfolio_id, series_key, value, quality, observed_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, row.key, row.value.toFixed(6), row.quality, bucket)));
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare("DELETE FROM performance_observations WHERE portfolio_id = ? AND observed_at < ?").bind(portfolioId, cutoff).run();
}

async function getPerformanceSeries(portfolioId: string, selectedSymbols: string[]) {
  const keys = ["PORTFOLIO", ...selectedSymbols], placeholders = keys.map(() => "?").join(",");
  const result = await getD1().prepare(`SELECT series_key, value, quality, observed_at FROM performance_observations WHERE portfolio_id = ? AND observed_at >= ? AND series_key IN (${placeholders}) ORDER BY observed_at`).bind(portfolioId, newYorkDayStart(), ...keys).all<{ series_key: string; value: string; quality: string; observed_at: string }>();
  return keys.map((key) => {
    const rows = result.results.filter((row) => row.series_key === key), baseline = Number(rows[0]?.value || 0);
    const points = rows.map((row) => ({ at: row.observed_at, value: Number(row.value), return: baseline ? Number(row.value) / baseline - 1 : 0 }));
    return { key, label: key === "PORTFOLIO" ? "Portfolio" : key, quality: rows.at(-1)?.quality || "pending", return: points.at(-1)?.return || 0, points };
  });
}

async function getLedgerReport(portfolioId: string, realizedPnl: number) {
  const db = getD1();
  const [transactions, totals] = await Promise.all([
    db.prepare("SELECT id, event_type, amount, description, effective_at FROM cash_ledger WHERE portfolio_id = ? ORDER BY effective_at DESC, created_at DESC LIMIT 100").bind(portfolioId).all<{ id: string; event_type: string; amount: string; description: string; effective_at: string }>(),
    db.prepare("SELECT event_type, amount FROM cash_ledger WHERE portfolio_id = ?").bind(portfolioId).all<{ event_type: string; amount: string }>(),
  ]);
  const grouped = totals.results.reduce<Record<string, string[]>>((groups, row) => { (groups[row.event_type] ||= []).push(row.amount); return groups; }, {});
  const byType = Object.fromEntries(Object.entries(grouped).map(([eventType, amounts]) => [eventType, Number(sumMoney(amounts))]));
  const dividends = byType.dividend || 0, settlements = byType.settlement || 0, externalFlows = (byType.deposit || 0) + (byType.withdrawal || 0) + (byType.transfer || 0);
  return {
    transactions: transactions.results.map((row) => ({ id: row.id, eventType: row.event_type, amount: Number(row.amount), description: row.description, effectiveAt: row.effective_at })),
    attribution: { trading: realizedPnl - dividends - settlements, dividends, settlements, externalFlows },
  };
}

async function getClosureReport(portfolioId: string) {
  const result = await getD1().prepare(`SELECT lc.id, lc.quantity, lc.entry_price, lc.exit_price, lc.multiplier, lc.realized_pnl,
      lc.closure_reason, lc.basis_transferred, lc.closed_at, i.symbol, i.display_name, i.asset_class,
      f.order_id, COALESCE((SELECT COUNT(*) FROM order_legs ol WHERE ol.order_id = f.order_id), 0) AS strategy_leg_count
    FROM lot_closures lc JOIN instruments i ON i.id = lc.instrument_id
    LEFT JOIN fills f ON f.id = lc.closing_fill_id
    WHERE lc.portfolio_id = ? ORDER BY lc.closed_at DESC, lc.created_at DESC LIMIT 500`)
    .bind(portfolioId).all<{ id: string; quantity: string; entry_price: string; exit_price: string; multiplier: string; realized_pnl: string; closure_reason: string; basis_transferred: number; closed_at: string; symbol: string; display_name: string; asset_class: string; order_id: string | null; strategy_leg_count: number }>();
  const trades = result.results.map((row) => ({ id: row.id, symbol: row.symbol, name: row.display_name, assetClass: row.asset_class, quantity: Number(row.quantity), entryPrice: Number(row.entry_price), exitPrice: Number(row.exit_price), multiplier: Number(row.multiplier), realizedPnl: Number(row.realized_pnl), reason: row.closure_reason, basisTransferred: Boolean(row.basis_transferred), closedAt: row.closed_at, orderId: row.order_id, strategyLegCount: Number(row.strategy_leg_count) }));
  const additive = (key: "assetClass" | "symbol") => Object.values(trades.reduce<Record<string, { key: string; realizedPnl: number; closures: number }>>((groups, trade) => {
    const value = trade[key]; groups[value] ||= { key: value, realizedPnl: 0, closures: 0 }; groups[value].realizedPnl += trade.realizedPnl; groups[value].closures += 1; return groups;
  }, {})).sort((left, right) => Math.abs(right.realizedPnl) - Math.abs(left.realizedPnl));
  const settled = trades.filter((trade) => !trade.basisTransferred), winners = settled.filter((trade) => trade.realizedPnl > 0).length, losers = settled.filter((trade) => trade.realizedPnl < 0).length;
  return { trades, byAssetClass: additive("assetClass"), byInstrument: additive("symbol"), summary: { realizedPnl: settled.reduce((sum, trade) => sum + trade.realizedPnl, 0), winners, losers, winRate: winners + losers ? winners / (winners + losers) : 0 } };
}

async function openLots(portfolioId: string) {
  const result = await getD1().prepare(`SELECT l.id, l.instrument_id, l.opening_fill_id, l.remaining_quantity, l.cost_basis, l.opened_at,
      i.symbol, i.display_name, i.asset_class, i.multiplier, i.underlying_instrument_id, i.expiration_at, i.first_notice_at, i.strike, i.option_right, i.exercise_style, i.settlement_type
    FROM position_lots l JOIN instruments i ON i.id = l.instrument_id
    WHERE l.portfolio_id = ? AND CAST(l.remaining_quantity AS REAL) != 0 ORDER BY l.opened_at`)
    .bind(portfolioId).all<LotRow>();
  return result.results;
}

function recordLotClosure(db: ReturnType<typeof getD1>, input: {
  portfolioId: string; lot: Pick<LotRow, "id" | "instrument_id" | "remaining_quantity" | "cost_basis">;
  closingFillId?: string; quantity: number; exitPrice: number; multiplier: number;
  reason: "trade" | "strategy" | "forced_liquidation" | "settlement" | "expiration" | "exercise" | "assignment";
  closedAt: string; basisTransferred?: boolean;
}) {
  const realizedPnl = input.basisTransferred ? 0 : calculateRealizedPnl({ entryPrice: Number(input.lot.cost_basis), exitPrice: input.exitPrice, signedOpenQuantity: Number(input.lot.remaining_quantity), closedQuantity: input.quantity, multiplier: input.multiplier });
  return db.prepare(`INSERT INTO lot_closures (id, portfolio_id, instrument_id, opening_lot_id, closing_fill_id, quantity, entry_price, exit_price, multiplier, realized_pnl, closure_reason, basis_transferred, closed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), input.portfolioId, input.lot.instrument_id, input.lot.id, input.closingFillId || null, input.quantity.toString(), Number(input.lot.cost_basis).toFixed(6), input.exitPrice.toFixed(6), input.multiplier.toString(), realizedPnl.toFixed(6), input.reason, input.basisTransferred ? 1 : 0, input.closedAt);
}

function netDeliveredUnderlying(db: ReturnType<typeof getD1>, input: {
  portfolioId: string; instrumentId: string; fillId: string; signedQuantity: number; basis: number; strike: number;
  reason: "exercise" | "assignment"; closedAt: string; lots: LotRow[];
}) {
  const statements = [];
  const netting = netSignedQuantity(input.signedQuantity, input.lots.filter((lot) => lot.instrument_id === input.instrumentId).map((lot) => ({ lot, quantity: Number(lot.remaining_quantity) })));
  for (const closure of netting.closures) {
    statements.push(recordLotClosure(db, { portfolioId: input.portfolioId, lot: closure.lot.lot, closingFillId: input.fillId, quantity: closure.quantity, exitPrice: input.strike, multiplier: 1, reason: input.reason, closedAt: input.closedAt }));
    statements.push(db.prepare("UPDATE position_lots SET remaining_quantity = ?, closed_at = ? WHERE id = ?").bind(closure.nextQuantity.toString(), Math.abs(closure.nextQuantity) < 1e-9 ? input.closedAt : null, closure.lot.lot.id));
  }
  if (Math.abs(netting.remaining) > 1e-9) statements.push(db.prepare("INSERT INTO position_lots (id, portfolio_id, instrument_id, opening_fill_id, original_quantity, remaining_quantity, cost_basis, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), input.portfolioId, input.instrumentId, input.fillId, netting.remaining.toString(), netting.remaining.toString(), formatMoney(input.basis), input.closedAt));
  return statements;
}

type ActiveOrderRow = { id: string; instrument_id: string; side: "buy" | "sell"; order_type: "market" | "limit" | "stop" | "stop_limit"; time_in_force: "day" | "gtc"; quantity: string; limit_price: string | null; stop_price: string | null; symbol: string; display_name: string; asset_class: AssetClass; multiplier: string; underlying_instrument_id: string | null; expiration_at: string | null; first_notice_at: string | null; strike: string | null; option_right: "call" | "put" | null; exercise_style: "american" | "european" | null; settlement_type: "cash" | "physical" | null };

async function quoteForInstrument(order: ActiveOrderRow) {
  if (order.asset_class === "option" && order.expiration_at && order.strike && order.option_right && order.exercise_style) {
    return getOptionQuote({ underlying: (order.underlying_instrument_id || "equity:SPY").replace("equity:", ""), expiration: order.expiration_at.slice(0, 10), strike: Number(order.strike), right: order.option_right, exerciseStyle: order.exercise_style });
  }
  if (order.asset_class === "future") {
    const contract = findFuture(order.symbol);
    if (contract) return getFutureQuote(contract);
  }
  if (order.asset_class === "forward" && order.expiration_at && order.strike && order.underlying_instrument_id) return getForwardQuote({ underlying: order.underlying_instrument_id.replace(/^(equity|crypto):/, ""), deliveryDate: order.expiration_at.slice(0, 10), deliveryPrice: Number(order.strike), quantityUnit: "units" });
  return getMarketQuote(order.symbol, order.asset_class);
}

async function reservedBuyingPower(portfolioId: string) {
  const result = await getD1().prepare(`SELECT o.id, o.instrument_id, o.side, o.order_type, o.time_in_force, o.quantity, o.limit_price, o.stop_price,
      i.symbol, i.display_name, i.asset_class, i.multiplier, i.underlying_instrument_id, i.expiration_at, i.first_notice_at, i.strike, i.option_right, i.exercise_style, i.settlement_type
    FROM orders o JOIN instruments i ON i.id = o.instrument_id
    WHERE o.portfolio_id = ? AND o.status IN ('scheduled', 'accepted', 'submitted')
      AND NOT EXISTS (SELECT 1 FROM order_legs ol WHERE ol.order_id = o.id)`).bind(portfolioId).all<ActiveOrderRow>();
  let reserved = 0;
  for (const order of result.results) {
    const quote = await quoteForInstrument(order), quantity = Number(order.quantity), multiplier = Number(order.multiplier);
    if (order.asset_class === "option" && order.side === "sell" && order.underlying_instrument_id) {
      if (order.option_right === "put") reserved += Number(order.strike) * quantity * 100;
      else {
        const underlying = await getMarketQuote(order.underlying_instrument_id.replace("equity:", ""), "equity");
        reserved += Number(underlying.mark) * quantity * 100 * 0.2;
      }
    } else if (order.asset_class === "future") reserved += quantity * (findFuture(order.symbol)?.initialMargin || Number(quote.mark) * multiplier * 0.1);
    else if (order.asset_class === "forward") reserved += Number(quote.mark) * quantity * 0.1;
    else reserved += Number(order.limit_price || quote.ask || quote.mark) * quantity * multiplier;
  }
  const strategies = await getD1().prepare("SELECT id, quantity, side, order_type, limit_price FROM orders WHERE portfolio_id = ? AND status IN ('scheduled', 'accepted', 'submitted') AND EXISTS (SELECT 1 FROM order_legs ol WHERE ol.order_id = orders.id)").bind(portfolioId).all<{ id: string; quantity: string; side: "buy" | "sell"; order_type: "market" | "limit"; limit_price: string | null }>();
  for (const strategy of strategies.results) {
    const legs = await strategyLegs(strategy.id);
    const preview = await previewOptionStrategy(legs, Number(strategy.quantity));
    const worstNetDebit = strategy.order_type === "limit" ? (strategy.side === "buy" ? 1 : -1) * Number(strategy.limit_price) * 100 * Number(strategy.quantity) : preview.netDebit;
    const adversePremium = Math.max(0, worstNetDebit - preview.netDebit);
    reserved += preview.maxLoss === null ? Math.max(0, preview.netDebit) + Number(preview.legs[0].analytics.spot) * 100 * Number(strategy.quantity) * 0.2 + adversePremium : preview.maxLoss + adversePremium;
  }
  return reserved;
}

async function strategyLegs(orderId: string): Promise<OptionStrategyLeg[]> {
  const result = await getD1().prepare(`SELECT ol.side, ol.ratio_quantity, i.underlying_instrument_id, i.expiration_at, i.strike, i.option_right, i.exercise_style
    FROM order_legs ol JOIN instruments i ON i.id = ol.instrument_id WHERE ol.order_id = ? ORDER BY ol.id`).bind(orderId)
    .all<{ side: "buy" | "sell"; ratio_quantity: string; underlying_instrument_id: string; expiration_at: string; strike: string; option_right: "call" | "put"; exercise_style: "american" | "european" }>();
  return result.results.map((leg) => ({ side: leg.side, ratio: Number(leg.ratio_quantity), contract: { underlying: leg.underlying_instrument_id.replace("equity:", ""), expiration: leg.expiration_at.slice(0, 10), strike: Number(leg.strike), right: leg.option_right, exerciseStyle: leg.exercise_style } }));
}

async function executeOptionStrategyOrder(portfolioId: string, orderId: string) {
  if (!getUsEquitySession().isOpen) return false;
  const db = getD1(), order = await db.prepare("SELECT id, quantity, status, side, order_type, limit_price FROM orders WHERE id = ? AND portfolio_id = ? AND status IN ('scheduled', 'accepted')").bind(orderId, portfolioId).first<{ id: string; quantity: string; status: string; side: "buy" | "sell"; order_type: "market" | "limit"; limit_price: string | null }>();
  if (!order) return false;
  const legs = await strategyLegs(orderId), preview = await previewOptionStrategy(legs, Number(order.quantity));
  const marketable = order.order_type === "market" || strategyLimitIsMarketable(order.side, preview.netPrice, Number(order.limit_price));
  if (!marketable) {
    await db.prepare("UPDATE orders SET status = 'accepted', scheduled_for = NULL, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), orderId).run();
    return false;
  }
  const currentLots = await openLots(portfolioId), now = new Date().toISOString(), statements = [
    db.prepare("UPDATE orders SET status = 'filled', filled_quantity = quantity, scheduled_for = NULL, updated_at = ? WHERE id = ?").bind(now, orderId),
  ];
  const legCashAmounts: string[] = [];
  for (const leg of preview.legs) {
    const instrumentId = `option:${leg.symbol}`, quantity = leg.ratio * preview.units, signedQuantity = leg.side === "buy" ? quantity : -quantity, fillId = crypto.randomUUID();
    statements.push(recordFill(db, { id: fillId, orderId, portfolioId, instrumentId, quantity, price: leg.executionPrice, slippage: 0, model: "atomic multi-leg option execution", executedAt: now, quote: { instrumentId, provider: leg.provider, quality: leg.quality, observedAt: leg.observedAt, bid: leg.bid.toString(), ask: leg.ask.toString(), mark: leg.mark.toString(), last: leg.mark.toString() }, context: "option_strategy" }));
    let remaining = signedQuantity;
    for (const lot of currentLots.filter((item) => item.instrument_id === instrumentId && Number(item.remaining_quantity) * signedQuantity < 0)) {
      if (Math.abs(remaining) < 1e-9) break;
      const lotQuantity = Number(lot.remaining_quantity), closed = Math.min(Math.abs(remaining), Math.abs(lotQuantity));
      const next = lotQuantity + Math.sign(remaining) * closed;
      remaining -= Math.sign(remaining) * closed;
      statements.push(recordLotClosure(db, { portfolioId, lot, closingFillId: fillId, quantity: closed, exitPrice: leg.executionPrice, multiplier: 100, reason: "strategy", closedAt: now }));
      lot.remaining_quantity = next.toString();
      statements.push(db.prepare("UPDATE position_lots SET remaining_quantity = ?, closed_at = ? WHERE id = ?").bind(next.toString(), Math.abs(next) < 1e-9 ? now : null, lot.id));
    }
    if (Math.abs(remaining) > 1e-9) statements.push(db.prepare("INSERT INTO position_lots (id, portfolio_id, instrument_id, opening_fill_id, original_quantity, remaining_quantity, cost_basis, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, instrumentId, fillId, remaining.toString(), remaining.toString(), formatMoney(leg.executionPrice), now));
    legCashAmounts.push(multiplyMoney(leg.side === "buy" ? -1 : 1, leg.executionPrice, quantity, 100));
  }
  statements.push(db.prepare("INSERT INTO cash_ledger (id, portfolio_id, event_type, amount, related_entity_type, related_entity_id, description, effective_at, idempotency_key) VALUES (?, ?, 'trade', ?, 'order', ?, ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, sumMoney(legCashAmounts), orderId, `${preview.legs.length}-leg ${preview.underlying} option strategy`, now, `strategy-fill:${orderId}`));
  await db.batch(statements);
  return true;
}

async function processOptionStrategyOrders(portfolioId: string) {
  if (!getUsEquitySession().isOpen) return;
  const now = new Date().toISOString();
  const result = await getD1().prepare("SELECT id FROM orders WHERE portfolio_id = ? AND (status = 'accepted' OR (status = 'scheduled' AND scheduled_for <= ?)) AND EXISTS (SELECT 1 FROM order_legs ol WHERE ol.order_id = orders.id) ORDER BY created_at").bind(portfolioId, now).all<{ id: string }>();
  for (const order of result.results) await executeOptionStrategyOrder(portfolioId, order.id);
}

async function processActiveOrders(portfolioId: string) {
  const equitySession = getUsEquitySession(), cmeSession = getCmeSession(), now = new Date().toISOString(), db = getD1();
  const result = await db.prepare(`SELECT o.id, o.instrument_id, o.side, o.order_type, o.time_in_force, o.quantity, o.limit_price, o.stop_price,
      i.symbol, i.display_name, i.asset_class, i.multiplier, i.underlying_instrument_id, i.expiration_at, i.strike, i.option_right, i.exercise_style
    FROM orders o JOIN instruments i ON i.id = o.instrument_id
    WHERE o.portfolio_id = ? AND (o.status = 'accepted' OR (o.status = 'scheduled' AND o.scheduled_for <= ?))
      AND NOT EXISTS (SELECT 1 FROM order_legs ol WHERE ol.order_id = o.id) ORDER BY o.created_at`)
    .bind(portfolioId, now).all<ActiveOrderRow>();
  for (const order of result.results) {
    if ((order.asset_class === "equity" || order.asset_class === "option") && !equitySession.isOpen) continue;
    if (order.asset_class === "future" && !cmeSession.isOpen) continue;
    const quote = await quoteForInstrument(order), execution = estimateExecution(quote, order.side, Number(order.quantity));
    const marketable = orderIsMarketable({ side: order.side, orderType: order.order_type, mark: Number(quote.mark), estimatedPrice: execution.price, limitPrice: order.limit_price ? Number(order.limit_price) : null, stopPrice: order.stop_price ? Number(order.stop_price) : null });
    if (!marketable) {
      await db.prepare("UPDATE orders SET status = 'accepted', scheduled_for = NULL, updated_at = ? WHERE id = ?").bind(now, order.id).run();
      continue;
    }
    const fillId = crypto.randomUUID(), quantity = Number(order.quantity), signedQuantity = order.side === "buy" ? quantity : -quantity;
    const lots = await openLots(portfolioId), statements = [
      db.prepare("UPDATE orders SET status = 'filled', filled_quantity = quantity, scheduled_for = NULL, updated_at = ? WHERE id = ?").bind(now, order.id),
      recordFill(db, { id: fillId, orderId: order.id, portfolioId, instrumentId: order.instrument_id, quantity, price: execution.price, slippage: execution.slippage, model: `${execution.model} · queued evaluation`, executedAt: now, quote, context: "queued_order_evaluation" }),
    ];
    let remaining = signedQuantity;
    const realizedDerivativeAmounts: string[] = [];
    for (const lot of lots.filter((item) => item.instrument_id === order.instrument_id && Number(item.remaining_quantity) * signedQuantity < 0)) {
      if (Math.abs(remaining) < 1e-9) break;
      const lotQuantity = Number(lot.remaining_quantity), closed = Math.min(Math.abs(remaining), Math.abs(lotQuantity));
      if (order.asset_class === "future" || order.asset_class === "forward") realizedDerivativeAmounts.push(formatMoney(calculateRealizedPnl({ entryPrice: Number(lot.cost_basis), exitPrice: execution.price, signedOpenQuantity: lotQuantity, closedQuantity: closed, multiplier: Number(order.multiplier) })));
      const nextLotQuantity = lotQuantity + Math.sign(remaining) * closed;
      remaining -= Math.sign(remaining) * closed;
      statements.push(recordLotClosure(db, { portfolioId, lot, closingFillId: fillId, quantity: closed, exitPrice: execution.price, multiplier: Number(order.multiplier), reason: "trade", closedAt: now }));
      statements.push(db.prepare("UPDATE position_lots SET remaining_quantity = ?, closed_at = ? WHERE id = ?").bind(nextLotQuantity.toString(), Math.abs(nextLotQuantity) < 1e-9 ? now : null, lot.id));
    }
    if (Math.abs(remaining) > 1e-9) statements.push(db.prepare("INSERT INTO position_lots (id, portfolio_id, instrument_id, opening_fill_id, original_quantity, remaining_quantity, cost_basis, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, order.instrument_id, fillId, remaining.toString(), remaining.toString(), formatMoney(execution.price), now));
    const cashChange = order.asset_class === "future" || order.asset_class === "forward" ? sumMoney(realizedDerivativeAmounts) : multiplyMoney(order.side === "buy" ? -1 : 1, execution.price, quantity, Number(order.multiplier));
    statements.push(db.prepare("INSERT INTO cash_ledger (id, portfolio_id, event_type, amount, related_entity_type, related_entity_id, description, effective_at, idempotency_key) VALUES (?, ?, 'trade', ?, 'fill', ?, ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, cashChange, fillId, `${order.side.toUpperCase()} ${quantity} ${order.symbol} · queued fill`, now, `fill:${fillId}`));
    await db.batch(statements);
  }
}

export async function cancelOrder(portfolioId: string, orderId: string) {
  await ensureCoreSchema();
  const result = await getD1().prepare("UPDATE orders SET status = 'canceled', scheduled_for = NULL, updated_at = ? WHERE id = ? AND portfolio_id = ? AND status IN ('scheduled', 'accepted', 'submitted')").bind(new Date().toISOString(), orderId, portfolioId).run();
  if (!result.meta.changes) throw new Error("Only active or queued orders can be canceled.");
  return { orderId, status: "canceled" };
}

export async function replaceOrderPrice(portfolioId: string, orderId: string, limitPrice?: number, stopPrice?: number) {
  await ensureCoreSchema();
  const order = await getD1().prepare("SELECT order_type FROM orders WHERE id = ? AND portfolio_id = ? AND status IN ('submitted', 'scheduled', 'accepted')").bind(orderId, portfolioId).first<{ order_type: string }>();
  if (!order) throw new Error("Only active orders can be replaced.");
  if (["limit", "stop_limit"].includes(order.order_type) && (!Number.isFinite(limitPrice) || Number(limitPrice) <= 0)) throw new Error("Enter a positive limit price.");
  if (["stop", "stop_limit"].includes(order.order_type) && (!Number.isFinite(stopPrice) || Number(stopPrice) <= 0)) throw new Error("Enter a positive stop price.");
  await getD1().prepare("UPDATE orders SET limit_price = ?, stop_price = ?, updated_at = ? WHERE id = ? AND portfolio_id = ?")
    .bind(["limit", "stop_limit"].includes(order.order_type) ? Number(limitPrice).toFixed(6) : null, ["stop", "stop_limit"].includes(order.order_type) ? Number(stopPrice).toFixed(6) : null, new Date().toISOString(), orderId, portfolioId).run();
  return { id: orderId, status: "replaced" };
}

type CorporateActionRow = { id: string; instrument_id: string; symbol: string; action_type: "cash_dividend" | "split"; effective_at: string; ratio: string | null; cash_amount: string | null; status: "scheduled" | "applied" | "canceled"; source: string; notes: string | null; created_at: string };

export async function listCorporateActions() {
  await ensureCoreSchema();
  const result = await getD1().prepare("SELECT id, instrument_id, symbol, action_type, effective_at, ratio, cash_amount, status, source, notes, created_at FROM corporate_actions ORDER BY effective_at DESC LIMIT 50").all<CorporateActionRow>();
  return result.results.map((action) => ({ id: action.id, symbol: action.symbol, actionType: action.action_type, effectiveAt: action.effective_at, ratio: action.ratio === null ? null : Number(action.ratio), cashAmount: action.cash_amount === null ? null : Number(action.cash_amount), status: action.status, source: action.source, notes: action.notes }));
}

export async function scheduleCorporateAction(input: { symbol: string; actionType: "cash_dividend" | "split"; effectiveDate: string; ratio?: number; cashAmount?: number; notes?: string }) {
  await ensureCoreSchema();
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) throw new Error("A symbol and effective date are required.");
  if (input.actionType === "split" && (!Number.isFinite(input.ratio) || Number(input.ratio) <= 0)) throw new Error("A split requires a positive adjustment ratio.");
  if (input.actionType === "cash_dividend" && (!Number.isFinite(input.cashAmount) || Number(input.cashAmount) <= 0)) throw new Error("A cash dividend requires a positive per-share amount.");
  const instrumentId = `equity:${symbol}`, quote = await getMarketQuote(symbol, "equity"), id = crypto.randomUUID(), now = new Date().toISOString(), effectiveAt = `${input.effectiveDate}T13:30:00.000Z`, db = getD1();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO instruments (id, symbol, display_name, asset_class, exchange, calendar_id) VALUES (?, ?, ?, 'equity', 'US', 'XNYS')").bind(instrumentId, symbol, quote.name),
    db.prepare("INSERT INTO corporate_actions (id, instrument_id, symbol, action_type, effective_at, ratio, cash_amount, source, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual_simulation', ?, ?, ?)").bind(id, instrumentId, symbol, input.actionType, effectiveAt, input.ratio?.toString() ?? null, input.cashAmount?.toString() ?? null, input.notes?.trim() || null, now, now),
  ]);
  return { id, status: "scheduled", effectiveAt };
}

export async function cancelCorporateAction(actionId: string) {
  await ensureCoreSchema();
  const result = await getD1().prepare("UPDATE corporate_actions SET status = 'canceled', updated_at = ? WHERE id = ? AND status = 'scheduled' AND effective_at > ?").bind(new Date().toISOString(), actionId, new Date().toISOString()).run();
  if (!result.meta.changes) throw new Error("Only future scheduled actions can be canceled.");
  return { id: actionId, status: "canceled" };
}

async function processCorporateActions() {
  const db = getD1(), now = new Date().toISOString();
  const actions = await db.prepare("SELECT id, instrument_id, symbol, action_type, effective_at, ratio, cash_amount, status, source, notes, created_at FROM corporate_actions WHERE status = 'scheduled' AND effective_at <= ? ORDER BY effective_at").bind(now).all<CorporateActionRow>();
  for (const action of actions.results) {
    const holders = await db.prepare("SELECT portfolio_id, SUM(CAST(remaining_quantity AS REAL)) AS quantity FROM position_lots WHERE instrument_id = ? AND CAST(remaining_quantity AS REAL) != 0 GROUP BY portfolio_id").bind(action.instrument_id).all<{ portfolio_id: string; quantity: number }>();
    const statements = [];
    if (action.action_type === "cash_dividend") {
      const amount = Number(action.cash_amount);
      for (const holder of holders.results) {
        const cash = multiplyMoney(holder.quantity, action.cash_amount || "0");
        statements.push(
          db.prepare("INSERT OR IGNORE INTO cash_ledger (id, portfolio_id, event_type, amount, related_entity_type, related_entity_id, description, effective_at, idempotency_key) VALUES (?, ?, 'dividend', ?, 'corporate_action', ?, ?, ?, ?)").bind(crypto.randomUUID(), holder.portfolio_id, cash, action.id, `${action.symbol} cash dividend · ${amount.toFixed(4)} per share`, action.effective_at, `corporate-action:${action.id}:${holder.portfolio_id}:cash`),
          db.prepare("INSERT INTO alerts (id, portfolio_id, severity, event_type, title, message) VALUES (?, ?, 'info', 'corporate_action', 'Cash dividend processed', ?)").bind(crypto.randomUUID(), holder.portfolio_id, `${action.symbol} posted ${cash} to the cash ledger.`),
          db.prepare("INSERT OR IGNORE INTO processing_events (id, portfolio_id, event_type, effective_at, status, payload, idempotency_key) VALUES (?, ?, 'corporate_action', ?, 'completed', ?, ?)").bind(crypto.randomUUID(), holder.portfolio_id, action.effective_at, JSON.stringify({ actionId: action.id, type: action.action_type, cash }), `corporate-action:${action.id}:${holder.portfolio_id}:event`),
        );
      }
    } else {
      const ratio = Number(action.ratio);
      statements.push(
        db.prepare("UPDATE position_lots SET remaining_quantity = CAST(CAST(remaining_quantity AS REAL) * ? AS TEXT), original_quantity = CAST(CAST(original_quantity AS REAL) * ? AS TEXT), cost_basis = CAST(CAST(cost_basis AS REAL) / ? AS TEXT) WHERE instrument_id = ? AND CAST(remaining_quantity AS REAL) != 0").bind(ratio, ratio, ratio, action.instrument_id),
        db.prepare("UPDATE position_lots SET remaining_quantity = CAST(CAST(remaining_quantity AS REAL) * ? AS TEXT), original_quantity = CAST(CAST(original_quantity AS REAL) * ? AS TEXT), cost_basis = CAST(CAST(cost_basis AS REAL) / ? AS TEXT) WHERE instrument_id IN (SELECT id FROM instruments WHERE underlying_instrument_id = ? AND asset_class = 'option') AND CAST(remaining_quantity AS REAL) != 0").bind(ratio, ratio, ratio, action.instrument_id),
        db.prepare("UPDATE instruments SET strike = CAST(CAST(strike AS REAL) / ? AS TEXT), updated_at = ? WHERE underlying_instrument_id = ? AND asset_class = 'option'").bind(ratio, now, action.instrument_id),
      );
      for (const holder of holders.results) statements.push(
        db.prepare("INSERT INTO alerts (id, portfolio_id, severity, event_type, title, message) VALUES (?, ?, 'warning', 'corporate_action', 'Split adjustment processed', ?)").bind(crypto.randomUUID(), holder.portfolio_id, `${action.symbol} positions and linked option contracts were adjusted ${ratio}:1.`),
        db.prepare("INSERT OR IGNORE INTO processing_events (id, portfolio_id, event_type, effective_at, status, payload, idempotency_key) VALUES (?, ?, 'corporate_action', ?, 'completed', ?, ?)").bind(crypto.randomUUID(), holder.portfolio_id, action.effective_at, JSON.stringify({ actionId: action.id, type: action.action_type, ratio }), `corporate-action:${action.id}:${holder.portfolio_id}:event`),
      );
    }
    statements.push(db.prepare("UPDATE corporate_actions SET status = 'applied', updated_at = ? WHERE id = ? AND status = 'scheduled'").bind(now, action.id));
    await db.batch(statements);
  }
}

async function processAmericanEarlyAssignments(portfolioId: string) {
  const db = getD1(), now = new Date(), from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), through = new Date(now.getTime() + 36 * 60 * 60 * 1000).toISOString();
  const candidates = await db.prepare(`SELECT l.id, l.instrument_id, l.remaining_quantity, l.cost_basis, i.symbol, i.underlying_instrument_id, i.expiration_at, i.strike, i.option_right, i.exercise_style,
      ca.id AS action_id, ca.cash_amount, ca.effective_at
    FROM position_lots l JOIN instruments i ON i.id = l.instrument_id
    JOIN corporate_actions ca ON ca.instrument_id = i.underlying_instrument_id AND ca.action_type = 'cash_dividend' AND ca.status = 'scheduled'
    WHERE l.portfolio_id = ? AND i.asset_class = 'option' AND i.exercise_style = 'american' AND i.option_right = 'call'
      AND CAST(l.remaining_quantity AS REAL) < 0 AND ca.effective_at BETWEEN ? AND ? AND i.expiration_at > ca.effective_at`)
    .bind(portfolioId, from, through).all<{ id: string; instrument_id: string; remaining_quantity: string; cost_basis: string; symbol: string; underlying_instrument_id: string; expiration_at: string; strike: string; option_right: "call"; exercise_style: "american"; action_id: string; cash_amount: string; effective_at: string }>();
  for (const lot of candidates.results) {
    const key = `early-assignment:${lot.id}:${lot.action_id}`;
    if (await db.prepare("SELECT id FROM processing_events WHERE idempotency_key = ?").bind(key).first()) continue;
    const contract: OptionContract = { underlying: lot.underlying_instrument_id.replace("equity:", ""), expiration: lot.expiration_at.slice(0, 10), strike: Number(lot.strike), right: "call", exerciseStyle: "american" };
    const quote = await getOptionQuote(contract), dividend = Number(lot.cash_amount);
    if (quote.analytics.intrinsic < 0.01 || quote.analytics.extrinsic > dividend) continue;
    const contracts = Math.abs(Number(lot.remaining_quantity)), shares = contracts * 100, assignmentAt = new Date(Math.min(now.getTime(), new Date(lot.effective_at).getTime() - 1)).toISOString(), orderId = crypto.randomUUID(), fillId = crypto.randomUUID();
    const underlyingLots = await openLots(portfolioId), statements = [
      db.prepare("INSERT OR IGNORE INTO instruments (id, symbol, display_name, asset_class, exchange, calendar_id) VALUES (?, ?, ?, 'equity', 'US', 'XNYS')").bind(lot.underlying_instrument_id, contract.underlying, contract.underlying),
      db.prepare(`INSERT INTO orders (id, portfolio_id, instrument_id, side, order_type, time_in_force, status, quantity, filled_quantity, reconstruction_status, submitted_at, created_at, updated_at) VALUES (?, ?, ?, 'sell', 'market', 'day', 'filled', ?, ?, 'reconstructed', ?, ?, ?)`).bind(orderId, portfolioId, lot.underlying_instrument_id, shares.toString(), shares.toString(), assignmentAt, assignmentAt, assignmentAt),
      recordFill(db, { id: fillId, orderId, portfolioId, instrumentId: lot.underlying_instrument_id, quantity: shares, price: Number(lot.strike), slippage: 0, model: "deterministic dividend-driven early assignment", executedAt: assignmentAt, quote, context: "early_assignment" }),
      recordLotClosure(db, { portfolioId, lot, closingFillId: fillId, quantity: contracts, exitPrice: quote.analytics.intrinsic, multiplier: 100, reason: "assignment", closedAt: assignmentAt, basisTransferred: true }),
      db.prepare("UPDATE position_lots SET remaining_quantity = '0', closed_at = ? WHERE id = ?").bind(assignmentAt, lot.id),
    ];
    let remainingShares = -shares;
    for (const underlyingLot of underlyingLots.filter((item) => item.instrument_id === lot.underlying_instrument_id && Number(item.remaining_quantity) > 0)) {
      if (!remainingShares) break;
      const existing = Number(underlyingLot.remaining_quantity), closed = Math.min(Math.abs(remainingShares), existing), next = existing - closed;
      remainingShares += closed;
      statements.push(recordLotClosure(db, { portfolioId, lot: underlyingLot, closingFillId: fillId, quantity: closed, exitPrice: Number(lot.strike), multiplier: 1, reason: "assignment", closedAt: assignmentAt }));
      statements.push(db.prepare("UPDATE position_lots SET remaining_quantity = ?, closed_at = ? WHERE id = ?").bind(next.toString(), next === 0 ? assignmentAt : null, underlyingLot.id));
    }
    if (remainingShares) statements.push(db.prepare("INSERT INTO position_lots (id, portfolio_id, instrument_id, opening_fill_id, original_quantity, remaining_quantity, cost_basis, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, lot.underlying_instrument_id, fillId, remainingShares.toString(), remainingShares.toString(), formatMoney(lot.strike), assignmentAt));
    statements.push(
      db.prepare("INSERT INTO cash_ledger (id, portfolio_id, event_type, amount, related_entity_type, related_entity_id, description, effective_at, idempotency_key) VALUES (?, ?, 'assignment', ?, 'fill', ?, ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, multiplyMoney(shares, lot.strike), fillId, `${lot.symbol} assigned before ${contract.underlying} ex-dividend date`, assignmentAt, `early-assignment-cash:${lot.id}:${lot.action_id}`),
      db.prepare("INSERT INTO alerts (id, portfolio_id, severity, event_type, title, message) VALUES (?, ?, 'warning', 'option_assignment', 'American call assigned early', ?)").bind(crypto.randomUUID(), portfolioId, `${lot.symbol} was assigned because remaining extrinsic value (${quote.analytics.extrinsic.toFixed(2)}) did not exceed the ${dividend.toFixed(2)} dividend.`),
      db.prepare("INSERT INTO processing_events (id, portfolio_id, event_type, effective_at, status, payload, idempotency_key) VALUES (?, ?, 'assignment', ?, 'completed', ?, ?)").bind(crypto.randomUUID(), portfolioId, assignmentAt, JSON.stringify({ lotId: lot.id, actionId: lot.action_id, contracts, dividend, extrinsic: quote.analytics.extrinsic }), key),
    );
    await db.batch(statements);
  }
}

async function processOptionExpirations(portfolioId: string) {
  const db = getD1(), now = new Date().toISOString();
  const result = await db.prepare(`SELECT l.id, l.remaining_quantity, l.cost_basis, i.id AS instrument_id, i.symbol, i.underlying_instrument_id,
      i.expiration_at, i.strike, i.option_right, i.exercise_style
    FROM position_lots l JOIN instruments i ON i.id = l.instrument_id
    WHERE l.portfolio_id = ? AND i.asset_class = 'option' AND CAST(l.remaining_quantity AS REAL) != 0 AND i.expiration_at <= ?`)
    .bind(portfolioId, now).all<{ id: string; remaining_quantity: string; cost_basis: string; instrument_id: string; symbol: string; underlying_instrument_id: string; expiration_at: string; strike: string; option_right: "call" | "put"; exercise_style: string }>();
  for (const lot of result.results) {
    const underlyingSymbol = lot.underlying_instrument_id.replace("equity:", ""), underlyingQuote = await getMarketQuote(underlyingSymbol, "equity");
    const strike = Number(lot.strike), optionQuantity = Number(lot.remaining_quantity);
    const expiry = planOptionExpiry({ right: lot.option_right, strike: lot.strike, spot: underlyingQuote.mark, positionQuantity: optionQuantity });
    if (expiry.action === "expire") {
      await db.batch([
        recordLotClosure(db, { portfolioId, lot, quantity: Math.abs(optionQuantity), exitPrice: 0, multiplier: 100, reason: "expiration", closedAt: now }),
        db.prepare("UPDATE position_lots SET remaining_quantity = '0', closed_at = ? WHERE id = ?").bind(now, lot.id),
        db.prepare("INSERT INTO alerts (id, portfolio_id, severity, event_type, title, message) VALUES (?, ?, 'info', 'option_expiration', 'Option expired', ?)").bind(crypto.randomUUID(), portfolioId, `${lot.symbol} expired out of the money.`),
      ]);
      continue;
    }
    const intrinsic = expiry.intrinsic, underlyingQuantity = expiry.underlyingQuantity;
    const side = underlyingQuantity > 0 ? "buy" : "sell", absoluteQuantity = Math.abs(underlyingQuantity);
    const orderId = crypto.randomUUID(), fillId = crypto.randomUUID(), underlyingId = `equity:${underlyingSymbol}`, underlyingLots = await openLots(portfolioId);
    const deliveredBasis = lot.option_right === "call" ? strike + Number(lot.cost_basis) : strike - Number(lot.cost_basis);
    const statements = [
      db.prepare("INSERT OR IGNORE INTO instruments (id, symbol, display_name, asset_class, exchange, calendar_id) VALUES (?, ?, ?, 'equity', 'US', 'XNYS')").bind(underlyingId, underlyingSymbol, underlyingQuote.name),
      db.prepare(`INSERT INTO orders (id, portfolio_id, instrument_id, side, order_type, time_in_force, status, quantity, filled_quantity, reconstruction_status, submitted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'market', 'day', 'filled', ?, ?, 'reconstructed', ?, ?, ?)`)
        .bind(orderId, portfolioId, underlyingId, side, absoluteQuantity.toString(), absoluteQuantity.toString(), lot.expiration_at, now, now),
      recordFill(db, { id: fillId, orderId, portfolioId, instrumentId: underlyingId, quantity: absoluteQuantity, price: strike, slippage: 0, model: "automatic option exercise/assignment", executedAt: lot.expiration_at, quote: underlyingQuote, context: optionQuantity > 0 ? "automatic_exercise" : "automatic_assignment" }),
      recordLotClosure(db, { portfolioId, lot, closingFillId: fillId, quantity: Math.abs(optionQuantity), exitPrice: intrinsic, multiplier: 100, reason: optionQuantity > 0 ? "exercise" : "assignment", closedAt: lot.expiration_at, basisTransferred: true }),
      db.prepare("UPDATE position_lots SET remaining_quantity = '0', closed_at = ? WHERE id = ?").bind(lot.expiration_at, lot.id),
      db.prepare("INSERT INTO cash_ledger (id, portfolio_id, event_type, amount, related_entity_type, related_entity_id, description, effective_at, idempotency_key) VALUES (?, ?, ?, ?, 'fill', ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), portfolioId, expiry.action, expiry.cashImpact, fillId, `${lot.symbol} automatic ${expiry.action}`, lot.expiration_at, `option-expiry:${lot.id}`),
      db.prepare("INSERT INTO alerts (id, portfolio_id, severity, event_type, title, message) VALUES (?, ?, 'warning', 'option_expiration', 'Option lifecycle processed', ?)").bind(crypto.randomUUID(), portfolioId, `${lot.symbol} was automatically ${optionQuantity > 0 ? "exercised" : "assigned"} at expiry.`),
      ...netDeliveredUnderlying(db, { portfolioId, instrumentId: underlyingId, fillId, signedQuantity: underlyingQuantity, basis: deliveredBasis, strike, reason: optionQuantity > 0 ? "exercise" : "assignment", closedAt: lot.expiration_at, lots: underlyingLots }),
    ];
    await db.batch(statements);
  }
}

async function processDerivativeSettlements(portfolioId: string) {
  const db = getD1(), now = new Date(), nowIso = now.toISOString(), noticeCutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const result = await db.prepare(`SELECT l.id, l.remaining_quantity, l.cost_basis, i.id AS instrument_id, i.symbol, i.display_name,
      i.asset_class, i.multiplier, i.underlying_instrument_id, i.expiration_at, i.first_notice_at, i.strike, i.settlement_type
    FROM position_lots l JOIN instruments i ON i.id = l.instrument_id
    WHERE l.portfolio_id = ? AND CAST(l.remaining_quantity AS REAL) != 0 AND (
      (i.asset_class = 'future' AND ((i.settlement_type = 'physical' AND i.first_notice_at IS NOT NULL AND i.first_notice_at <= ?) OR i.expiration_at <= ?))
      OR (i.asset_class = 'forward' AND i.expiration_at <= ?))`)
    .bind(portfolioId, noticeCutoff, nowIso, nowIso).all<{ id: string; remaining_quantity: string; cost_basis: string; instrument_id: string; symbol: string; display_name: string; asset_class: "future" | "forward"; multiplier: string; underlying_instrument_id: string | null; expiration_at: string; first_notice_at: string | null; strike: string | null; settlement_type: string }>();
  for (const lot of result.results) {
    const contract = lot.asset_class === "future" ? findFuture(lot.symbol) : undefined;
    const quote = contract ? await getFutureQuote(contract) : await getForwardQuote({ underlying: (lot.underlying_instrument_id || "equity:SPY").replace(/^(equity|crypto):/, ""), deliveryDate: lot.expiration_at.slice(0, 10), deliveryPrice: Number(lot.strike), quantityUnit: "units" });
    const quantity = Number(lot.remaining_quantity), pnl = derivativeSettlementAmount({ entryPrice: lot.cost_basis, settlementPrice: quote.mark, signedQuantity: quantity, multiplier: Number(lot.multiplier) });
    const reason = lot.asset_class === "future" && lot.settlement_type === "physical" && lot.first_notice_at && lot.first_notice_at <= noticeCutoff ? "first-notice safeguard" : "contract settlement";
    await db.batch([
      recordLotClosure(db, { portfolioId, lot, quantity: Math.abs(quantity), exitPrice: Number(quote.mark), multiplier: Number(lot.multiplier), reason: "settlement", closedAt: nowIso }),
      db.prepare("UPDATE position_lots SET remaining_quantity = '0', closed_at = ? WHERE id = ?").bind(nowIso, lot.id),
      db.prepare("INSERT INTO cash_ledger (id, portfolio_id, event_type, amount, related_entity_type, related_entity_id, description, effective_at, idempotency_key) VALUES (?, ?, 'settlement', ?, 'position_lot', ?, ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, pnl, lot.id, `${lot.symbol} ${reason}`, nowIso, `derivative-settlement:${lot.id}`),
      db.prepare("INSERT INTO alerts (id, portfolio_id, severity, event_type, title, message) VALUES (?, ?, 'warning', 'derivative_settlement', 'Derivative position closed', ?)").bind(crypto.randomUUID(), portfolioId, `${lot.symbol} closed by the ${reason}. Realized P&L: $${pnl}.`),
    ]);
  }
}

async function forceMarginLiquidation(portfolioId: string, equity: number, maintenance: number, lots: LotRow[]) {
  const db = getD1(), now = new Date().toISOString();
  let remainingMaintenance = maintenance;
  for (const lot of [...lots].sort((left, right) => Math.abs(Number(right.remaining_quantity) * Number(right.multiplier)) - Math.abs(Number(left.remaining_quantity) * Number(left.multiplier)))) {
    if (!requiresMarginLiquidation(equity, remainingMaintenance)) break;
    const quantity = Math.abs(Number(lot.remaining_quantity)), side: "buy" | "sell" = Number(lot.remaining_quantity) > 0 ? "sell" : "buy";
    const quote = lot.asset_class === "option" && lot.expiration_at && lot.strike && lot.option_right && lot.exercise_style
      ? await getOptionQuote({ underlying: (lot.underlying_instrument_id || "equity:SPY").replace("equity:", ""), expiration: lot.expiration_at.slice(0, 10), strike: Number(lot.strike), right: lot.option_right, exerciseStyle: lot.exercise_style })
      : lot.asset_class === "future" && findFuture(lot.symbol) ? await getFutureQuote(findFuture(lot.symbol)!)
      : lot.asset_class === "forward" && lot.expiration_at && lot.strike && lot.underlying_instrument_id ? await getForwardQuote({ underlying: lot.underlying_instrument_id.replace(/^(equity|crypto):/, ""), deliveryDate: lot.expiration_at.slice(0, 10), deliveryPrice: Number(lot.strike), quantityUnit: "units" })
      : await getMarketQuote(lot.symbol, lot.asset_class);
    const execution = estimateExecution(quote, side, quantity), multiplier = Number(lot.multiplier), orderId = crypto.randomUUID(), fillId = crypto.randomUUID();
    const realized = formatMoney(calculateRealizedPnl({ entryPrice: Number(lot.cost_basis), exitPrice: execution.price, signedOpenQuantity: Number(lot.remaining_quantity), closedQuantity: quantity, multiplier }));
    const cashChange = lot.asset_class === "future" || lot.asset_class === "forward" ? realized : multiplyMoney(side === "buy" ? -1 : 1, execution.price, quantity, multiplier);
    const relief = lot.asset_class === "future" && findFuture(lot.symbol) ? quantity * findFuture(lot.symbol)!.maintenanceMargin : Math.abs(execution.price * quantity * multiplier) * (Number(lot.remaining_quantity) < 0 ? 0.3 : lot.asset_class === "forward" ? 0.1 : 0.25);
    await db.batch([
      db.prepare(`INSERT INTO orders (id, portfolio_id, instrument_id, side, order_type, time_in_force, status, quantity, filled_quantity, submitted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'market', 'day', 'filled', ?, ?, ?, ?, ?)`)
        .bind(orderId, portfolioId, lot.instrument_id, side, quantity.toString(), quantity.toString(), now, now, now),
      recordFill(db, { id: fillId, orderId, portfolioId, instrumentId: lot.instrument_id, quantity, price: execution.price, slippage: execution.slippage, model: "forced margin liquidation", executedAt: now, quote, context: "forced_liquidation" }),
      recordLotClosure(db, { portfolioId, lot, closingFillId: fillId, quantity, exitPrice: execution.price, multiplier, reason: "forced_liquidation", closedAt: now }),
      db.prepare("UPDATE position_lots SET remaining_quantity = '0', closed_at = ? WHERE id = ?").bind(now, lot.id),
      db.prepare("INSERT INTO cash_ledger (id, portfolio_id, event_type, amount, related_entity_type, related_entity_id, description, effective_at, idempotency_key) VALUES (?, ?, 'trade', ?, 'fill', ?, ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, cashChange, fillId, `${lot.symbol} forced liquidation`, now, `forced-liquidation:${lot.id}`),
      db.prepare("INSERT INTO alerts (id, portfolio_id, severity, event_type, title, message) VALUES (?, ?, 'critical', 'forced_liquidation', 'Margin liquidation executed', ?)").bind(crypto.randomUUID(), portfolioId, `${quantity} ${lot.symbol} liquidated to restore the 110% maintenance buffer.`),
    ]);
    remainingMaintenance = Math.max(0, remainingMaintenance - relief);
  }
}

async function getReconciliationStatus(portfolioId: string) {
  const db = getD1();
  const [lotIntegrity, closureIntegrity, pnlIntegrity] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS issues FROM position_lots l
      LEFT JOIN instruments i ON i.id = l.instrument_id LEFT JOIN fills f ON f.id = l.opening_fill_id
      WHERE l.portfolio_id = ? AND (i.id IS NULL OR f.id IS NULL OR (ABS(CAST(l.remaining_quantity AS REAL)) < 0.000000001 AND l.closed_at IS NULL) OR (ABS(CAST(l.remaining_quantity AS REAL)) >= 0.000000001 AND l.closed_at IS NOT NULL))`).bind(portfolioId).first<{ issues: number }>(),
    db.prepare(`SELECT COUNT(*) AS issues FROM lot_closures lc
      LEFT JOIN position_lots l ON l.id = lc.opening_lot_id LEFT JOIN instruments i ON i.id = lc.instrument_id
      WHERE lc.portfolio_id = ? AND (l.id IS NULL OR i.id IS NULL OR CAST(lc.quantity AS REAL) <= 0)`).bind(portfolioId).first<{ issues: number }>(),
    db.prepare(`SELECT COUNT(*) AS issues FROM lot_closures lc JOIN position_lots l ON l.id = lc.opening_lot_id
      WHERE lc.portfolio_id = ? AND lc.basis_transferred = 0 AND ABS(CAST(lc.realized_pnl AS REAL) - ((CAST(lc.exit_price AS REAL) - CAST(lc.entry_price AS REAL)) * CASE WHEN CAST(l.original_quantity AS REAL) > 0 THEN 1 ELSE -1 END * CAST(lc.quantity AS REAL) * CAST(lc.multiplier AS REAL))) > 0.02`).bind(portfolioId).first<{ issues: number }>(),
  ]);
  const checks = [
    { key: "lots", label: "Position lots and opening fills", issues: Number(lotIntegrity?.issues || 0) },
    { key: "closures", label: "Closure references and quantities", issues: Number(closureIntegrity?.issues || 0) },
    { key: "pnl", label: "Realized P&L arithmetic", issues: Number(pnlIntegrity?.issues || 0) },
  ];
  return { status: checks.every((check) => check.issues === 0) ? "reconciled" : "attention", checkedAt: new Date().toISOString(), checks };
}

export async function getDashboard(portfolioId: string, afterLiquidation = false): Promise<Record<string, unknown>> {
  await ensureCoreSchema();
  await processAmericanEarlyAssignments(portfolioId);
  await processCorporateActions();
  await processDerivativeSettlements(portfolioId);
  await processOptionExpirations(portfolioId);
  await processOptionStrategyOrders(portfolioId);
  await processActiveOrders(portfolioId);
  const portfolio = await getD1().prepare("SELECT id, name, starting_capital, benchmark_symbol, advanced_derivatives_enabled, theme, created_at FROM portfolios WHERE id = ? AND status = 'active'").bind(portfolioId).first<PortfolioRow>();
  if (!portfolio) throw new Error("Portfolio not found.");
  const [cash, netExternalFlows, lots, orderResult] = await Promise.all([
    cashBalance(portfolioId), externalCashFlows(portfolioId), openLots(portfolioId),
    getD1().prepare(`SELECT o.id, o.side, o.order_type, o.time_in_force, o.status, o.quantity, o.filled_quantity, o.limit_price, o.stop_price, o.scheduled_for, o.rejection_reason, o.created_at, i.symbol, i.asset_class, i.underlying_instrument_id, i.expiration_at, i.strike, i.option_right, i.exercise_style,
      (SELECT f.price FROM fills f WHERE f.order_id = o.id ORDER BY f.executed_at DESC LIMIT 1) AS fill_price,
      (SELECT f.slippage FROM fills f WHERE f.order_id = o.id ORDER BY f.executed_at DESC LIMIT 1) AS fill_slippage,
      (SELECT f.quote_provider FROM fills f WHERE f.order_id = o.id ORDER BY f.executed_at DESC LIMIT 1) AS fill_provider,
      (SELECT f.quote_quality FROM fills f WHERE f.order_id = o.id ORDER BY f.executed_at DESC LIMIT 1) AS fill_quality,
      (SELECT f.quote_observed_at FROM fills f WHERE f.order_id = o.id ORDER BY f.executed_at DESC LIMIT 1) AS fill_quote_observed_at,
      (SELECT f.quote_bid FROM fills f WHERE f.order_id = o.id ORDER BY f.executed_at DESC LIMIT 1) AS fill_bid,
      (SELECT f.quote_ask FROM fills f WHERE f.order_id = o.id ORDER BY f.executed_at DESC LIMIT 1) AS fill_ask,
      (SELECT f.reference_price FROM fills f WHERE f.order_id = o.id ORDER BY f.executed_at DESC LIMIT 1) AS fill_reference_price,
      (SELECT f.liquidity_model FROM fills f WHERE f.order_id = o.id ORDER BY f.executed_at DESC LIMIT 1) AS fill_model,
      (SELECT COUNT(*) FROM order_legs ol WHERE ol.order_id = o.id) AS leg_count
      FROM orders o JOIN instruments i ON i.id = o.instrument_id WHERE o.portfolio_id = ? ORDER BY o.created_at DESC LIMIT 12`)
      .bind(portfolioId).all<{ id: string; side: string; order_type: string; status: string; quantity: string; filled_quantity: string; limit_price: string | null; scheduled_for: string | null; created_at: string; symbol: string; leg_count: number }>(),
  ]);

  const grouped = new Map<string, { instrumentId: string; symbol: string; name: string; assetClass: AssetClass; quantity: number; basisNumerator: number; multiplier: number; optionContract?: OptionContract; futureContract?: FutureContract; forwardContract?: ForwardContract }>();
  for (const lot of lots) {
    const quantity = Number(lot.remaining_quantity), multiplier = Number(lot.multiplier);
    const optionContract = lot.asset_class === "option" && lot.expiration_at && lot.strike && lot.option_right && lot.exercise_style
      ? { underlying: (lot.underlying_instrument_id || "equity:SPY").replace("equity:", ""), expiration: lot.expiration_at.slice(0, 10), strike: Number(lot.strike), right: lot.option_right, exerciseStyle: lot.exercise_style }
      : undefined;
    const futureContract = lot.asset_class === "future" ? findFuture(lot.symbol) : undefined;
    const forwardContract = lot.asset_class === "forward" && lot.expiration_at && lot.strike && lot.underlying_instrument_id
      ? { underlying: lot.underlying_instrument_id.replace(/^(equity|crypto):/, ""), deliveryDate: lot.expiration_at.slice(0, 10), deliveryPrice: Number(lot.strike), quantityUnit: "units" }
      : undefined;
    const current = grouped.get(lot.instrument_id) ?? { instrumentId: lot.instrument_id, symbol: lot.symbol, name: lot.display_name, assetClass: lot.asset_class, quantity: 0, basisNumerator: 0, multiplier, optionContract, futureContract, forwardContract };
    current.quantity += quantity;
    current.basisNumerator += Number(lot.cost_basis) * quantity;
    grouped.set(lot.instrument_id, current);
  }

  let marketValue = 0, grossExposure = 0, maintenanceMargin = 0;
  const positions = await Promise.all([...grouped.values()].filter((position) => Math.abs(position.quantity) > 1e-9).map(async (position) => {
    const quote = position.assetClass === "option" && position.optionContract ? await getOptionQuote(position.optionContract)
      : position.assetClass === "future" && position.futureContract ? await getFutureQuote(position.futureContract)
      : position.assetClass === "forward" && position.forwardContract ? await getForwardQuote(position.forwardContract)
      : await getMarketQuote(position.symbol, position.assetClass);
    const mark = Number(quote.mark), averageCost = position.basisNumerator / position.quantity;
    const value = position.quantity * mark * position.multiplier;
    const pnl = (mark - averageCost) * position.quantity * position.multiplier;
    marketValue += position.assetClass === "future" || position.assetClass === "forward" ? pnl : value; grossExposure += Math.abs(value);
    maintenanceMargin += position.assetClass === "future" && position.futureContract ? Math.abs(position.quantity) * position.futureContract.maintenanceMargin
      : position.assetClass === "forward" ? Math.abs(value) * 0.1 : position.assetClass === "option" ? 0 : Math.abs(value) * (position.quantity < 0 ? 0.3 : 0.25);
    const optionAnalytics = position.assetClass === "option" && position.optionContract && "analytics" in quote ? quote.analytics : undefined;
    return { ...position, mark, averageCost, marketValue: value, unrealizedPnl: pnl, quote, optionGreeks: optionAnalytics?.greeks, underlyingSpot: optionAnalytics?.spot };
  }));
  const equityShares = Object.fromEntries(positions.filter((position) => position.assetClass === "equity").map((position) => [position.symbol, position.quantity]));
  const optionMargin = calculatePortfolioOptionMargin(positions.flatMap((position) => position.assetClass === "option" && position.optionContract ? [{ underlying: position.optionContract.underlying, expiration: position.optionContract.expiration, right: position.optionContract.right, strike: position.optionContract.strike, quantity: position.quantity, spot: position.underlyingSpot || 0, mark: position.mark }] : []), equityShares);
  maintenanceMargin += optionMargin.requirement;
  const netLiquidationValue = cash + marketValue;
  const reservedForOrders = await reservedBuyingPower(portfolioId);
  const optionGrossExposure = positions.filter((position) => position.assetClass === "option").reduce((sum, position) => sum + Math.abs(position.marketValue), 0);
  const buyingPower = Math.max(0, netLiquidationValue * 2 - (grossExposure - optionGrossExposure) - optionMargin.requirement - reservedForOrders);
  const startingCapital = Number(portfolio.starting_capital);
  const totalPnl = calculateFlowAdjustedPnl(netLiquidationValue, startingCapital, netExternalFlows);
  if (!afterLiquidation && maintenanceMargin > 0 && netLiquidationValue < maintenanceMargin * 1.1) {
    await forceMarginLiquidation(portfolioId, netLiquidationValue, maintenanceMargin, lots);
    return getDashboard(portfolioId, true);
  }
  const session = getUsEquitySession();
  const unrealizedPnl = positions.reduce((sum, position) => sum + position.unrealizedPnl, 0), realizedPnl = totalPnl - unrealizedPnl;
  const snapshotDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await getD1().prepare(`INSERT INTO portfolio_snapshots (id, portfolio_id, snapshot_date, net_liquidation_value, cash, realized_pnl, unrealized_pnl, margin_requirement, buying_power)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(portfolio_id, snapshot_date) DO UPDATE SET net_liquidation_value = excluded.net_liquidation_value,
    cash = excluded.cash, realized_pnl = excluded.realized_pnl, unrealized_pnl = excluded.unrealized_pnl, margin_requirement = excluded.margin_requirement, buying_power = excluded.buying_power`)
    .bind(crypto.randomUUID(), portfolioId, snapshotDate, formatMoney(netLiquidationValue), formatMoney(cash), formatMoney(realizedPnl), formatMoney(unrealizedPnl), formatMoney(maintenanceMargin), formatMoney(buyingPower)).run();
  const benchmarks = await getBenchmarks(portfolioId);
  await recordPerformanceObservations(portfolioId, netLiquidationValue - netExternalFlows, benchmarks);
  await evaluateAlertRules(portfolioId, totalPnl);
  const [snapshotResult, alertResult, alertRules, performanceSeries, ledgerReport, closureReport] = await Promise.all([
    getD1().prepare("SELECT snapshot_date, net_liquidation_value, realized_pnl, unrealized_pnl FROM portfolio_snapshots WHERE portfolio_id = ? ORDER BY snapshot_date DESC LIMIT 30").bind(portfolioId).all<{ snapshot_date: string; net_liquidation_value: string; realized_pnl: string; unrealized_pnl: string }>(),
    getD1().prepare("SELECT id, severity, event_type, title, message, created_at FROM alerts WHERE portfolio_id = ? ORDER BY created_at DESC LIMIT 12").bind(portfolioId).all<{ id: string; severity: string; event_type: string; title: string; message: string; created_at: string }>(),
    listAlertRules(portfolioId),
    getPerformanceSeries(portfolioId, benchmarks.map((benchmark) => benchmark.symbol)),
    getLedgerReport(portfolioId, realizedPnl),
    getClosureReport(portfolioId),
  ]);
  const largestPosition = positions.reduce<{ symbol: string; value: number } | null>((largest, position) => !largest || Math.abs(position.marketValue) > largest.value ? { symbol: position.symbol, value: Math.abs(position.marketValue) } : largest, null);
  const estimatedDailyVar = positions.reduce((sum, position) => sum + Math.abs(position.marketValue) * (position.assetClass === "crypto" ? 0.05 : position.assetClass === "option" ? 0.08 : position.assetClass === "future" ? 0.025 : 0.018), 0);
  const greeks = positions.reduce((total, position) => {
    if (!position.optionGreeks) return total;
    const scale = position.quantity * position.multiplier;
    total.delta += position.optionGreeks.delta * scale; total.gamma += position.optionGreeks.gamma * scale;
    total.theta += position.optionGreeks.theta * scale; total.vega += position.optionGreeks.vega * scale;
    return total;
  }, { delta: 0, gamma: 0, theta: 0, vega: 0 });
  const scenarios = [-0.1, -0.05, 0.05, 0.1].map((shock) => ({ shock, estimatedPnl: positions.reduce((sum, position) => {
    if (position.assetClass === "option" && position.optionGreeks && position.optionContract) {
      const underlyingMove = (position.underlyingSpot || 0) * shock;
      return sum + position.optionGreeks.delta * underlyingMove * position.quantity * position.multiplier + 0.5 * position.optionGreeks.gamma * underlyingMove * underlyingMove * position.quantity * position.multiplier;
    }
    return sum + position.marketValue * shock;
  }, 0) }));
  const expirationPreview = positions.flatMap((position) => {
    if (position.assetClass !== "option" || !position.optionContract) return [];
    const expiresAt = new Date(`${position.optionContract.expiration}T20:00:00.000Z`), daysToExpiration = Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000);
    if (daysToExpiration < 0 || daysToExpiration > 45) return [];
    const spot = position.underlyingSpot || 0, intrinsic = position.optionContract.right === "call" ? spot - position.optionContract.strike : position.optionContract.strike - spot, inTheMoney = intrinsic >= 0.01;
    const shareChange = inTheMoney ? (position.optionContract.right === "call" ? 1 : -1) * position.quantity * 100 : 0;
    return [{ instrumentId: position.instrumentId, symbol: position.symbol, underlying: position.optionContract.underlying, expiration: position.optionContract.expiration, daysToExpiration, quantity: position.quantity, inTheMoney, action: inTheMoney ? (position.quantity > 0 ? "exercise" : "assignment") : "expire", shareChange, cashImpact: -shareChange * position.optionContract.strike }];
  }).sort((left, right) => left.daysToExpiration - right.daysToExpiration);
  const reconciliation = await getReconciliationStatus(portfolioId);
  const exposureByUnderlying = Object.values(positions.reduce<Record<string, { underlying: string; grossExposure: number; netMarketValue: number; unrealizedPnl: number; delta: number; positions: number }>>((groups, position) => {
    const underlying = position.optionContract?.underlying || position.symbol;
    groups[underlying] ||= { underlying, grossExposure: 0, netMarketValue: 0, unrealizedPnl: 0, delta: 0, positions: 0 };
    groups[underlying].grossExposure += Math.abs(position.marketValue); groups[underlying].netMarketValue += position.marketValue; groups[underlying].unrealizedPnl += position.unrealizedPnl; groups[underlying].positions += 1;
    groups[underlying].delta += position.optionGreeks ? position.optionGreeks.delta * position.quantity * position.multiplier : position.quantity * position.multiplier;
    return groups;
  }, {})).sort((left, right) => right.grossExposure - left.grossExposure);
  const strategyExposure = Object.values(positions.filter((position) => position.optionContract).reduce<Record<string, { key: string; underlying: string; expiration: string; contracts: number; grossPremium: number; delta: number; theta: number }>>((groups, position) => {
    const contract = position.optionContract!, key = `${contract.underlying}:${contract.expiration}`;
    groups[key] ||= { key, underlying: contract.underlying, expiration: contract.expiration, contracts: 0, grossPremium: 0, delta: 0, theta: 0 };
    groups[key].contracts += position.quantity; groups[key].grossPremium += Math.abs(position.marketValue); groups[key].delta += (position.optionGreeks?.delta || 0) * position.quantity * position.multiplier; groups[key].theta += (position.optionGreeks?.theta || 0) * position.quantity * position.multiplier;
    return groups;
  }, {})).sort((left, right) => left.expiration.localeCompare(right.expiration));
  return {
    portfolio: { id: portfolio.id, name: portfolio.name, startingCapital, advancedDerivativesEnabled: Boolean(portfolio.advanced_derivatives_enabled), theme: portfolio.theme },
    account: { cash, marketValue, netLiquidationValue, totalPnl, totalReturn: startingCapital ? totalPnl / startingCapital : 0, netExternalFlows, buyingPower, reservedBuyingPower: reservedForOrders, grossExposure, maintenanceMargin, optionMargin: optionMargin.requirement, marginOffsets: optionMargin.definedRiskOffsets, coveredOptionContracts: optionMargin.coveredContracts, uncoveredOptionContracts: optionMargin.uncoveredContracts, marginUtilization: netLiquidationValue > 0 ? maintenanceMargin / netLiquidationValue : 0 },
    positions, orders: orderResult.results, benchmarks, performanceSeries, ledgerReport, closureReport, allocations: await getAllocations(portfolioId), corporateActions: await listCorporateActions(), session,
    pnlHistory: snapshotResult.results.map((item) => ({ date: item.snapshot_date, netLiquidationValue: Number(item.net_liquidation_value), realizedPnl: Number(item.realized_pnl), unrealizedPnl: Number(item.unrealized_pnl) })).reverse(),
    risk: { leverage: netLiquidationValue > 0 ? grossExposure / netLiquidationValue : 0, estimatedDailyVar, largestPosition: largestPosition ? { ...largestPosition, concentration: grossExposure ? largestPosition.value / grossExposure : 0 } : null, greeks, scenarios }, expirationPreview, reconciliation,
    alerts: alertResult.results, alertRules, exposureBreakdown: { byUnderlying: exposureByUnderlying, strategies: strategyExposure },
    quoteStatus: { provider: positions[0]?.quote.provider || "Provider routing active", quality: positions[0]?.quote.quality || "ready", refreshedAt: new Date().toISOString() },
  };
}

function csvCell(value: unknown) { const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function toCsv(headers: string[], rows: unknown[][]) { return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n"); }

export async function exportPortfolioCsv(portfolioId: string, report: "transactions" | "positions" | "pnl" | "closed-trades") {
  await ensureCoreSchema();
  const portfolio = await getD1().prepare("SELECT name FROM portfolios WHERE id = ? AND status = 'active'").bind(portfolioId).first<{ name: string }>();
  if (!portfolio) throw new Error("Portfolio not found.");
  if (report === "transactions") {
    const result = await getD1().prepare("SELECT event_type, amount, currency, description, related_entity_type, related_entity_id, effective_at FROM cash_ledger WHERE portfolio_id = ? ORDER BY effective_at, created_at").bind(portfolioId).all<{ event_type: string; amount: string; currency: string; description: string; related_entity_type: string | null; related_entity_id: string | null; effective_at: string }>();
    return { filename: `${portfolio.name}-transactions.csv`, content: toCsv(["effective_at", "event_type", "amount", "currency", "description", "related_entity_type", "related_entity_id"], result.results.map((row) => [row.effective_at, row.event_type, row.amount, row.currency, row.description, row.related_entity_type, row.related_entity_id])) };
  }
  if (report === "pnl") {
    const result = await getD1().prepare("SELECT snapshot_date, net_liquidation_value, cash, realized_pnl, unrealized_pnl, margin_requirement, buying_power FROM portfolio_snapshots WHERE portfolio_id = ? ORDER BY snapshot_date").bind(portfolioId).all<{ snapshot_date: string; net_liquidation_value: string; cash: string; realized_pnl: string; unrealized_pnl: string; margin_requirement: string; buying_power: string }>();
    return { filename: `${portfolio.name}-pnl.csv`, content: toCsv(["date", "net_liquidation_value", "cash", "realized_pnl", "unrealized_pnl", "margin_requirement", "buying_power"], result.results.map((row) => [row.snapshot_date, row.net_liquidation_value, row.cash, row.realized_pnl, row.unrealized_pnl, row.margin_requirement, row.buying_power])) };
  }
  if (report === "closed-trades") {
    const result = await getD1().prepare(`SELECT lc.closed_at, i.symbol, i.display_name, i.asset_class, lc.quantity, lc.entry_price, lc.exit_price,
      lc.multiplier, lc.realized_pnl, lc.closure_reason, lc.basis_transferred, f.order_id
      FROM lot_closures lc JOIN instruments i ON i.id = lc.instrument_id LEFT JOIN fills f ON f.id = lc.closing_fill_id
      WHERE lc.portfolio_id = ? ORDER BY lc.closed_at, lc.created_at`).bind(portfolioId).all<{ closed_at: string; symbol: string; display_name: string; asset_class: string; quantity: string; entry_price: string; exit_price: string; multiplier: string; realized_pnl: string; closure_reason: string; basis_transferred: number; order_id: string | null }>();
    return { filename: `${portfolio.name}-closed-trades.csv`, content: toCsv(["closed_at", "symbol", "name", "asset_class", "quantity", "entry_price", "exit_price", "multiplier", "realized_pnl", "reason", "basis_transferred", "closing_order_id"], result.results.map((row) => [row.closed_at, row.symbol, row.display_name, row.asset_class, row.quantity, row.entry_price, row.exit_price, row.multiplier, row.realized_pnl, row.closure_reason, row.basis_transferred, row.order_id])) };
  }
  const dashboard = await getDashboard(portfolioId) as { positions: { symbol: string; name: string; assetClass: string; quantity: number; averageCost: number; mark: number; marketValue: number; unrealizedPnl: number; quote: { quality: string; provider: string; observedAt: string } }[] };
  return { filename: `${portfolio.name}-positions.csv`, content: toCsv(["symbol", "name", "asset_class", "quantity", "average_cost", "mark", "market_value", "unrealized_pnl", "quote_quality", "quote_provider", "observed_at"], dashboard.positions.map((row) => [row.symbol, row.name, row.assetClass, row.quantity, row.averageCost, row.mark, row.marketValue, row.unrealizedPnl, row.quote.quality, row.quote.provider, row.quote.observedAt])) };
}

export async function placeOptionStrategy(input: { portfolioId: string; units: number; legs: OptionStrategyLeg[]; orderType?: "market" | "limit"; netLimitPrice?: number }) {
  await ensureCoreSchema();
  const orderType = input.orderType || "market";
  if (orderType === "limit" && (!Number.isFinite(input.netLimitPrice) || Number(input.netLimitPrice) <= 0)) throw new Error("A positive net limit is required.");
  const preview = await previewOptionStrategy(input.legs, input.units);
  const dashboard = await getDashboard(input.portfolioId) as { portfolio: { advancedDerivativesEnabled: boolean }; account: { buyingPower: number } };
  if (preview.unboundedRisk && !dashboard.portfolio.advancedDerivativesEnabled) throw new Error("A strategy with uncovered call risk requires Advanced Derivatives.");
  const strategySide = preview.netDebit >= 0 ? "buy" : "sell";
  const worstNetDebit = orderType === "limit" ? (strategySide === "buy" ? 1 : -1) * Number(input.netLimitPrice) * 100 * input.units : preview.netDebit;
  const adversePremium = Math.max(0, worstNetDebit - preview.netDebit);
  const required = preview.maxLoss === null ? Math.max(0, preview.netDebit) + preview.legs[0].analytics.spot * 100 * input.units * 0.2 + adversePremium : preview.maxLoss + adversePremium;
  if (required > dashboard.account.buyingPower + 0.005) throw new Error(`Insufficient buying power. This strategy requires approximately $${required.toLocaleString("en-US", { maximumFractionDigits: 2 })}.`);
  const session = getUsEquitySession(), status = session.isOpen ? "accepted" : "scheduled", now = new Date().toISOString(), orderId = crypto.randomUUID(), db = getD1();
  const statements = [];
  for (const leg of preview.legs) {
    const instrumentId = `option:${leg.symbol}`;
    statements.push(db.prepare(`INSERT OR IGNORE INTO instruments (id, symbol, display_name, asset_class, exchange, calendar_id, multiplier, underlying_instrument_id, expiration_at, strike, option_right, exercise_style, settlement_type)
      VALUES (?, ?, ?, 'option', 'US', 'XNYS', '100', ?, ?, ?, ?, ?, 'physical')`).bind(instrumentId, leg.symbol, `${preview.underlying} ${leg.contract.expiration} ${leg.contract.strike} ${leg.contract.right.toUpperCase()} · ${leg.contract.exerciseStyle}`, `equity:${preview.underlying}`, `${leg.contract.expiration}T20:00:00.000Z`, leg.contract.strike.toString(), leg.contract.right, leg.contract.exerciseStyle));
  }
  const first = preview.legs[0];
  statements.push(db.prepare(`INSERT INTO orders (id, portfolio_id, instrument_id, side, order_type, time_in_force, status, quantity, filled_quantity, limit_price, scheduled_for, submitted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'day', ?, ?, '0', ?, ?, ?, ?, ?)`).bind(orderId, input.portfolioId, `option:${first.symbol}`, strategySide, orderType, status, input.units.toString(), input.netLimitPrice?.toString() ?? null, status === "scheduled" ? session.nextOpenAt : null, now, now, now));
  for (const leg of preview.legs) statements.push(db.prepare("INSERT INTO order_legs (id, order_id, instrument_id, side, ratio_quantity) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), orderId, `option:${leg.symbol}`, leg.side, leg.ratio.toString()));
  await db.batch(statements);
  const filled = session.isOpen ? await executeOptionStrategyOrder(input.portfolioId, orderId) : false;
  return { orderId, status: session.isOpen ? (filled ? "filled" : "accepted") : "scheduled", scheduledFor: session.isOpen ? null : session.nextOpenAt, preview };
}

export async function exerciseAmericanOption(input: { portfolioId: string; instrumentId: string; quantity: number }) {
  await ensureCoreSchema();
  if (!getUsEquitySession().isOpen) throw new Error("Manual exercise is available only during the US regular session.");
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new Error("Exercise quantity must be a positive whole number.");
  const db = getD1();
  const instrument = await db.prepare("SELECT symbol, underlying_instrument_id, strike, option_right, exercise_style, expiration_at FROM instruments WHERE id = ? AND asset_class = 'option'").bind(input.instrumentId).first<{ symbol: string; underlying_instrument_id: string; strike: string; option_right: "call" | "put"; exercise_style: "american" | "european"; expiration_at: string }>();
  if (!instrument) throw new Error("Option contract not found.");
  if (instrument.exercise_style !== "american") throw new Error("European options can only be exercised at expiration.");
  if (new Date(instrument.expiration_at).getTime() <= Date.now()) throw new Error("This contract is already at expiration and will be processed automatically.");
  const lots = await db.prepare("SELECT id, instrument_id, remaining_quantity, cost_basis FROM position_lots WHERE portfolio_id = ? AND instrument_id = ? AND CAST(remaining_quantity AS REAL) > 0 ORDER BY opened_at").bind(input.portfolioId, input.instrumentId).all<{ id: string; instrument_id: string; remaining_quantity: string; cost_basis: string }>();
  const available = lots.results.reduce((sum, lot) => sum + Number(lot.remaining_quantity), 0);
  if (input.quantity > available) throw new Error(`Only ${available} long contracts are available to exercise.`);
  const underlyingSymbol = instrument.underlying_instrument_id.replace("equity:", ""), underlyingQuote = await getMarketQuote(underlyingSymbol, "equity"), strike = Number(instrument.strike), spot = Number(underlyingQuote.mark);
  const intrinsic = instrument.option_right === "call" ? spot - strike : strike - spot;
  if (intrinsic < 0.01) throw new Error("Only options at least $0.01 in the money can be exercised.");
  const now = new Date().toISOString(), orderId = crypto.randomUUID(), underlyingQuantity = (instrument.option_right === "call" ? 1 : -1) * input.quantity * 100, side = underlyingQuantity > 0 ? "buy" : "sell", fillId = crypto.randomUUID();
  const underlyingLots = await openLots(input.portfolioId), statements = [
    db.prepare("INSERT OR IGNORE INTO instruments (id, symbol, display_name, asset_class, exchange, calendar_id) VALUES (?, ?, ?, 'equity', 'US', 'XNYS')").bind(instrument.underlying_instrument_id, underlyingSymbol, underlyingQuote.name),
    db.prepare(`INSERT INTO orders (id, portfolio_id, instrument_id, side, order_type, time_in_force, status, quantity, filled_quantity, reconstruction_status, submitted_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'market', 'day', 'filled', ?, ?, 'reconstructed', ?, ?, ?)`).bind(orderId, input.portfolioId, instrument.underlying_instrument_id, side, Math.abs(underlyingQuantity).toString(), Math.abs(underlyingQuantity).toString(), now, now, now),
    recordFill(db, { id: fillId, orderId, portfolioId: input.portfolioId, instrumentId: instrument.underlying_instrument_id, quantity: Math.abs(underlyingQuantity), price: strike, slippage: 0, model: "manual American option exercise", executedAt: now, quote: underlyingQuote, context: "manual_exercise" }),
  ];
  let remaining = input.quantity, premiumBasis = 0;
  for (const lot of lots.results) {
    if (!remaining) break;
    const lotQuantity = Number(lot.remaining_quantity), exercised = Math.min(remaining, lotQuantity), next = lotQuantity - exercised;
    remaining -= exercised; premiumBasis += Number(lot.cost_basis) * exercised;
    statements.push(recordLotClosure(db, { portfolioId: input.portfolioId, lot, closingFillId: fillId, quantity: exercised, exitPrice: intrinsic, multiplier: 100, reason: "exercise", closedAt: now, basisTransferred: true }));
    statements.push(db.prepare("UPDATE position_lots SET remaining_quantity = ?, closed_at = ? WHERE id = ?").bind(next.toString(), next === 0 ? now : null, lot.id));
  }
  const averagePremium = premiumBasis / input.quantity, underlyingBasis = instrument.option_right === "call" ? strike + averagePremium : strike - averagePremium;
  statements.push(
    ...netDeliveredUnderlying(db, { portfolioId: input.portfolioId, instrumentId: instrument.underlying_instrument_id, fillId, signedQuantity: underlyingQuantity, basis: underlyingBasis, strike, reason: "exercise", closedAt: now, lots: underlyingLots }),
    db.prepare("INSERT INTO cash_ledger (id, portfolio_id, event_type, amount, related_entity_type, related_entity_id, description, effective_at, idempotency_key) VALUES (?, ?, 'exercise', ?, 'fill', ?, ?, ?, ?)").bind(crypto.randomUUID(), input.portfolioId, multiplyMoney(-underlyingQuantity, strike), fillId, `${input.quantity} ${instrument.symbol} manually exercised`, now, `manual-exercise:${orderId}`),
    db.prepare("INSERT INTO alerts (id, portfolio_id, severity, event_type, title, message) VALUES (?, ?, 'warning', 'option_exercise', 'American option exercised', ?)").bind(crypto.randomUUID(), input.portfolioId, `${input.quantity} ${instrument.symbol} exercised into ${Math.abs(underlyingQuantity)} ${underlyingSymbol} shares.`),
  );
  await db.batch(statements);
  return { status: "exercised", quantity: input.quantity, underlyingQuantity };
}

export async function placeOrder(input: { portfolioId: string; symbol: string; assetClass: AssetClass; side: "buy" | "sell"; orderType: "market" | "limit" | "stop" | "stop_limit"; quantity: number; limitPrice?: number; stopPrice?: number; timeInForce: "day" | "gtc"; optionContract?: OptionContract; futureContract?: FutureContract; forwardContract?: ForwardContract }) {
  await ensureCoreSchema();
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error("Quantity must be greater than zero.");
  if (input.assetClass === "option" && (!Number.isInteger(input.quantity) || !input.optionContract || !input.optionContract.expiration || !Number.isFinite(input.optionContract.strike) || input.optionContract.strike <= 0)) throw new Error("Options require a valid contract and a whole-number quantity.");
  if (input.assetClass === "future" && (!Number.isInteger(input.quantity) || !input.futureContract)) throw new Error("Futures require a listed contract and a whole-number quantity.");
  if (input.assetClass === "forward" && (!input.forwardContract || !input.forwardContract.deliveryDate || input.forwardContract.deliveryPrice <= 0)) throw new Error("Forwards require a valid delivery date and price.");
  if ((input.orderType === "limit" || input.orderType === "stop_limit") && (!Number.isFinite(input.limitPrice) || Number(input.limitPrice) <= 0)) throw new Error("A positive limit price is required.");
  if ((input.orderType === "stop" || input.orderType === "stop_limit") && (!Number.isFinite(input.stopPrice) || Number(input.stopPrice) <= 0)) throw new Error("A positive stop price is required.");
  const quote = input.assetClass === "option" && input.optionContract ? await getOptionQuote(input.optionContract)
    : input.assetClass === "future" && input.futureContract ? await getFutureQuote(input.futureContract)
    : input.assetClass === "forward" && input.forwardContract ? await getForwardQuote(input.forwardContract)
    : await getMarketQuote(input.symbol, input.assetClass);
  const symbol = input.assetClass === "option" && input.optionContract ? optionSymbol(input.optionContract)
    : input.assetClass === "forward" && input.forwardContract ? forwardSymbol(input.forwardContract)
    : input.symbol.trim().toUpperCase(), instrumentId = `${input.assetClass}:${symbol}`;
  const session = input.assetClass === "equity" || input.assetClass === "option" ? getUsEquitySession() : input.assetClass === "future" ? getCmeSession() : { isOpen: true, nextOpenAt: undefined };
  const estimatedExecution = estimateExecution(quote, input.side, input.quantity);
  const execution = input.assetClass === "forward" && input.forwardContract
    ? { price: input.forwardContract.deliveryPrice, slippage: Number((Math.abs(input.forwardContract.deliveryPrice - Number(quote.mark)) * input.quantity).toFixed(2)), impactBps: 0, model: "custom forward delivery price · zero interest" }
    : estimatedExecution;
  const multiplier = input.assetClass === "option" ? 100 : input.assetClass === "future" && input.futureContract ? input.futureContract.multiplier : 1;
  const [accountResult, currentLots] = await Promise.all([getDashboard(input.portfolioId), openLots(input.portfolioId)]);
  const account = accountResult as { portfolio: { advancedDerivativesEnabled: boolean }; account: { buyingPower: number } };
  const ownedQuantity = currentLots.filter((lot) => lot.instrument_id === instrumentId).reduce((sum, lot) => sum + Number(lot.remaining_quantity), 0);
  const openingQuantity = input.side === "buy"
    ? Math.max(0, input.quantity - Math.max(0, -ownedQuantity))
    : Math.max(0, input.quantity - Math.max(0, ownedQuantity));
  let required = openingQuantity * execution.price * multiplier;
  if (input.assetClass === "option" && input.side === "sell" && input.optionContract) {
    const underlyingId = `equity:${input.optionContract.underlying.toUpperCase()}`;
    const underlyingOwned = currentLots.filter((lot) => lot.instrument_id === underlyingId).reduce((sum, lot) => sum + Number(lot.remaining_quantity), 0);
    const coveredCall = input.optionContract.right === "call" && underlyingOwned >= openingQuantity * 100;
    const cashSecuredPut = input.optionContract.right === "put" && account.account.buyingPower >= openingQuantity * input.optionContract.strike * 100;
    if (!account.portfolio.advancedDerivativesEnabled && openingQuantity > 0 && !coveredCall && !cashSecuredPut) throw new Error("Uncovered short options require Advanced Derivatives on this portfolio.");
    const underlying = await getMarketQuote(input.optionContract.underlying, "equity");
    required = coveredCall ? 0 : cashSecuredPut ? openingQuantity * input.optionContract.strike * 100 : openingQuantity * Number(underlying.mark) * 100 * 0.2;
  }
  if (input.assetClass === "future" && input.futureContract) required = openingQuantity * input.futureContract.initialMargin;
  if (input.assetClass === "forward") required = openingQuantity * execution.price * 0.1;
  if (required > account.account.buyingPower + 0.005) throw new Error(`Insufficient buying power. This order requires approximately $${required.toLocaleString("en-US", { maximumFractionDigits: 2 })}.`);

  const now = new Date().toISOString(), orderId = crypto.randomUUID();
  let status: "scheduled" | "accepted" | "filled" = session.isOpen ? "accepted" : "scheduled";
  const marketable = orderIsMarketable({ side: input.side, orderType: input.orderType, mark: Number(quote.mark), estimatedPrice: execution.price, limitPrice: input.limitPrice, stopPrice: input.stopPrice });
  if (session.isOpen && marketable) status = "filled";
  const db = getD1();
  const statements = [
    db.prepare("INSERT OR IGNORE INTO instruments (id, symbol, display_name, asset_class, exchange, calendar_id) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(instrumentId, symbol, quote.name, input.assetClass, input.assetClass === "crypto" ? "CRYPTO" : "US", input.assetClass === "crypto" ? "24/7" : "XNYS"),
    db.prepare(`INSERT INTO orders (id, portfolio_id, instrument_id, side, order_type, time_in_force, status, quantity, filled_quantity, limit_price, stop_price, scheduled_for, submitted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(orderId, input.portfolioId, instrumentId, input.side, input.orderType, input.timeInForce, status, input.quantity.toString(), status === "filled" ? input.quantity.toString() : "0", input.limitPrice?.toString() ?? null, input.stopPrice?.toString() ?? null, status === "scheduled" ? session.nextOpenAt : null, now, now, now),
  ];

  if (status === "filled") {
    const fillId = crypto.randomUUID();
    statements.push(recordFill(db, { id: fillId, orderId, portfolioId: input.portfolioId, instrumentId, quantity: input.quantity, price: execution.price, slippage: execution.slippage, model: execution.model, executedAt: now, quote, context: "immediate_order" }));
    const signedQuantity = input.side === "buy" ? input.quantity : -input.quantity;
    let remaining = signedQuantity;
    const realizedDerivativeAmounts: string[] = [];
    const opposing = currentLots.filter((lot) => lot.instrument_id === instrumentId && Number(lot.remaining_quantity) * signedQuantity < 0);
    for (const lot of opposing) {
      if (Math.abs(remaining) < 1e-9) break;
      const lotQuantity = Number(lot.remaining_quantity), closed = Math.min(Math.abs(remaining), Math.abs(lotQuantity));
      if (input.assetClass === "future" || input.assetClass === "forward") realizedDerivativeAmounts.push(formatMoney(calculateRealizedPnl({ entryPrice: Number(lot.cost_basis), exitPrice: execution.price, signedOpenQuantity: lotQuantity, closedQuantity: closed, multiplier })));
      const nextLotQuantity = lotQuantity + Math.sign(remaining) * closed;
      remaining -= Math.sign(remaining) * closed;
      statements.push(recordLotClosure(db, { portfolioId: input.portfolioId, lot, closingFillId: fillId, quantity: closed, exitPrice: execution.price, multiplier, reason: "trade", closedAt: now }));
      statements.push(db.prepare("UPDATE position_lots SET remaining_quantity = ?, closed_at = ? WHERE id = ?").bind(nextLotQuantity.toString(), Math.abs(nextLotQuantity) < 1e-9 ? now : null, lot.id));
    }
    if (Math.abs(remaining) > 1e-9) statements.push(db.prepare("INSERT INTO position_lots (id, portfolio_id, instrument_id, opening_fill_id, original_quantity, remaining_quantity, cost_basis, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), input.portfolioId, instrumentId, fillId, remaining.toString(), remaining.toString(), formatMoney(execution.price), now));
    const cashChange = input.assetClass === "future" || input.assetClass === "forward" ? sumMoney(realizedDerivativeAmounts) : multiplyMoney(input.side === "buy" ? -1 : 1, execution.price, input.quantity, multiplier);
    statements.push(db.prepare("INSERT INTO cash_ledger (id, portfolio_id, event_type, amount, related_entity_type, related_entity_id, description, effective_at, idempotency_key) VALUES (?, ?, 'trade', ?, 'fill', ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), input.portfolioId, cashChange, fillId, `${input.side.toUpperCase()} ${input.quantity} ${symbol}`, now, `fill:${fillId}`));
  }
  if (input.assetClass === "option" && input.optionContract) {
    const expirationAt = `${input.optionContract.expiration}T20:00:00.000Z`;
    statements[0] = db.prepare(`INSERT OR IGNORE INTO instruments (id, symbol, display_name, asset_class, exchange, calendar_id, multiplier, underlying_instrument_id, expiration_at, strike, option_right, exercise_style, settlement_type)
      VALUES (?, ?, ?, 'option', 'US', 'XNYS', '100', ?, ?, ?, ?, ?, 'physical')`)
      .bind(instrumentId, symbol, quote.name, `equity:${input.optionContract.underlying.toUpperCase()}`, expirationAt, input.optionContract.strike.toString(), input.optionContract.right, input.optionContract.exerciseStyle);
  }
  if (input.assetClass === "future" && input.futureContract) statements[0] = db.prepare(`INSERT OR IGNORE INTO instruments (id, symbol, display_name, asset_class, exchange, calendar_id, multiplier, expiration_at, first_notice_at, settlement_type)
      VALUES (?, ?, ?, 'future', 'CME', 'CMES', ?, ?, ?, ?)`)
    .bind(instrumentId, symbol, input.futureContract.name, input.futureContract.multiplier.toString(), `${input.futureContract.expiration}T20:00:00.000Z`, input.futureContract.firstNotice ? `${input.futureContract.firstNotice}T20:00:00.000Z` : null, input.futureContract.settlementType);
  if (input.assetClass === "forward" && input.forwardContract) statements[0] = db.prepare(`INSERT OR IGNORE INTO instruments (id, symbol, display_name, asset_class, exchange, calendar_id, multiplier, underlying_instrument_id, expiration_at, strike, settlement_type)
      VALUES (?, ?, ?, 'forward', 'OTC', '24/7', '1', ?, ?, ?, 'cash')`)
    .bind(instrumentId, symbol, quote.name, `${input.forwardContract.underlying.endsWith("-USD") ? "crypto" : "equity"}:${input.forwardContract.underlying.toUpperCase()}`, `${input.forwardContract.deliveryDate}T20:00:00.000Z`, input.forwardContract.deliveryPrice.toString());
  await db.batch(statements);
  return { orderId, status, execution, quote, scheduledFor: status === "scheduled" ? session.nextOpenAt : null };
}
