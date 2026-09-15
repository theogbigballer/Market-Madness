import { ensureCoreSchema, getD1 } from "../../db/runtime";
import type { AssetClass } from "../domain";
import { getUsEquitySession } from "../market/exchange-calendar";
import type { OptionContract } from "../market/options";
import { getOptionQuote, optionSymbol } from "../market/options";
import { estimateExecution, getMarketQuote } from "../market/quotes";

type PortfolioRow = { id: string; name: string; starting_capital: string; benchmark_symbol: string | null; advanced_derivatives_enabled: number; theme: string; created_at: string };
type LotRow = { id: string; instrument_id: string; remaining_quantity: string; cost_basis: string; opened_at: string; symbol: string; display_name: string; asset_class: AssetClass; multiplier: string; underlying_instrument_id: string | null; expiration_at: string | null; strike: string | null; option_right: "call" | "put" | null; exercise_style: "american" | "european" | null };

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

async function cashBalance(portfolioId: string) {
  const result = await getD1().prepare("SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) AS cash FROM cash_ledger WHERE portfolio_id = ?").bind(portfolioId).first<{ cash: number }>();
  return Number(result?.cash ?? 0);
}

async function openLots(portfolioId: string) {
  const result = await getD1().prepare(`SELECT l.id, l.instrument_id, l.remaining_quantity, l.cost_basis, l.opened_at,
      i.symbol, i.display_name, i.asset_class, i.multiplier, i.underlying_instrument_id, i.expiration_at, i.strike, i.option_right, i.exercise_style
    FROM position_lots l JOIN instruments i ON i.id = l.instrument_id
    WHERE l.portfolio_id = ? AND CAST(l.remaining_quantity AS REAL) != 0 ORDER BY l.opened_at`)
    .bind(portfolioId).all<LotRow>();
  return result.results;
}

type ActiveOrderRow = { id: string; instrument_id: string; side: "buy" | "sell"; order_type: "market" | "limit"; time_in_force: "day" | "gtc"; quantity: string; limit_price: string | null; symbol: string; display_name: string; asset_class: AssetClass; multiplier: string; underlying_instrument_id: string | null; expiration_at: string | null; strike: string | null; option_right: "call" | "put" | null; exercise_style: "american" | "european" | null };

async function quoteForInstrument(order: ActiveOrderRow) {
  if (order.asset_class === "option" && order.expiration_at && order.strike && order.option_right && order.exercise_style) {
    return getOptionQuote({ underlying: (order.underlying_instrument_id || "equity:SPY").replace("equity:", ""), expiration: order.expiration_at.slice(0, 10), strike: Number(order.strike), right: order.option_right, exerciseStyle: order.exercise_style });
  }
  return getMarketQuote(order.symbol, order.asset_class);
}

