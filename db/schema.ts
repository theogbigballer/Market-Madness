import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const portfolios = sqliteTable("portfolios", {
  id: text("id").primaryKey(), name: text("name").notNull(),
  baseCurrency: text("base_currency").notNull().default("USD"),
  startingCapital: text("starting_capital").notNull(), benchmarkSymbol: text("benchmark_symbol"),
  advancedDerivativesEnabled: integer("advanced_derivatives_enabled", { mode: "boolean" }).notNull().default(false),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  theme: text("theme", { enum: ["light", "dark", "system"] }).notNull().default("system"),
  lastProcessedAt: text("last_processed_at").notNull().default(sql`CURRENT_TIMESTAMP`), ...timestamps,
});

export const marketDataCredentials = sqliteTable("market_data_credentials", {
  sessionHash: text("session_hash").notNull(), provider: text("provider").notNull(),
  encryptedCredentials: text("encrypted_credentials").notNull(), iv: text("iv").notNull(),
  keyIdMasked: text("key_id_masked").notNull(), connectedAt: text("connected_at").notNull(), validatedAt: text("validated_at").notNull(),
}, (table) => [uniqueIndex("idx_market_data_credentials_session_provider").on(table.sessionHash, table.provider)]);

export const allocations = sqliteTable("allocations", {
  id: text("id").primaryKey(), portfolioId: text("portfolio_id").notNull().references(() => portfolios.id),
  bucket: text("bucket").notNull(), targetWeight: text("target_weight").notNull(),
  minimumWeight: text("minimum_weight"), maximumWeight: text("maximum_weight"),
}, (table) => [uniqueIndex("idx_allocations_portfolio_bucket").on(table.portfolioId, table.bucket)]);

