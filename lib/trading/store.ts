import { ensureCoreSchema, getD1 } from "../../db/runtime";
import type { AssetClass } from "../domain";
import { getUsEquitySession } from "../market/exchange-calendar";
import { estimateExecution, getDemoQuote } from "../market/quotes";

type PortfolioRow = { id: string; name: string; starting_capital: string; benchmark_symbol: string | null; advanced_derivatives_enabled: number; theme: string; created_at: string };
type LotRow = { id: string; instrument_id: string; remaining_quantity: string; cost_basis: string; opened_at: string; symbol: string; display_name: string; asset_class: AssetClass; multiplier: string };

export async function listPortfolios() {
  await ensureCoreSchema();
  const rows = await getD1().prepare("SELECT id, name, starting_capital, benchmark_symbol, advanced_derivatives_enabled, theme, created_at FROM portfolios WHERE status = 'active' ORDER BY created_at").all<PortfolioRow>();
  return rows.results.map((row) => ({ id: row.id, name: row.name, startingCapital: Number(row.starting_capital), benchmarkSymbol: row.benchmark_symbol ?? "SPY", advancedDerivativesEnabled: Boolean(row.advanced_derivatives_enabled), theme: row.theme }));
}

export async function createPortfolio(input: { name: string; startingCapital: number; benchmarkSymbol?: string; advancedDerivativesEnabled?: boolean; theme?: string }) {
  await ensureCoreSchema();
  if (!input.name.trim()) throw new Error("Portfolio name is required.");
  if (!Number.isFinite(input.startingCapital) || input.startingCapital < 1000) throw new Error("Starting capital must be at least $1,000.");
  const id = crypto.randomUUID(), ledgerId = crypto.randomUUID(), now = new Date().toISOString();
  const db = getD1();
  await db.batch([
    db.prepare("INSERT INTO portfolios (id, name, starting_capital, benchmark_symbol, advanced_derivatives_enabled, theme, last_processed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, input.name.trim(), input.startingCapital.toFixed(2), (input.benchmarkSymbol || "SPY").toUpperCase(), input.advancedDerivativesEnabled ? 1 : 0, input.theme || "dark", now, now, now),
    db.prepare("INSERT INTO cash_ledger (id, portfolio_id, event_type, amount, description, effective_at, idempotency_key) VALUES (?, ?, 'initial_capital', ?, ?, ?, ?)")
      .bind(ledgerId, id, input.startingCapital.toFixed(2), "Initial portfolio capital", now, `portfolio:${id}:initial-capital`),
  ]);
  return { id };
}

async function cashBalance(portfolioId: string) {
  const result = await getD1().prepare("SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) AS cash FROM cash_ledger WHERE portfolio_id = ?").bind(portfolioId).first<{ cash: number }>();
  return Number(result?.cash ?? 0);
}

async function openLots(portfolioId: string) {
  const result = await getD1().prepare(`SELECT l.id, l.instrument_id, l.remaining_quantity, l.cost_basis, l.opened_at,
      i.symbol, i.display_name, i.asset_class, i.multiplier
    FROM position_lots l JOIN instruments i ON i.id = l.instrument_id
    WHERE l.portfolio_id = ? AND CAST(l.remaining_quantity AS REAL) != 0 ORDER BY l.opened_at`)
    .bind(portfolioId).all<LotRow>();
  return result.results;
}

export async function getDashboard(portfolioId: string) {
  await ensureCoreSchema();
  const portfolio = await getD1().prepare("SELECT id, name, starting_capital, benchmark_symbol, advanced_derivatives_enabled, theme, created_at FROM portfolios WHERE id = ? AND status = 'active'").bind(portfolioId).first<PortfolioRow>();
  if (!portfolio) throw new Error("Portfolio not found.");
  const [cash, lots, orderResult] = await Promise.all([
    cashBalance(portfolioId), openLots(portfolioId),
    getD1().prepare(`SELECT o.id, o.side, o.order_type, o.status, o.quantity, o.filled_quantity, o.scheduled_for, o.created_at, i.symbol
      FROM orders o JOIN instruments i ON i.id = o.instrument_id WHERE o.portfolio_id = ? ORDER BY o.created_at DESC LIMIT 12`)
      .bind(portfolioId).all<{ id: string; side: string; order_type: string; status: string; quantity: string; filled_quantity: string; scheduled_for: string | null; created_at: string; symbol: string }>(),
  ]);

  const grouped = new Map<string, { symbol: string; name: string; assetClass: AssetClass; quantity: number; basisNumerator: number; multiplier: number }>();
  for (const lot of lots) {
    const quantity = Number(lot.remaining_quantity), multiplier = Number(lot.multiplier);
    const current = grouped.get(lot.instrument_id) ?? { symbol: lot.symbol, name: lot.display_name, assetClass: lot.asset_class, quantity: 0, basisNumerator: 0, multiplier };
    current.quantity += quantity;
    current.basisNumerator += Number(lot.cost_basis) * quantity;
    grouped.set(lot.instrument_id, current);
  }

  let marketValue = 0, grossExposure = 0, maintenanceMargin = 0;
  const positions = [...grouped.values()].filter((position) => Math.abs(position.quantity) > 1e-9).map((position) => {
    const quote = getDemoQuote(position.symbol, position.assetClass);
    const mark = Number(quote.mark), averageCost = position.basisNumerator / position.quantity;
    const value = position.quantity * mark * position.multiplier;
    const pnl = (mark - averageCost) * position.quantity * position.multiplier;
    marketValue += value; grossExposure += Math.abs(value);
    maintenanceMargin += Math.abs(value) * (position.quantity < 0 ? 0.3 : 0.25);
    return { ...position, mark, averageCost, marketValue: value, unrealizedPnl: pnl, quote };
  });
  const netLiquidationValue = cash + marketValue;
  const buyingPower = Math.max(0, netLiquidationValue * 2 - grossExposure);
  const startingCapital = Number(portfolio.starting_capital);
  const totalPnl = netLiquidationValue - startingCapital;
  const session = getUsEquitySession();
  return {
    portfolio: { id: portfolio.id, name: portfolio.name, startingCapital, benchmarkSymbol: portfolio.benchmark_symbol ?? "SPY", advancedDerivativesEnabled: Boolean(portfolio.advanced_derivatives_enabled), theme: portfolio.theme },
    account: { cash, marketValue, netLiquidationValue, totalPnl, totalReturn: startingCapital ? totalPnl / startingCapital : 0, buyingPower, grossExposure, maintenanceMargin, marginUtilization: netLiquidationValue > 0 ? maintenanceMargin / netLiquidationValue : 0 },
    positions, orders: orderResult.results, session,
    quoteStatus: { provider: "Market Madness demonstration feed", quality: "simulated", refreshedAt: new Date().toISOString() },
  };
}

export async function placeOrder(input: { portfolioId: string; symbol: string; assetClass: AssetClass; side: "buy" | "sell"; orderType: "market" | "limit"; quantity: number; limitPrice?: number; timeInForce: "day" | "gtc" }) {
  await ensureCoreSchema();
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error("Quantity must be greater than zero.");
  const quote = getDemoQuote(input.symbol, input.assetClass);
  const symbol = input.symbol.trim().toUpperCase(), instrumentId = `${input.assetClass}:${symbol}`;
  const session = input.assetClass === "equity" || input.assetClass === "option" ? getUsEquitySession() : { isOpen: true, nextOpenAt: undefined };
  const execution = estimateExecution(quote, input.side, input.quantity);
  const [account, currentLots] = await Promise.all([getDashboard(input.portfolioId), openLots(input.portfolioId)]);
  const ownedQuantity = currentLots.filter((lot) => lot.instrument_id === instrumentId).reduce((sum, lot) => sum + Number(lot.remaining_quantity), 0);
  const openingQuantity = input.side === "buy"
    ? Math.max(0, input.quantity - Math.max(0, -ownedQuantity))
    : Math.max(0, input.quantity - Math.max(0, ownedQuantity));
  const required = openingQuantity * execution.price;
  if (required > account.account.buyingPower + 0.005) throw new Error(`Insufficient buying power. This order requires approximately $${required.toLocaleString("en-US", { maximumFractionDigits: 2 })}.`);

  const now = new Date().toISOString(), orderId = crypto.randomUUID();
  let status: "scheduled" | "accepted" | "filled" = session.isOpen ? "accepted" : "scheduled";
  const marketable = input.orderType === "market" || (input.side === "buy" ? Number(input.limitPrice) >= execution.price : Number(input.limitPrice) <= execution.price);
  if (session.isOpen && marketable) status = "filled";
  const db = getD1();
  const statements = [
    db.prepare("INSERT OR IGNORE INTO instruments (id, symbol, display_name, asset_class, exchange, calendar_id) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(instrumentId, symbol, quote.name, input.assetClass, input.assetClass === "equity" ? "US" : "CRYPTO", input.assetClass === "equity" ? "XNYS" : "24/7"),
    db.prepare(`INSERT INTO orders (id, portfolio_id, instrument_id, side, order_type, time_in_force, status, quantity, filled_quantity, limit_price, scheduled_for, submitted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(orderId, input.portfolioId, instrumentId, input.side, input.orderType, input.timeInForce, status, input.quantity.toString(), status === "filled" ? input.quantity.toString() : "0", input.limitPrice?.toString() ?? null, status === "scheduled" ? session.nextOpenAt : null, now, now, now),
  ];

  if (status === "filled") {
    const fillId = crypto.randomUUID();
    statements.push(db.prepare("INSERT INTO fills (id, order_id, portfolio_id, instrument_id, quantity, price, slippage, liquidity_model, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(fillId, orderId, input.portfolioId, instrumentId, input.quantity.toString(), execution.price.toFixed(2), execution.slippage.toFixed(2), execution.model, now));
    const signedQuantity = input.side === "buy" ? input.quantity : -input.quantity;
    let remaining = signedQuantity;
    const opposing = currentLots.filter((lot) => lot.instrument_id === instrumentId && Number(lot.remaining_quantity) * signedQuantity < 0);
    for (const lot of opposing) {
      if (Math.abs(remaining) < 1e-9) break;
      const lotQuantity = Number(lot.remaining_quantity), closed = Math.min(Math.abs(remaining), Math.abs(lotQuantity));
      const nextLotQuantity = lotQuantity + Math.sign(remaining) * closed;
      remaining -= Math.sign(remaining) * closed;
      statements.push(db.prepare("UPDATE position_lots SET remaining_quantity = ?, closed_at = ? WHERE id = ?").bind(nextLotQuantity.toString(), Math.abs(nextLotQuantity) < 1e-9 ? now : null, lot.id));
    }
    if (Math.abs(remaining) > 1e-9) statements.push(db.prepare("INSERT INTO position_lots (id, portfolio_id, instrument_id, opening_fill_id, original_quantity, remaining_quantity, cost_basis, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), input.portfolioId, instrumentId, fillId, remaining.toString(), remaining.toString(), execution.price.toFixed(2), now));
    const cashChange = (input.side === "buy" ? -1 : 1) * execution.price * input.quantity;
    statements.push(db.prepare("INSERT INTO cash_ledger (id, portfolio_id, event_type, amount, related_entity_type, related_entity_id, description, effective_at, idempotency_key) VALUES (?, ?, 'trade', ?, 'fill', ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), input.portfolioId, cashChange.toFixed(2), fillId, `${input.side.toUpperCase()} ${input.quantity} ${symbol}`, now, `fill:${fillId}`));
  }
  await db.batch(statements);
  return { orderId, status, execution, quote, scheduledFor: status === "scheduled" ? session.nextOpenAt : null };
}
