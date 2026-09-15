import { ensureCoreSchema, getD1 } from "../../db/runtime";
import type { AssetClass } from "../domain";
import { getUsEquitySession } from "../market/exchange-calendar";
import type { ForwardContract, FutureContract } from "../market/derivatives";
import { findFuture, forwardSymbol, getCmeSession, getForwardQuote, getFutureQuote } from "../market/derivatives";
import type { OptionContract } from "../market/options";
import { getOptionQuote, optionSymbol } from "../market/options";
import { estimateExecution, getMarketQuote } from "../market/quotes";

type PortfolioRow = { id: string; name: string; starting_capital: string; benchmark_symbol: string | null; advanced_derivatives_enabled: number; theme: string; created_at: string };
type LotRow = { id: string; instrument_id: string; remaining_quantity: string; cost_basis: string; opened_at: string; symbol: string; display_name: string; asset_class: AssetClass; multiplier: string; underlying_instrument_id: string | null; expiration_at: string | null; first_notice_at: string | null; strike: string | null; option_right: "call" | "put" | null; exercise_style: "american" | "european" | null; settlement_type: "cash" | "physical" | null };

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
      .bind(id, input.name.trim(), input.startingCapital.toFixed(2), null, input.advancedDerivativesEnabled ? 1 : 0, input.theme || "dark", now, now, now),
    db.prepare("INSERT INTO cash_ledger (id, portfolio_id, event_type, amount, description, effective_at, idempotency_key) VALUES (?, ?, 'initial_capital', ?, ?, ?, ?)")
      .bind(ledgerId, id, input.startingCapital.toFixed(2), "Initial portfolio capital", now, `portfolio:${id}:initial-capital`),
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
  await getD1().prepare("INSERT INTO cash_ledger (id, portfolio_id, event_type, amount, description, effective_at, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, direction, signedAmount.toFixed(2), direction === "deposit" ? "Cash deposit" : "Cash withdrawal", now, `cash-transfer:${crypto.randomUUID()}`).run();
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
    db.prepare("DELETE FROM alerts WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM portfolio_snapshots WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM portfolio_benchmarks WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM allocations WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM processing_events WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM cash_ledger WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM position_lots WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM fills WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM order_legs WHERE order_id IN (SELECT id FROM orders WHERE portfolio_id = ?)").bind(portfolioId),
    db.prepare("DELETE FROM orders WHERE portfolio_id = ?").bind(portfolioId),
    db.prepare("DELETE FROM portfolios WHERE id = ?").bind(portfolioId),
  ]);
  return { portfolioId, status: "deleted" };
}

async function cashBalance(portfolioId: string) {
  const result = await getD1().prepare("SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) AS cash FROM cash_ledger WHERE portfolio_id = ?").bind(portfolioId).first<{ cash: number }>();
  return Number(result?.cash ?? 0);
}