async function reservedBuyingPower(portfolioId: string) {
  const result = await getD1().prepare(`SELECT o.id, o.instrument_id, o.side, o.order_type, o.time_in_force, o.quantity, o.limit_price,
      i.symbol, i.display_name, i.asset_class, i.multiplier, i.underlying_instrument_id, i.expiration_at, i.strike, i.option_right, i.exercise_style
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
    } else reserved += Number(order.limit_price || quote.ask || quote.mark) * quantity * multiplier;
  }
  return reserved;
}

async function processActiveOrders(portfolioId: string) {
  const session = getUsEquitySession(), now = new Date().toISOString(), db = getD1();
  if (!session.isOpen) {
    await db.prepare("UPDATE orders SET status = 'expired', updated_at = ? WHERE portfolio_id = ? AND status = 'accepted' AND time_in_force = 'day'").bind(now, portfolioId).run();
    return;
  }
  const result = await db.prepare(`SELECT o.id, o.instrument_id, o.side, o.order_type, o.time_in_force, o.quantity, o.limit_price,
      i.symbol, i.display_name, i.asset_class, i.multiplier, i.underlying_instrument_id, i.expiration_at, i.strike, i.option_right, i.exercise_style
    FROM orders o JOIN instruments i ON i.id = o.instrument_id
    WHERE o.portfolio_id = ? AND (o.status = 'accepted' OR (o.status = 'scheduled' AND o.scheduled_for <= ?)) ORDER BY o.created_at`)
    .bind(portfolioId, now).all<ActiveOrderRow>();
  for (const order of result.results) {
    const quote = await quoteForInstrument(order), execution = estimateExecution(quote, order.side, Number(order.quantity));
    const marketable = order.order_type === "market" || (order.side === "buy" ? Number(order.limit_price) >= execution.price : Number(order.limit_price) <= execution.price);
    if (!marketable) {
      await db.prepare("UPDATE orders SET status = 'accepted', scheduled_for = NULL, updated_at = ? WHERE id = ?").bind(now, order.id).run();
      continue;
    }
    const fillId = crypto.randomUUID(), quantity = Number(order.quantity), signedQuantity = order.side === "buy" ? quantity : -quantity;
    const lots = await openLots(portfolioId), statements = [
      db.prepare("UPDATE orders SET status = 'filled', filled_quantity = quantity, scheduled_for = NULL, updated_at = ? WHERE id = ?").bind(now, order.id),
      db.prepare("INSERT INTO fills (id, order_id, portfolio_id, instrument_id, quantity, price, slippage, liquidity_model, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(fillId, order.id, portfolioId, order.instrument_id, quantity.toString(), execution.price.toFixed(2), execution.slippage.toFixed(2), `${execution.model} · queued evaluation`, now),
    ];
    let remaining = signedQuantity;
    for (const lot of lots.filter((item) => item.instrument_id === order.instrument_id && Number(item.remaining_quantity) * signedQuantity < 0)) {
      if (Math.abs(remaining) < 1e-9) break;
      const lotQuantity = Number(lot.remaining_quantity), closed = Math.min(Math.abs(remaining), Math.abs(lotQuantity));
      const nextLotQuantity = lotQuantity + Math.sign(remaining) * closed;
      remaining -= Math.sign(remaining) * closed;
      statements.push(db.prepare("UPDATE position_lots SET remaining_quantity = ?, closed_at = ? WHERE id = ?").bind(nextLotQuantity.toString(), Math.abs(nextLotQuantity) < 1e-9 ? now : null, lot.id));
    }
    if (Math.abs(remaining) > 1e-9) statements.push(db.prepare("INSERT INTO position_lots (id, portfolio_id, instrument_id, opening_fill_id, original_quantity, remaining_quantity, cost_basis, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, order.instrument_id, fillId, remaining.toString(), remaining.toString(), execution.price.toFixed(2), now));
    const cashChange = (order.side === "buy" ? -1 : 1) * execution.price * quantity * Number(order.multiplier);
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

export async function getDashboard(portfolioId: string) {
  await ensureCoreSchema();
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

  const grouped = new Map<string, { symbol: string; name: string; assetClass: AssetClass; quantity: number; basisNumerator: number; multiplier: number; contract?: OptionContract }>();
  for (const lot of lots) {
    const quantity = Number(lot.remaining_quantity), multiplier = Number(lot.multiplier);
    const contract = lot.asset_class === "option" && lot.expiration_at && lot.strike && lot.option_right && lot.exercise_style
      ? { underlying: (lot.underlying_instrument_id || "equity:SPY").replace("equity:", ""), expiration: lot.expiration_at.slice(0, 10), strike: Number(lot.strike), right: lot.option_right, exerciseStyle: lot.exercise_style }
      : undefined;
    const current = grouped.get(lot.instrument_id) ?? { symbol: lot.symbol, name: lot.display_name, assetClass: lot.asset_class, quantity: 0, basisNumerator: 0, multiplier, contract };
    current.quantity += quantity;
    current.basisNumerator += Number(lot.cost_basis) * quantity;
    grouped.set(lot.instrument_id, current);
  }

  let marketValue = 0, grossExposure = 0, maintenanceMargin = 0;
  const positions = await Promise.all([...grouped.values()].filter((position) => Math.abs(position.quantity) > 1e-9).map(async (position) => {
    const quote = position.assetClass === "option" && position.contract ? await getOptionQuote(position.contract) : await getMarketQuote(position.symbol, position.assetClass);
    const mark = Number(quote.mark), averageCost = position.basisNumerator / position.quantity;
    const value = position.quantity * mark * position.multiplier;
    const pnl = (mark - averageCost) * position.quantity * position.multiplier;
    marketValue += value; grossExposure += Math.abs(value);
    maintenanceMargin += Math.abs(value) * (position.quantity < 0 ? 0.3 : 0.25);
    return { ...position, mark, averageCost, marketValue: value, unrealizedPnl: pnl, quote };
  }));
  const netLiquidationValue = cash + marketValue;
  const reservedForOrders = await reservedBuyingPower(portfolioId);
  const buyingPower = Math.max(0, netLiquidationValue * 2 - grossExposure - reservedForOrders);
  const startingCapital = Number(portfolio.starting_capital);
  const totalPnl = netLiquidationValue - startingCapital;
  const session = getUsEquitySession();
  return {
    portfolio: { id: portfolio.id, name: portfolio.name, startingCapital, advancedDerivativesEnabled: Boolean(portfolio.advanced_derivatives_enabled), theme: portfolio.theme },
    account: { cash, marketValue, netLiquidationValue, totalPnl, totalReturn: startingCapital ? totalPnl / startingCapital : 0, buyingPower, reservedBuyingPower: reservedForOrders, grossExposure, maintenanceMargin, marginUtilization: netLiquidationValue > 0 ? maintenanceMargin / netLiquidationValue : 0 },
    positions, orders: orderResult.results, benchmarks: await getBenchmarks(portfolioId), session,
    quoteStatus: { provider: positions[0]?.quote.provider || "Provider routing active", quality: positions[0]?.quote.quality || "ready", refreshedAt: new Date().toISOString() },
  };
}

export async function placeOrder(input: { portfolioId: string; symbol: string; assetClass: AssetClass; side: "buy" | "sell"; orderType: "market" | "limit"; quantity: number; limitPrice?: number; timeInForce: "day" | "gtc"; optionContract?: OptionContract }) {
  await ensureCoreSchema();
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error("Quantity must be greater than zero.");
  if (input.assetClass === "option" && (!Number.isInteger(input.quantity) || !input.optionContract || !input.optionContract.expiration || !Number.isFinite(input.optionContract.strike) || input.optionContract.strike <= 0)) throw new Error("Options require a valid contract and a whole-number quantity.");
  const quote = input.assetClass === "option" && input.optionContract ? await getOptionQuote(input.optionContract) : await getMarketQuote(input.symbol, input.assetClass);
  const symbol = input.assetClass === "option" && input.optionContract ? optionSymbol(input.optionContract) : input.symbol.trim().toUpperCase(), instrumentId = `${input.assetClass}:${symbol}`;
  const session = input.assetClass === "equity" || input.assetClass === "option" ? getUsEquitySession() : { isOpen: true, nextOpenAt: undefined };
  const execution = estimateExecution(quote, input.side, input.quantity);
  const multiplier = input.assetClass === "option" ? 100 : 1;
  const [account, currentLots] = await Promise.all([getDashboard(input.portfolioId), openLots(input.portfolioId)]);
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
  if (required > account.account.buyingPower + 0.005) throw new Error(`Insufficient buying power. This order requires approximately $${required.toLocaleString("en-US", { maximumFractionDigits: 2 })}.`);

  const now = new Date().toISOString(), orderId = crypto.randomUUID();
  let status: "scheduled" | "accepted" | "filled" = session.isOpen ? "accepted" : "scheduled";
  const marketable = input.orderType === "market" || (input.side === "buy" ? Number(input.limitPrice) >= execution.price : Number(input.limitPrice) <= execution.price);
  if (session.isOpen && marketable) status = "filled";
  const db = getD1();
  const statements = [
    db.prepare("INSERT OR IGNORE INTO instruments (id, symbol, display_name, asset_class, exchange, calendar_id) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(instrumentId, symbol, quote.name, input.assetClass, input.assetClass === "crypto" ? "CRYPTO" : "US", input.assetClass === "crypto" ? "24/7" : "XNYS"),
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
    const cashChange = (input.side === "buy" ? -1 : 1) * execution.price * input.quantity * multiplier;
    statements.push(db.prepare("INSERT INTO cash_ledger (id, portfolio_id, event_type, amount, related_entity_type, related_entity_id, description, effective_at, idempotency_key) VALUES (?, ?, 'trade', ?, 'fill', ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), input.portfolioId, cashChange.toFixed(2), fillId, `${input.side.toUpperCase()} ${input.quantity} ${symbol}`, now, `fill:${fillId}`));
  }
  if (input.assetClass === "option" && input.optionContract) {
    const expirationAt = `${input.optionContract.expiration}T20:00:00.000Z`;
    statements[0] = db.prepare(`INSERT OR IGNORE INTO instruments (id, symbol, display_name, asset_class, exchange, calendar_id, multiplier, underlying_instrument_id, expiration_at, strike, option_right, exercise_style, settlement_type)
      VALUES (?, ?, ?, 'option', 'US', 'XNYS', '100', ?, ?, ?, ?, ?, 'physical')`)
      .bind(instrumentId, symbol, quote.name, `equity:${input.optionContract.underlying.toUpperCase()}`, expirationAt, input.optionContract.strike.toString(), input.optionContract.right, input.optionContract.exerciseStyle);
  }
  await db.batch(statements);
  return { orderId, status, execution, quote, scheduledFor: status === "scheduled" ? session.nextOpenAt : null };
}