export const portfolioBenchmarks = sqliteTable("portfolio_benchmarks", {
  id: text("id").primaryKey(), portfolioId: text("portfolio_id").notNull().references(() => portfolios.id),
  symbol: text("symbol").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_portfolio_benchmarks_portfolio_symbol").on(table.portfolioId, table.symbol)]);

export const watchlistItems = sqliteTable("watchlist_items", {
  id: text("id").primaryKey(), portfolioId: text("portfolio_id").notNull().references(() => portfolios.id),
  symbol: text("symbol").notNull(), assetClass: text("asset_class", { enum: ["equity", "crypto"] }).notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_watchlist_portfolio_symbol").on(table.portfolioId, table.symbol)]);

export const instruments = sqliteTable("instruments", {
  id: text("id").primaryKey(), symbol: text("symbol").notNull(), displayName: text("display_name").notNull(),
  assetClass: text("asset_class", { enum: ["equity", "crypto", "future", "forward", "option", "cash"] }).notNull(),
  currency: text("currency").notNull().default("USD"), exchange: text("exchange"), calendarId: text("calendar_id"),
  multiplier: text("multiplier").notNull().default("1"), tickSize: text("tick_size"),
  underlyingInstrumentId: text("underlying_instrument_id"), expirationAt: text("expiration_at"), firstNoticeAt: text("first_notice_at"),
  strike: text("strike"), optionRight: text("option_right", { enum: ["call", "put"] }),
  exerciseStyle: text("exercise_style", { enum: ["american", "european"] }),
  settlementType: text("settlement_type", { enum: ["cash", "physical"] }),
  active: integer("active", { mode: "boolean" }).notNull().default(true), ...timestamps,
}, (table) => [uniqueIndex("idx_instruments_symbol_exchange").on(table.symbol, table.exchange), index("idx_instruments_underlying").on(table.underlyingInstrumentId)]);

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(), portfolioId: text("portfolio_id").notNull().references(() => portfolios.id),
  clientRequestId: text("client_request_id"),
  instrumentId: text("instrument_id").notNull().references(() => instruments.id),
  side: text("side", { enum: ["buy", "sell"] }).notNull(),
  orderType: text("order_type", { enum: ["market", "limit", "stop", "stop_limit"] }).notNull(),
  timeInForce: text("time_in_force", { enum: ["day", "gtc"] }).notNull(),
  status: text("status", { enum: ["draft", "submitted", "scheduled", "accepted", "partially_filled", "filled", "canceled", "expired", "rejected"] }).notNull(),
  quantity: text("quantity").notNull(), filledQuantity: text("filled_quantity").notNull().default("0"),
  limitPrice: text("limit_price"), stopPrice: text("stop_price"), scheduledFor: text("scheduled_for"),
  rejectionReason: text("rejection_reason"), reconstructionStatus: text("reconstruction_status", { enum: ["observed", "reconstructed"] }).notNull().default("observed"),
  submittedAt: text("submitted_at"), ...timestamps,
}, (table) => [index("idx_orders_portfolio_status").on(table.portfolioId, table.status), index("idx_orders_scheduled_for").on(table.scheduledFor), uniqueIndex("idx_orders_portfolio_request").on(table.portfolioId, table.clientRequestId)]);

export const orderLegs = sqliteTable("order_legs", {
  id: text("id").primaryKey(), orderId: text("order_id").notNull().references(() => orders.id),
  instrumentId: text("instrument_id").notNull().references(() => instruments.id),
  side: text("side", { enum: ["buy", "sell"] }).notNull(), ratioQuantity: text("ratio_quantity").notNull(),
}, (table) => [index("idx_order_legs_order").on(table.orderId)]);

export const fills = sqliteTable("fills", {
  id: text("id").primaryKey(), orderId: text("order_id").notNull().references(() => orders.id),
  portfolioId: text("portfolio_id").notNull().references(() => portfolios.id), instrumentId: text("instrument_id").notNull().references(() => instruments.id),
  quantity: text("quantity").notNull(), price: text("price").notNull(), commission: text("commission").notNull().default("0"),
  slippage: text("slippage").notNull().default("0"), liquidityModel: text("liquidity_model").notNull(),
  quoteProvider: text("quote_provider"), quoteQuality: text("quote_quality"), quoteObservedAt: text("quote_observed_at"),
  quoteBid: text("quote_bid"), quoteAsk: text("quote_ask"), referencePrice: text("reference_price"), executionAssumptions: text("execution_assumptions", { mode: "json" }),
  executedAt: text("executed_at").notNull(),
}, (table) => [index("idx_fills_portfolio_time").on(table.portfolioId, table.executedAt), index("idx_fills_order").on(table.orderId)]);

export const positionLots = sqliteTable("position_lots", {
  id: text("id").primaryKey(), portfolioId: text("portfolio_id").notNull().references(() => portfolios.id),
  instrumentId: text("instrument_id").notNull().references(() => instruments.id), openingFillId: text("opening_fill_id").notNull().references(() => fills.id),
  originalQuantity: text("original_quantity").notNull(), remainingQuantity: text("remaining_quantity").notNull(),
  costBasis: text("cost_basis").notNull(), openedAt: text("opened_at").notNull(), closedAt: text("closed_at"),
}, (table) => [index("idx_position_lots_portfolio_instrument").on(table.portfolioId, table.instrumentId)]);

export const lotClosures = sqliteTable("lot_closures", {
  id: text("id").primaryKey(), portfolioId: text("portfolio_id").notNull().references(() => portfolios.id),
  instrumentId: text("instrument_id").notNull().references(() => instruments.id), openingLotId: text("opening_lot_id").notNull().references(() => positionLots.id),
  closingFillId: text("closing_fill_id").references(() => fills.id), quantity: text("quantity").notNull(),
  entryPrice: text("entry_price").notNull(), exitPrice: text("exit_price").notNull(), multiplier: text("multiplier").notNull(),
  realizedPnl: text("realized_pnl").notNull(), closureReason: text("closure_reason", { enum: ["trade", "strategy", "forced_liquidation", "settlement", "expiration", "exercise", "assignment"] }).notNull(),
  basisTransferred: integer("basis_transferred", { mode: "boolean" }).notNull().default(false), closedAt: text("closed_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_lot_closures_portfolio_time").on(table.portfolioId, table.closedAt), index("idx_lot_closures_portfolio_instrument").on(table.portfolioId, table.instrumentId)]);

export const cashLedger = sqliteTable("cash_ledger", {
  id: text("id").primaryKey(), portfolioId: text("portfolio_id").notNull().references(() => portfolios.id),
  eventType: text("event_type", { enum: ["initial_capital", "deposit", "withdrawal", "trade", "dividend", "settlement", "exercise", "assignment", "transfer", "adjustment"] }).notNull(),
  amount: text("amount").notNull(), currency: text("currency").notNull().default("USD"), relatedEntityType: text("related_entity_type"),
  relatedEntityId: text("related_entity_id"), description: text("description").notNull(), effectiveAt: text("effective_at").notNull(),
  idempotencyKey: text("idempotency_key").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_cash_ledger_idempotency").on(table.idempotencyKey), index("idx_cash_ledger_portfolio_time").on(table.portfolioId, table.effectiveAt)]);

export const quotes = sqliteTable("quotes", {
  id: text("id").primaryKey(), instrumentId: text("instrument_id").notNull().references(() => instruments.id), provider: text("provider").notNull(),
  bid: text("bid"), ask: text("ask"), last: text("last"), mark: text("mark").notNull(),
  quality: text("quality", { enum: ["live", "delayed", "indicative", "simulated", "stale"] }).notNull(),
  observedAt: text("observed_at").notNull(), receivedAt: text("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_quotes_instrument_time").on(table.instrumentId, table.observedAt)]);

export const portfolioSnapshots = sqliteTable("portfolio_snapshots", {
  id: text("id").primaryKey(), portfolioId: text("portfolio_id").notNull().references(() => portfolios.id), snapshotDate: text("snapshot_date").notNull(),
  netLiquidationValue: text("net_liquidation_value").notNull(), cash: text("cash").notNull(), realizedPnl: text("realized_pnl").notNull(),
  unrealizedPnl: text("unrealized_pnl").notNull(), marginRequirement: text("margin_requirement").notNull(), buyingPower: text("buying_power").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_snapshots_portfolio_date").on(table.portfolioId, table.snapshotDate)]);

export const performanceObservations = sqliteTable("performance_observations", {
  id: text("id").primaryKey(), portfolioId: text("portfolio_id").notNull().references(() => portfolios.id),
  seriesKey: text("series_key").notNull(), value: text("value").notNull(), quality: text("quality").notNull(),
  observedAt: text("observed_at").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_performance_observations_bucket").on(table.portfolioId, table.seriesKey, table.observedAt), index("idx_performance_observations_portfolio_time").on(table.portfolioId, table.observedAt)]);

export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey(), portfolioId: text("portfolio_id").references(() => portfolios.id),
  severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull(), eventType: text("event_type").notNull(),
  title: text("title").notNull(), message: text("message").notNull(), readAt: text("read_at"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_alerts_portfolio_unread").on(table.portfolioId, table.readAt)]);

export const alertRules = sqliteTable("alert_rules", {
  id: text("id").primaryKey(), portfolioId: text("portfolio_id").notNull().references(() => portfolios.id),
  ruleType: text("rule_type", { enum: ["price", "pnl"] }).notNull(), symbol: text("symbol"), assetClass: text("asset_class"),
  comparator: text("comparator", { enum: ["above", "below"] }).notNull(), threshold: text("threshold").notNull(),
  status: text("status", { enum: ["active", "triggered", "disabled"] }).notNull().default("active"),
  lastValue: text("last_value"), triggeredAt: text("triggered_at"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_alert_rules_portfolio_status").on(table.portfolioId, table.status)]);

export const processingEvents = sqliteTable("processing_events", {
  id: text("id").primaryKey(), portfolioId: text("portfolio_id").notNull().references(() => portfolios.id),
  eventType: text("event_type", { enum: ["expiration", "exercise", "assignment", "settlement", "corporate_action", "forced_liquidation", "offline_fill"] }).notNull(),
  effectiveAt: text("effective_at").notNull(), status: text("status", { enum: ["pending", "processing", "completed", "failed"] }).notNull().default("pending"),
  payload: text("payload", { mode: "json" }).notNull(), idempotencyKey: text("idempotency_key").notNull(), error: text("error"), ...timestamps,
}, (table) => [uniqueIndex("idx_processing_events_idempotency").on(table.idempotencyKey), index("idx_processing_events_due").on(table.status, table.effectiveAt)]);

export const corporateActions = sqliteTable("corporate_actions", {
  id: text("id").primaryKey(), instrumentId: text("instrument_id").notNull().references(() => instruments.id),
  symbol: text("symbol").notNull(), actionType: text("action_type", { enum: ["cash_dividend", "split"] }).notNull(),
  effectiveAt: text("effective_at").notNull(), ratio: text("ratio"), cashAmount: text("cash_amount"),
  status: text("status", { enum: ["scheduled", "applied", "canceled"] }).notNull().default("scheduled"),
  source: text("source").notNull().default("manual_simulation"), notes: text("notes"), ...timestamps,
}, (table) => [index("idx_corporate_actions_due").on(table.status, table.effectiveAt), index("idx_corporate_actions_instrument").on(table.instrumentId)]);
