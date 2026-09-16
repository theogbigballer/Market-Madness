import { ensureCoreSchema, getD1 } from "../../db/runtime";

type Row = Record<string, unknown>;
type PackageData = Record<string, Row[]>;
export type PortfolioPackage = { format: "market-madness-portfolio"; version: 1; exportedAt: string; data: PackageData };

const portfolioTables = ["portfolio_benchmarks", "watchlist_items", "allocations", "orders", "fills", "position_lots", "lot_closures", "cash_ledger", "portfolio_snapshots", "performance_observations", "alerts", "alert_rules", "processing_events"] as const;
const columns: Record<string, string[]> = {
  portfolios: ["id", "name", "base_currency", "starting_capital", "benchmark_symbol", "advanced_derivatives_enabled", "status", "theme", "last_processed_at", "created_at", "updated_at"],
  instruments: ["id", "symbol", "display_name", "asset_class", "currency", "exchange", "calendar_id", "multiplier", "tick_size", "underlying_instrument_id", "expiration_at", "first_notice_at", "strike", "option_right", "exercise_style", "settlement_type", "active", "created_at", "updated_at"],
  portfolio_benchmarks: ["id", "portfolio_id", "symbol", "created_at"], watchlist_items: ["id", "portfolio_id", "symbol", "asset_class", "created_at"], allocations: ["id", "portfolio_id", "bucket", "target_weight", "minimum_weight", "maximum_weight"],
  orders: ["id", "portfolio_id", "instrument_id", "side", "order_type", "time_in_force", "status", "quantity", "filled_quantity", "limit_price", "stop_price", "scheduled_for", "rejection_reason", "reconstruction_status", "submitted_at", "created_at", "updated_at"],
  order_legs: ["id", "order_id", "instrument_id", "side", "ratio_quantity"], fills: ["id", "order_id", "portfolio_id", "instrument_id", "quantity", "price", "commission", "slippage", "liquidity_model", "executed_at"],
  position_lots: ["id", "portfolio_id", "instrument_id", "opening_fill_id", "original_quantity", "remaining_quantity", "cost_basis", "opened_at", "closed_at"], lot_closures: ["id", "portfolio_id", "instrument_id", "opening_lot_id", "closing_fill_id", "quantity", "entry_price", "exit_price", "multiplier", "realized_pnl", "closure_reason", "basis_transferred", "closed_at", "created_at"],
  cash_ledger: ["id", "portfolio_id", "event_type", "amount", "currency", "related_entity_type", "related_entity_id", "description", "effective_at", "idempotency_key", "created_at"], portfolio_snapshots: ["id", "portfolio_id", "snapshot_date", "net_liquidation_value", "cash", "realized_pnl", "unrealized_pnl", "margin_requirement", "buying_power", "created_at"], performance_observations: ["id", "portfolio_id", "series_key", "value", "quality", "observed_at", "created_at"],
  alerts: ["id", "portfolio_id", "severity", "event_type", "title", "message", "read_at", "created_at"], alert_rules: ["id", "portfolio_id", "rule_type", "symbol", "asset_class", "comparator", "threshold", "status", "last_value", "triggered_at", "created_at"], processing_events: ["id", "portfolio_id", "event_type", "effective_at", "status", "payload", "idempotency_key", "error", "created_at", "updated_at"],
};

async function rows(sql: string, ...bindings: unknown[]) { return (await getD1().prepare(sql).bind(...bindings).all<Row>()).results; }

export async function exportPortfolioPackage(portfolioId: string): Promise<PortfolioPackage> {
  await ensureCoreSchema();
  const portfolio = await rows("SELECT * FROM portfolios WHERE id = ?", portfolioId); if (!portfolio.length) throw new Error("Portfolio not found.");
  const data: PackageData = { portfolios: portfolio, instruments: await rows("SELECT * FROM instruments") };
  for (const table of portfolioTables) data[table] = await rows(`SELECT * FROM ${table} WHERE portfolio_id = ?`, portfolioId);
  data.order_legs = await rows("SELECT ol.* FROM order_legs ol JOIN orders o ON o.id = ol.order_id WHERE o.portfolio_id = ?", portfolioId);
  return { format: "market-madness-portfolio", version: 1, exportedAt: new Date().toISOString(), data };
}