async function openLots(portfolioId: string) {
  const result = await getD1().prepare(`SELECT l.id, l.instrument_id, l.remaining_quantity, l.cost_basis, l.opened_at,
      i.symbol, i.display_name, i.asset_class, i.multiplier, i.underlying_instrument_id, i.expiration_at, i.first_notice_at, i.strike, i.option_right, i.exercise_style, i.settlement_type
    FROM position_lots l JOIN instruments i ON i.id = l.instrument_id
    WHERE l.portfolio_id = ? AND CAST(l.remaining_quantity AS REAL) != 0 ORDER BY l.opened_at`)
    .bind(portfolioId).all<LotRow>();
  return result.results;
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
    WHERE o.portfolio_id = ? AND o.status IN ('scheduled', 'accepted', 'submitted')`).bind(portfolioId).all<ActiveOrderRow>();
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
  return reserved;
}

async function processActiveOrders(portfolioId: string) {
  const equitySession = getUsEquitySession(), cmeSession = getCmeSession(), now = new Date().toISOString(), db = getD1();
  const result = await db.prepare(`SELECT o.id, o.instrument_id, o.side, o.order_type, o.time_in_force, o.quantity, o.limit_price, o.stop_price,
      i.symbol, i.display_name, i.asset_class, i.multiplier, i.underlying_instrument_id, i.expiration_at, i.strike, i.option_right, i.exercise_style
    FROM orders o JOIN instruments i ON i.id = o.instrument_id
    WHERE o.portfolio_id = ? AND (o.status = 'accepted' OR (o.status = 'scheduled' AND o.scheduled_for <= ?)) ORDER BY o.created_at`)
    .bind(portfolioId, now).all<ActiveOrderRow>();
  for (const order of result.results) {
    if ((order.asset_class === "equity" || order.asset_class === "option") && !equitySession.isOpen) continue;
    if (order.asset_class === "future" && !cmeSession.isOpen) continue;
    const quote = await quoteForInstrument(order), execution = estimateExecution(quote, order.side, Number(order.quantity));
    const stopTriggered = order.order_type === "stop" || order.order_type === "stop_limit" ? (order.side === "buy" ? Number(quote.mark) >= Number(order.stop_price) : Number(quote.mark) <= Number(order.stop_price)) : true;
    const limitSatisfied = order.order_type === "limit" || order.order_type === "stop_limit" ? (order.side === "buy" ? Number(order.limit_price) >= execution.price : Number(order.limit_price) <= execution.price) : true;
    const marketable = stopTriggered && limitSatisfied;
    if (!marketable) {
      await db.prepare("UPDATE orders SET status = 'accepted', scheduled_for = NULL, updated_at = ? WHERE id = ?").bind(now, order.id).run();
      continue;
    }
    const fillId = crypto.randomUUID(), quantity = Number(order.quantity), signedQuantity = order.side === "buy" ? quantity : -quantity;
    const lots = await openLots(portfolioId), statements = [
      db.prepare("UPDATE orders SET status = 'filled', filled_quantity = quantity, scheduled_for = NULL, updated_at = ? WHERE id = ?").bind(now, order.id),
      db.prepare("INSERT INTO fills (id, order_id, portfolio_id, instrument_id, quantity, price, slippage, liquidity_model, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(fillId, order.id, portfolioId, order.instrument_id, quantity.toString(), execution.price.toFixed(2), execution.slippage.toFixed(2), `${execution.model} · queued evaluation`, now),
    ];
    let remaining = signedQuantity, realizedDerivativePnl = 0;
    for (const lot of lots.filter((item) => item.instrument_id === order.instrument_id && Number(item.remaining_quantity) * signedQuantity < 0)) {
      if (Math.abs(remaining) < 1e-9) break;
      const lotQuantity = Number(lot.remaining_quantity), closed = Math.min(Math.abs(remaining), Math.abs(lotQuantity));
      if (order.asset_class === "future" || order.asset_class === "forward") realizedDerivativePnl += (execution.price - Number(lot.cost_basis)) * Math.sign(lotQuantity) * closed * Number(order.multiplier);
      const nextLotQuantity = lotQuantity + Math.sign(remaining) * closed;
      remaining -= Math.sign(remaining) * closed;
      statements.push(db.prepare("UPDATE position_lots SET remaining_quantity = ?, closed_at = ? WHERE id = ?").bind(nextLotQuantity.toString(), Math.abs(nextLotQuantity) < 1e-9 ? now : null, lot.id));
    }
    if (Math.abs(remaining) > 1e-9) statements.push(db.prepare("INSERT INTO position_lots (id, portfolio_id, instrument_id, opening_fill_id, original_quantity, remaining_quantity, cost_basis, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, order.instrument_id, fillId, remaining.toString(), remaining.toString(), execution.price.toFixed(2), now));
    const cashChange = order.asset_class === "future" || order.asset_class === "forward" ? realizedDerivativePnl : (order.side === "buy" ? -1 : 1) * execution.price * quantity * Number(order.multiplier);
    statements.push(db.prepare("INSERT INTO cash_ledger (id, portfolio_id, event_type, amount, related_entity_type, related_entity_id, description, effective_at, idempotency_key) VALUES (?, ?, 'trade', ?, 'fill', ?, ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, cashChange.toFixed(2), fillId, `${order.side.toUpperCase()} ${quantity} ${order.symbol} · queued fill`, now, `fill:${fillId}`));
    await db.batch(statements);
  }
}

export async function cancelOrder(portfolioId: string, orderId: string) {
  await ensureCoreSchema();
  const result = await getD1().prepare("UPDATE orders SET status = 'canceled', scheduled_for = NULL, updated_at = ? WHERE id = ? AND portfolio_id = ? AND status IN ('scheduled', 'accepted', 'submitted')").bind(new Date().toISOString(), orderId, portfolioId).run();
  if (!result.meta.changes) throw new Error("Only active or queued orders can be canceled.");
  return { orderId, status: "canceled" };
}

async function processOptionExpirations(portfolioId: string) {
  const db = getD1(), now = new Date().toISOString();
  const result = await db.prepare(`SELECT l.id, l.remaining_quantity, i.id AS instrument_id, i.symbol, i.underlying_instrument_id,
      i.expiration_at, i.strike, i.option_right, i.exercise_style
    FROM position_lots l JOIN instruments i ON i.id = l.instrument_id
    WHERE l.portfolio_id = ? AND i.asset_class = 'option' AND CAST(l.remaining_quantity AS REAL) != 0 AND i.expiration_at <= ?`)
    .bind(portfolioId, now).all<{ id: string; remaining_quantity: string; instrument_id: string; symbol: string; underlying_instrument_id: string; expiration_at: string; strike: string; option_right: "call" | "put"; exercise_style: string }>();
  for (const lot of result.results) {
    const underlyingSymbol = lot.underlying_instrument_id.replace("equity:", ""), underlyingQuote = await getMarketQuote(underlyingSymbol, "equity");
    const strike = Number(lot.strike), spot = Number(underlyingQuote.mark), optionQuantity = Number(lot.remaining_quantity);
    const intrinsic = lot.option_right === "call" ? spot - strike : strike - spot;
    if (intrinsic < 0.01) {
      await db.batch([
        db.prepare("UPDATE position_lots SET remaining_quantity = '0', closed_at = ? WHERE id = ?").bind(now, lot.id),
        db.prepare("INSERT INTO alerts (id, portfolio_id, severity, event_type, title, message) VALUES (?, ?, 'info', 'option_expiration', 'Option expired', ?)").bind(crypto.randomUUID(), portfolioId, `${lot.symbol} expired out of the money.`),
      ]);
      continue;
    }
    const underlyingQuantity = (lot.option_right === "call" ? 1 : -1) * optionQuantity * 100;
    const side = underlyingQuantity > 0 ? "buy" : "sell", absoluteQuantity = Math.abs(underlyingQuantity);
    const orderId = crypto.randomUUID(), fillId = crypto.randomUUID(), underlyingId = `equity:${underlyingSymbol}`;
    const statements = [
      db.prepare("INSERT OR IGNORE INTO instruments (id, symbol, display_name, asset_class, exchange, calendar_id) VALUES (?, ?, ?, 'equity', 'US', 'XNYS')").bind(underlyingId, underlyingSymbol, underlyingQuote.name),
      db.prepare(`INSERT INTO orders (id, portfolio_id, instrument_id, side, order_type, time_in_force, status, quantity, filled_quantity, reconstruction_status, submitted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'market', 'day', 'filled', ?, ?, 'reconstructed', ?, ?, ?)`)
        .bind(orderId, portfolioId, underlyingId, side, absoluteQuantity.toString(), absoluteQuantity.toString(), lot.expiration_at, now, now),
      db.prepare("INSERT INTO fills (id, order_id, portfolio_id, instrument_id, quantity, price, slippage, liquidity_model, executed_at) VALUES (?, ?, ?, ?, ?, ?, '0', 'automatic option exercise/assignment', ?)").bind(fillId, orderId, portfolioId, underlyingId, absoluteQuantity.toString(), strike.toFixed(2), lot.expiration_at),
      db.prepare("INSERT INTO position_lots (id, portfolio_id, instrument_id, opening_fill_id, original_quantity, remaining_quantity, cost_basis, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, underlyingId, fillId, underlyingQuantity.toString(), underlyingQuantity.toString(), strike.toFixed(2), lot.expiration_at),
      db.prepare("UPDATE position_lots SET remaining_quantity = '0', closed_at = ? WHERE id = ?").bind(lot.expiration_at, lot.id),
      db.prepare("INSERT INTO cash_ledger (id, portfolio_id, event_type, amount, related_entity_type, related_entity_id, description, effective_at, idempotency_key) VALUES (?, ?, ?, ?, 'fill', ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), portfolioId, optionQuantity > 0 ? "exercise" : "assignment", (-underlyingQuantity * strike).toFixed(2), fillId, `${lot.symbol} automatic ${optionQuantity > 0 ? "exercise" : "assignment"}`, lot.expiration_at, `option-expiry:${lot.id}`),
      db.prepare("INSERT INTO alerts (id, portfolio_id, severity, event_type, title, message) VALUES (?, ?, 'warning', 'option_expiration', 'Option lifecycle processed', ?)").bind(crypto.randomUUID(), portfolioId, `${lot.symbol} was automatically ${optionQuantity > 0 ? "exercised" : "assigned"} at expiry.`),
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
    const quantity = Number(lot.remaining_quantity), pnl = (Number(quote.mark) - Number(lot.cost_basis)) * quantity * Number(lot.multiplier);
    const reason = lot.asset_class === "future" && lot.settlement_type === "physical" && lot.first_notice_at && lot.first_notice_at <= noticeCutoff ? "first-notice safeguard" : "contract settlement";
    await db.batch([
      db.prepare("UPDATE position_lots SET remaining_quantity = '0', closed_at = ? WHERE id = ?").bind(nowIso, lot.id),
      db.prepare("INSERT INTO cash_ledger (id, portfolio_id, event_type, amount, related_entity_type, related_entity_id, description, effective_at, idempotency_key) VALUES (?, ?, 'settlement', ?, 'position_lot', ?, ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, pnl.toFixed(2), lot.id, `${lot.symbol} ${reason}`, nowIso, `derivative-settlement:${lot.id}`),
      db.prepare("INSERT INTO alerts (id, portfolio_id, severity, event_type, title, message) VALUES (?, ?, 'warning', 'derivative_settlement', 'Derivative position closed', ?)").bind(crypto.randomUUID(), portfolioId, `${lot.symbol} closed by the ${reason}. Realized P&L: $${pnl.toFixed(2)}.`),
    ]);
  }
}

async function forceMarginLiquidation(portfolioId: string, equity: number, maintenance: number, lots: LotRow[]) {
  const db = getD1(), now = new Date().toISOString();
  let remainingMaintenance = maintenance;
  for (const lot of [...lots].sort((left, right) => Math.abs(Number(right.remaining_quantity) * Number(right.multiplier)) - Math.abs(Number(left.remaining_quantity) * Number(left.multiplier)))) {
    if (equity >= remainingMaintenance * 1.1) break;
    const quantity = Math.abs(Number(lot.remaining_quantity)), side: "buy" | "sell" = Number(lot.remaining_quantity) > 0 ? "sell" : "buy";
    const quote = lot.asset_class === "option" && lot.expiration_at && lot.strike && lot.option_right && lot.exercise_style
      ? await getOptionQuote({ underlying: (lot.underlying_instrument_id || "equity:SPY").replace("equity:", ""), expiration: lot.expiration_at.slice(0, 10), strike: Number(lot.strike), right: lot.option_right, exerciseStyle: lot.exercise_style })
      : lot.asset_class === "future" && findFuture(lot.symbol) ? await getFutureQuote(findFuture(lot.symbol)!)
      : lot.asset_class === "forward" && lot.expiration_at && lot.strike && lot.underlying_instrument_id ? await getForwardQuote({ underlying: lot.underlying_instrument_id.replace(/^(equity|crypto):/, ""), deliveryDate: lot.expiration_at.slice(0, 10), deliveryPrice: Number(lot.strike), quantityUnit: "units" })
      : await getMarketQuote(lot.symbol, lot.asset_class);
    const execution = estimateExecution(quote, side, quantity), multiplier = Number(lot.multiplier), orderId = crypto.randomUUID(), fillId = crypto.randomUUID();
    const realized = (execution.price - Number(lot.cost_basis)) * Math.sign(Number(lot.remaining_quantity)) * quantity * multiplier;
    const cashChange = lot.asset_class === "future" || lot.asset_class === "forward" ? realized : (side === "buy" ? -1 : 1) * execution.price * quantity * multiplier;
    const relief = lot.asset_class === "future" && findFuture(lot.symbol) ? quantity * findFuture(lot.symbol)!.maintenanceMargin : Math.abs(execution.price * quantity * multiplier) * (Number(lot.remaining_quantity) < 0 ? 0.3 : lot.asset_class === "forward" ? 0.1 : 0.25);
    await db.batch([
      db.prepare(`INSERT INTO orders (id, portfolio_id, instrument_id, side, order_type, time_in_force, status, quantity, filled_quantity, submitted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'market', 'day', 'filled', ?, ?, ?, ?, ?)`)
        .bind(orderId, portfolioId, lot.instrument_id, side, quantity.toString(), quantity.toString(), now, now, now),
      db.prepare("INSERT INTO fills (id, order_id, portfolio_id, instrument_id, quantity, price, slippage, liquidity_model, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'forced margin liquidation', ?)").bind(fillId, orderId, portfolioId, lot.instrument_id, quantity.toString(), execution.price.toFixed(2), execution.slippage.toFixed(2), now),
      db.prepare("UPDATE position_lots SET remaining_quantity = '0', closed_at = ? WHERE id = ?").bind(now, lot.id),
      db.prepare("INSERT INTO cash_ledger (id, portfolio_id, event_type, amount, related_entity_type, related_entity_id, description, effective_at, idempotency_key) VALUES (?, ?, 'trade', ?, 'fill', ?, ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, cashChange.toFixed(2), fillId, `${lot.symbol} forced liquidation`, now, `forced-liquidation:${lot.id}`),
      db.prepare("INSERT INTO alerts (id, portfolio_id, severity, event_type, title, message) VALUES (?, ?, 'critical', 'forced_liquidation', 'Margin liquidation executed', ?)").bind(crypto.randomUUID(), portfolioId, `${quantity} ${lot.symbol} liquidated to restore the 110% maintenance buffer.`),
    ]);
    remainingMaintenance = Math.max(0, remainingMaintenance - relief);
  }
}

export async function getDashboard(portfolioId: string, afterLiquidation = false): Promise<Record<string, unknown>> {
  await ensureCoreSchema();
  await processDerivativeSettlements(portfolioId);
  await processOptionExpirations(portfolioId);
  await processActiveOrders(portfolioId);
  const portfolio = await getD1().prepare("SELECT id, name, starting_capital, benchmark_symbol, advanced_derivatives_enabled, theme, created_at FROM portfolios WHERE id = ? AND status = 'active'").bind(portfolioId).first<PortfolioRow>();
  if (!portfolio) throw new Error("Portfolio not found.");
  const [cash, lots, orderResult] = await Promise.all([
    cashBalance(portfolioId), openLots(portfolioId),
    getD1().prepare(`SELECT o.id, o.side, o.order_type, o.status, o.quantity, o.filled_quantity, o.scheduled_for, o.created_at, i.symbol
      FROM orders o JOIN instruments i ON i.id = o.instrument_id WHERE o.portfolio_id = ? ORDER BY o.created_at DESC LIMIT 12`)
      .bind(portfolioId).all<{ id: string; side: string; order_type: string; status: string; quantity: string; filled_quantity: string; scheduled_for: string | null; created_at: string; symbol: string }>(),
  ]);

  const grouped = new Map<string, { symbol: string; name: string; assetClass: AssetClass; quantity: number; basisNumerator: number; multiplier: number; optionContract?: OptionContract; futureContract?: FutureContract; forwardContract?: ForwardContract }>();
  for (const lot of lots) {
    const quantity = Number(lot.remaining_quantity), multiplier = Number(lot.multiplier);
    const optionContract = lot.asset_class === "option" && lot.expiration_at && lot.strike && lot.option_right && lot.exercise_style
      ? { underlying: (lot.underlying_instrument_id || "equity:SPY").replace("equity:", ""), expiration: lot.expiration_at.slice(0, 10), strike: Number(lot.strike), right: lot.option_right, exerciseStyle: lot.exercise_style }
      : undefined;
    const futureContract = lot.asset_class === "future" ? findFuture(lot.symbol) : undefined;
    const forwardContract = lot.asset_class === "forward" && lot.expiration_at && lot.strike && lot.underlying_instrument_id
      ? { underlying: lot.underlying_instrument_id.replace(/^(equity|crypto):/, ""), deliveryDate: lot.expiration_at.slice(0, 10), deliveryPrice: Number(lot.strike), quantityUnit: "units" }
      : undefined;
    const current = grouped.get(lot.instrument_id) ?? { symbol: lot.symbol, name: lot.display_name, assetClass: lot.asset_class, quantity: 0, basisNumerator: 0, multiplier, optionContract, futureContract, forwardContract };
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
      : position.assetClass === "forward" ? Math.abs(value) * 0.1 : Math.abs(value) * (position.quantity < 0 ? 0.3 : 0.25);
    return { ...position, mark, averageCost, marketValue: value, unrealizedPnl: pnl, quote };
  }));
  const netLiquidationValue = cash + marketValue;
  const reservedForOrders = await reservedBuyingPower(portfolioId);
  const buyingPower = Math.max(0, netLiquidationValue * 2 - grossExposure - reservedForOrders);
  const startingCapital = Number(portfolio.starting_capital);
  const totalPnl = netLiquidationValue - startingCapital;
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
    .bind(crypto.randomUUID(), portfolioId, snapshotDate, netLiquidationValue.toFixed(2), cash.toFixed(2), realizedPnl.toFixed(2), unrealizedPnl.toFixed(2), maintenanceMargin.toFixed(2), buyingPower.toFixed(2)).run();
  const [snapshotResult, alertResult] = await Promise.all([
    getD1().prepare("SELECT snapshot_date, net_liquidation_value, realized_pnl, unrealized_pnl FROM portfolio_snapshots WHERE portfolio_id = ? ORDER BY snapshot_date DESC LIMIT 30").bind(portfolioId).all<{ snapshot_date: string; net_liquidation_value: string; realized_pnl: string; unrealized_pnl: string }>(),
    getD1().prepare("SELECT id, severity, event_type, title, message, created_at FROM alerts WHERE portfolio_id = ? ORDER BY created_at DESC LIMIT 12").bind(portfolioId).all<{ id: string; severity: string; event_type: string; title: string; message: string; created_at: string }>(),
  ]);
  const largestPosition = positions.reduce<{ symbol: string; value: number } | null>((largest, position) => !largest || Math.abs(position.marketValue) > largest.value ? { symbol: position.symbol, value: Math.abs(position.marketValue) } : largest, null);
  const estimatedDailyVar = positions.reduce((sum, position) => sum + Math.abs(position.marketValue) * (position.assetClass === "crypto" ? 0.05 : position.assetClass === "option" ? 0.08 : position.assetClass === "future" ? 0.025 : 0.018), 0);
  return {
    portfolio: { id: portfolio.id, name: portfolio.name, startingCapital, advancedDerivativesEnabled: Boolean(portfolio.advanced_derivatives_enabled), theme: portfolio.theme },
    account: { cash, marketValue, netLiquidationValue, totalPnl, totalReturn: startingCapital ? totalPnl / startingCapital : 0, buyingPower, reservedBuyingPower: reservedForOrders, grossExposure, maintenanceMargin, marginUtilization: netLiquidationValue > 0 ? maintenanceMargin / netLiquidationValue : 0 },
    positions, orders: orderResult.results, benchmarks: await getBenchmarks(portfolioId), allocations: await getAllocations(portfolioId), session,
    pnlHistory: snapshotResult.results.map((item) => ({ date: item.snapshot_date, netLiquidationValue: Number(item.net_liquidation_value), realizedPnl: Number(item.realized_pnl), unrealizedPnl: Number(item.unrealized_pnl) })).reverse(),
    risk: { leverage: netLiquidationValue > 0 ? grossExposure / netLiquidationValue : 0, estimatedDailyVar, largestPosition: largestPosition ? { ...largestPosition, concentration: grossExposure ? largestPosition.value / grossExposure : 0 } : null },
    alerts: alertResult.results,
    quoteStatus: { provider: positions[0]?.quote.provider || "Provider routing active", quality: positions[0]?.quote.quality || "ready", refreshedAt: new Date().toISOString() },
  };
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
  const stopTriggered = input.orderType === "stop" || input.orderType === "stop_limit" ? (input.side === "buy" ? Number(quote.mark) >= Number(input.stopPrice) : Number(quote.mark) <= Number(input.stopPrice)) : true;
  const limitSatisfied = input.orderType === "limit" || input.orderType === "stop_limit" ? (input.side === "buy" ? Number(input.limitPrice) >= execution.price : Number(input.limitPrice) <= execution.price) : true;
  const marketable = stopTriggered && limitSatisfied;
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
    statements.push(db.prepare("INSERT INTO fills (id, order_id, portfolio_id, instrument_id, quantity, price, slippage, liquidity_model, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(fillId, orderId, input.portfolioId, instrumentId, input.quantity.toString(), execution.price.toFixed(2), execution.slippage.toFixed(2), execution.model, now));
    const signedQuantity = input.side === "buy" ? input.quantity : -input.quantity;
    let remaining = signedQuantity, realizedDerivativePnl = 0;
    const opposing = currentLots.filter((lot) => lot.instrument_id === instrumentId && Number(lot.remaining_quantity) * signedQuantity < 0);
    for (const lot of opposing) {
      if (Math.abs(remaining) < 1e-9) break;
      const lotQuantity = Number(lot.remaining_quantity), closed = Math.min(Math.abs(remaining), Math.abs(lotQuantity));
      if (input.assetClass === "future" || input.assetClass === "forward") realizedDerivativePnl += (execution.price - Number(lot.cost_basis)) * Math.sign(lotQuantity) * closed * multiplier;
      const nextLotQuantity = lotQuantity + Math.sign(remaining) * closed;
      remaining -= Math.sign(remaining) * closed;
      statements.push(db.prepare("UPDATE position_lots SET remaining_quantity = ?, closed_at = ? WHERE id = ?").bind(nextLotQuantity.toString(), Math.abs(nextLotQuantity) < 1e-9 ? now : null, lot.id));
    }
    if (Math.abs(remaining) > 1e-9) statements.push(db.prepare("INSERT INTO position_lots (id, portfolio_id, instrument_id, opening_fill_id, original_quantity, remaining_quantity, cost_basis, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), input.portfolioId, instrumentId, fillId, remaining.toString(), remaining.toString(), execution.price.toFixed(2), now));
    const cashChange = input.assetClass === "future" || input.assetClass === "forward" ? realizedDerivativePnl : (input.side === "buy" ? -1 : 1) * execution.price * input.quantity * multiplier;
    statements.push(db.prepare("INSERT INTO cash_ledger (id, portfolio_id, event_type, amount, related_entity_type, related_entity_id, description, effective_at, idempotency_key) VALUES (?, ?, 'trade', ?, 'fill', ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), input.portfolioId, cashChange.toFixed(2), fillId, `${input.side.toUpperCase()} ${input.quantity} ${symbol}`, now, `fill:${fillId}`));
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
