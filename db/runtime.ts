import { env } from "cloudflare:workers";

let ready: Promise<void> | undefined;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS portfolios (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, base_currency TEXT NOT NULL DEFAULT 'USD',
    starting_capital TEXT NOT NULL, benchmark_symbol TEXT, advanced_derivatives_enabled INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active', theme TEXT NOT NULL DEFAULT 'dark', last_processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS instruments (
    id TEXT PRIMARY KEY NOT NULL, symbol TEXT NOT NULL, display_name TEXT NOT NULL, asset_class TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD', exchange TEXT, calendar_id TEXT, multiplier TEXT NOT NULL DEFAULT '1',
    tick_size TEXT, underlying_instrument_id TEXT, expiration_at TEXT, first_notice_at TEXT, strike TEXT,
    option_right TEXT, exercise_style TEXT, settlement_type TEXT, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS portfolio_benchmarks (
    id TEXT PRIMARY KEY NOT NULL, portfolio_id TEXT NOT NULL, symbol TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
  )`,
  `CREATE TABLE IF NOT EXISTS watchlist_items (
    id TEXT PRIMARY KEY NOT NULL, portfolio_id TEXT NOT NULL, symbol TEXT NOT NULL, asset_class TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
  )`,
  `CREATE TABLE IF NOT EXISTS allocations (
    id TEXT PRIMARY KEY NOT NULL, portfolio_id TEXT NOT NULL, bucket TEXT NOT NULL, target_weight TEXT NOT NULL,
    minimum_weight TEXT, maximum_weight TEXT, FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY NOT NULL, portfolio_id TEXT NOT NULL, instrument_id TEXT NOT NULL, side TEXT NOT NULL,
    order_type TEXT NOT NULL, time_in_force TEXT NOT NULL, status TEXT NOT NULL, quantity TEXT NOT NULL,
    filled_quantity TEXT NOT NULL DEFAULT '0', limit_price TEXT, stop_price TEXT, scheduled_for TEXT,
    rejection_reason TEXT, reconstruction_status TEXT NOT NULL DEFAULT 'observed', submitted_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id), FOREIGN KEY (instrument_id) REFERENCES instruments(id)
  )`,
  `CREATE TABLE IF NOT EXISTS fills (
    id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL, portfolio_id TEXT NOT NULL, instrument_id TEXT NOT NULL,
    quantity TEXT NOT NULL, price TEXT NOT NULL, commission TEXT NOT NULL DEFAULT '0', slippage TEXT NOT NULL DEFAULT '0',
    liquidity_model TEXT NOT NULL, executed_at TEXT NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id), FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
    FOREIGN KEY (instrument_id) REFERENCES instruments(id)
  )`,
  `CREATE TABLE IF NOT EXISTS order_legs (
    id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL, instrument_id TEXT NOT NULL, side TEXT NOT NULL,
    ratio_quantity TEXT NOT NULL, FOREIGN KEY (order_id) REFERENCES orders(id), FOREIGN KEY (instrument_id) REFERENCES instruments(id)
  )`,
  `CREATE TABLE IF NOT EXISTS position_lots (
    id TEXT PRIMARY KEY NOT NULL, portfolio_id TEXT NOT NULL, instrument_id TEXT NOT NULL, opening_fill_id TEXT NOT NULL,
    original_quantity TEXT NOT NULL, remaining_quantity TEXT NOT NULL, cost_basis TEXT NOT NULL,
    opened_at TEXT NOT NULL, closed_at TEXT, FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
    FOREIGN KEY (instrument_id) REFERENCES instruments(id), FOREIGN KEY (opening_fill_id) REFERENCES fills(id)
  )`,
  `CREATE TABLE IF NOT EXISTS lot_closures (
    id TEXT PRIMARY KEY NOT NULL, portfolio_id TEXT NOT NULL, instrument_id TEXT NOT NULL, opening_lot_id TEXT NOT NULL,
    closing_fill_id TEXT, quantity TEXT NOT NULL, entry_price TEXT NOT NULL, exit_price TEXT NOT NULL,
    multiplier TEXT NOT NULL, realized_pnl TEXT NOT NULL, closure_reason TEXT NOT NULL,
    basis_transferred INTEGER NOT NULL DEFAULT 0, closed_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id), FOREIGN KEY (instrument_id) REFERENCES instruments(id),
    FOREIGN KEY (opening_lot_id) REFERENCES position_lots(id), FOREIGN KEY (closing_fill_id) REFERENCES fills(id)
  )`,
  `CREATE TABLE IF NOT EXISTS cash_ledger (
    id TEXT PRIMARY KEY NOT NULL, portfolio_id TEXT NOT NULL, event_type TEXT NOT NULL, amount TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD', related_entity_type TEXT, related_entity_id TEXT, description TEXT NOT NULL,
    effective_at TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
  )`,
  `CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY NOT NULL, instrument_id TEXT NOT NULL, provider TEXT NOT NULL, bid TEXT, ask TEXT,
    last TEXT, mark TEXT NOT NULL, quality TEXT NOT NULL, observed_at TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (instrument_id) REFERENCES instruments(id)
  )`,
  `CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY NOT NULL, portfolio_id TEXT, severity TEXT NOT NULL, event_type TEXT NOT NULL,
    title TEXT NOT NULL, message TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
  )`,
  `CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id TEXT PRIMARY KEY NOT NULL, portfolio_id TEXT NOT NULL, snapshot_date TEXT NOT NULL,
    net_liquidation_value TEXT NOT NULL, cash TEXT NOT NULL, realized_pnl TEXT NOT NULL, unrealized_pnl TEXT NOT NULL,
    margin_requirement TEXT NOT NULL, buying_power TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
  )`,
  `CREATE TABLE IF NOT EXISTS performance_observations (
    id TEXT PRIMARY KEY NOT NULL, portfolio_id TEXT NOT NULL, series_key TEXT NOT NULL, value TEXT NOT NULL,
    quality TEXT NOT NULL, observed_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
  )`,
  `CREATE TABLE IF NOT EXISTS processing_events (
    id TEXT PRIMARY KEY NOT NULL, portfolio_id TEXT NOT NULL, event_type TEXT NOT NULL, effective_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', payload TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
  )`,
  `CREATE TABLE IF NOT EXISTS corporate_actions (
    id TEXT PRIMARY KEY NOT NULL, instrument_id TEXT NOT NULL, symbol TEXT NOT NULL, action_type TEXT NOT NULL,
    effective_at TEXT NOT NULL, ratio TEXT, cash_amount TEXT, status TEXT NOT NULL DEFAULT 'scheduled',
    source TEXT NOT NULL DEFAULT 'manual_simulation', notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (instrument_id) REFERENCES instruments(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_orders_portfolio_status ON orders(portfolio_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_fills_portfolio_time ON fills(portfolio_id, executed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_position_lots_portfolio_instrument ON position_lots(portfolio_id, instrument_id)`,
  `CREATE INDEX IF NOT EXISTS idx_lot_closures_portfolio_time ON lot_closures(portfolio_id, closed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_lot_closures_portfolio_instrument ON lot_closures(portfolio_id, instrument_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cash_ledger_portfolio_time ON cash_ledger(portfolio_id, effective_at)`,
  `CREATE INDEX IF NOT EXISTS idx_quotes_instrument_time ON quotes(instrument_id, observed_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_benchmarks_portfolio_symbol ON portfolio_benchmarks(portfolio_id, symbol)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_portfolio_symbol ON watchlist_items(portfolio_id, symbol)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_allocations_portfolio_bucket ON allocations(portfolio_id, bucket)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_portfolio_unread ON alerts(portfolio_id, read_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_portfolio_date ON portfolio_snapshots(portfolio_id, snapshot_date)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_performance_observations_bucket ON performance_observations(portfolio_id, series_key, observed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_performance_observations_portfolio_time ON performance_observations(portfolio_id, observed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_order_legs_order ON order_legs(order_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_processing_events_idempotency ON processing_events(idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS idx_processing_events_due ON processing_events(status, effective_at)`,
  `CREATE INDEX IF NOT EXISTS idx_corporate_actions_due ON corporate_actions(status, effective_at)`,
  `CREATE INDEX IF NOT EXISTS idx_corporate_actions_instrument ON corporate_actions(instrument_id)`,
];

export function getD1() {
  if (!env.DB) throw new Error("Local portfolio database is unavailable.");
  return env.DB;
}

export async function ensureCoreSchema() {
  if (!ready) {
    const db = getD1();
    ready = db.batch(schemaStatements.map((statement) => db.prepare(statement))).then(() => undefined);
  }
  return ready;
}
