import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/cloudflare-loader.mjs";
import { D1SQLite } from "./helpers/d1-sqlite.mjs";

let worker;
let database;

test.before(async () => {
  database = new D1SQLite();
  globalThis.__MARKET_MADNESS_TEST_ENV__ = { DB: database };
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("integration", `${process.pid}-${Date.now()}`);
  ({ default: worker } = await import(workerUrl.href));
});

test.after(async () => {
  database?.close();
  delete globalThis.__MARKET_MADNESS_TEST_ENV__;
});

async function api(path, options = {}) {
  const response = await worker.fetch(new Request(`http://localhost${path}`, {
    method: options.method || "GET",
    headers: options.body === undefined ? undefined : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }), { DB: database, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
  return { response, body: await response.json() };
}

test("portfolio, cash, order, fill, and position APIs complete a database-backed workflow", async () => {
  const created = await api("/api/portfolios", { method: "POST", body: { name: "Integration Portfolio", startingCapital: 500_000, advancedDerivativesEnabled: true, theme: "dark" } });
  assert.equal(created.response.status, 201);
  assert.match(created.body.id, /^[0-9a-f-]{36}$/);
  const portfolioId = created.body.id;

  const deposit = await api("/api/cash", { method: "POST", body: { portfolioId, direction: "deposit", amount: "100.10" } });
  assert.equal(deposit.response.status, 201);

  const deliveryDate = new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10);
  const contract = { underlying: "AAPL", deliveryDate, deliveryPrice: 250.05, quantityUnit: "shares" };
  const opened = await api("/api/orders", { method: "POST", body: { portfolioId, symbol: "AAPL", assetClass: "forward", side: "buy", orderType: "market", quantity: 2, timeInForce: "gtc", forwardContract: contract } });
  assert.equal(opened.response.status, 201);
  assert.equal(opened.body.status, "filled");

  const reduced = await api("/api/orders", { method: "POST", body: { portfolioId, symbol: "AAPL", assetClass: "forward", side: "sell", orderType: "market", quantity: 1, timeInForce: "gtc", forwardContract: contract } });
  assert.equal(reduced.response.status, 201);
  assert.equal(reduced.body.status, "filled");

  const dashboard = await api(`/api/dashboard?portfolioId=${portfolioId}`);
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.body.account.cash, 500_100.1);
  assert.equal(dashboard.body.positions.length, 1);
  assert.equal(dashboard.body.positions[0].quantity, 1);
  assert.equal(dashboard.body.orders.length, 2);
  assert.ok(dashboard.body.orders.every((order) => order.fill_provider && order.fill_model));

  const ledger = await database.prepare("SELECT amount FROM cash_ledger WHERE portfolio_id = ? ORDER BY created_at").bind(portfolioId).all();
  assert.deepEqual(ledger.results.map((row) => row.amount), ["500000.00", "100.10", "0.00", "0.00"]);
  const closures = await database.prepare("SELECT quantity, realized_pnl, closure_reason FROM lot_closures WHERE portfolio_id = ?").bind(portfolioId).all();
  assert.deepEqual(closures.results.map((row) => ({ ...row })), [{ quantity: "1", realized_pnl: "0.000000", closure_reason: "trade" }]);
});

test("invalid API values are rejected before they mutate the database", async () => {
  const created = await api("/api/portfolios", { method: "POST", body: { name: "Validation Portfolio", startingCapital: 10_000, theme: "light" } });
  const portfolioId = created.body.id;

  const invalidDirection = await api("/api/cash", { method: "POST", body: { portfolioId, direction: "wire", amount: 100 } });
  assert.equal(invalidDirection.response.status, 400);
  assert.match(invalidDirection.body.error, /Transfer direction/);

  const invalidOrder = await api("/api/orders", { method: "POST", body: { portfolioId, symbol: "AAPL", assetClass: "cash", side: "buy", orderType: "market", quantity: 1, timeInForce: "day" } });
  assert.equal(invalidOrder.response.status, 400);
  assert.match(invalidOrder.body.error, /Asset class/);

  const counts = await database.prepare("SELECT (SELECT COUNT(*) FROM orders WHERE portfolio_id = ?) AS orders, (SELECT COUNT(*) FROM cash_ledger WHERE portfolio_id = ?) AS ledger").bind(portfolioId, portfolioId).first();
  assert.equal(counts.orders, 0);
  assert.equal(counts.ledger, 1);
});