function remap(row: Row, changes: Row) { return { ...row, ...changes }; }
async function insert(table: string, source: Row[], ignore = false) {
  if (!source.length) return;
  const selected = columns[table], placeholders = selected.map(() => "?").join(",");
  const statements = source.map((row) => getD1().prepare(`INSERT ${ignore ? "OR IGNORE " : ""}INTO ${table} (${selected.join(",")}) VALUES (${placeholders})`).bind(...selected.map((key) => row[key] ?? null)));
  for (let offset = 0; offset < statements.length; offset += 50) await getD1().batch(statements.slice(offset, offset + 50));
}

export async function importPortfolioPackage(pkg: PortfolioPackage) {
  await ensureCoreSchema();
  if (pkg?.format !== "market-madness-portfolio" || pkg.version !== 1 || !pkg.data?.portfolios?.[0]) throw new Error("This is not a supported Market Madness portfolio package.");
  const source = pkg.data, now = new Date().toISOString(), portfolioId = crypto.randomUUID(), oldPortfolio = source.portfolios[0];
  const orderMap = new Map<string, string>(), fillMap = new Map<string, string>(), lotMap = new Map<string, string>();
  (source.orders || []).forEach((row) => orderMap.set(String(row.id), crypto.randomUUID()));
  (source.fills || []).forEach((row) => fillMap.set(String(row.id), crypto.randomUUID()));
  (source.position_lots || []).forEach((row) => lotMap.set(String(row.id), crypto.randomUUID()));
  await insert("instruments", source.instruments || [], true);
  await insert("portfolios", [remap(oldPortfolio, { id: portfolioId, name: `${String(oldPortfolio.name)} (Imported)`, status: "active", last_processed_at: now, created_at: now, updated_at: now })]);
  const simple = ["portfolio_benchmarks", "watchlist_items", "allocations", "portfolio_snapshots", "performance_observations", "alerts", "alert_rules"];
  for (const table of simple) await insert(table, (source[table] || []).map((row) => remap(row, { id: crypto.randomUUID(), portfolio_id: portfolioId })));
  await insert("orders", (source.orders || []).map((row) => remap(row, { id: orderMap.get(String(row.id)), portfolio_id: portfolioId })));
  await insert("order_legs", (source.order_legs || []).map((row) => remap(row, { id: crypto.randomUUID(), order_id: orderMap.get(String(row.order_id)) })));
  await insert("fills", (source.fills || []).map((row) => remap(row, { id: fillMap.get(String(row.id)), order_id: orderMap.get(String(row.order_id)), portfolio_id: portfolioId })));
  await insert("position_lots", (source.position_lots || []).map((row) => remap(row, { id: lotMap.get(String(row.id)), portfolio_id: portfolioId, opening_fill_id: fillMap.get(String(row.opening_fill_id)) })));
  await insert("lot_closures", (source.lot_closures || []).map((row) => remap(row, { id: crypto.randomUUID(), portfolio_id: portfolioId, opening_lot_id: lotMap.get(String(row.opening_lot_id)), closing_fill_id: row.closing_fill_id ? fillMap.get(String(row.closing_fill_id)) : null })));
  await insert("cash_ledger", (source.cash_ledger || []).map((row) => remap(row, { id: crypto.randomUUID(), portfolio_id: portfolioId, related_entity_id: row.related_entity_id ? orderMap.get(String(row.related_entity_id)) || fillMap.get(String(row.related_entity_id)) || row.related_entity_id : null, idempotency_key: `import:${portfolioId}:${crypto.randomUUID()}` })));
  await insert("processing_events", (source.processing_events || []).map((row) => remap(row, { id: crypto.randomUUID(), portfolio_id: portfolioId, idempotency_key: `import:${portfolioId}:${crypto.randomUUID()}` })));
  return { id: portfolioId };
}
