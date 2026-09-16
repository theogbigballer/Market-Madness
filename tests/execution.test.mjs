import assert from "node:assert/strict";
import test from "node:test";
import { buildFillAudit, orderIsMarketable } from "../lib/trading/execution.ts";

test("market, limit, stop, and stop-limit orders use side-correct trigger logic", () => {
  assert.equal(orderIsMarketable({ side: "buy", orderType: "market", mark: 100, estimatedPrice: 101 }), true);
  assert.equal(orderIsMarketable({ side: "buy", orderType: "limit", mark: 100, estimatedPrice: 101, limitPrice: 101 }), true);
  assert.equal(orderIsMarketable({ side: "buy", orderType: "limit", mark: 100, estimatedPrice: 101, limitPrice: 100 }), false);
  assert.equal(orderIsMarketable({ side: "sell", orderType: "limit", mark: 100, estimatedPrice: 99, limitPrice: 99 }), true);
  assert.equal(orderIsMarketable({ side: "sell", orderType: "limit", mark: 100, estimatedPrice: 99, limitPrice: 100 }), false);
  assert.equal(orderIsMarketable({ side: "buy", orderType: "stop", mark: 105, estimatedPrice: 106, stopPrice: 104 }), true);
  assert.equal(orderIsMarketable({ side: "sell", orderType: "stop", mark: 95, estimatedPrice: 94, stopPrice: 96 }), true);
  assert.equal(orderIsMarketable({ side: "buy", orderType: "stop_limit", mark: 105, estimatedPrice: 106, stopPrice: 104, limitPrice: 105 }), false);
});

test("fill audit captures immutable quote and execution context", () => {
  const audit = buildFillAudit({ quote: { provider: "Test IEX", quality: "live", observedAt: "2026-09-16T15:00:00.000Z", bid: "99.95", ask: "100.05", mark: "100.00" }, price: 100.07, slippage: 0.02, model: "spread plus size impact", context: "immediate_order" });
  assert.deepEqual({ provider: audit.quoteProvider, quality: audit.quoteQuality, reference: audit.referencePrice, bid: audit.quoteBid, ask: audit.quoteAsk }, { provider: "Test IEX", quality: "live", reference: "100.000000", bid: "99.95", ask: "100.05" });
  assert.deepEqual(JSON.parse(audit.assumptions), { context: "immediate_order", model: "spread plus size impact", referencePrice: 100, executionPrice: 100.07, slippage: 0.02 });
});

test("contractual lifecycle fills remain auditable without a market quote", () => {
  const audit = buildFillAudit({ price: 600, slippage: 0, model: "automatic option exercise", context: "automatic_exercise" });
  assert.equal(audit.quoteProvider, "Contract terms");
  assert.equal(audit.quoteQuality, "reconstructed");
  assert.equal(audit.referencePrice, "600.000000");
});
