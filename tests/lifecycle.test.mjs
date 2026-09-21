import assert from "node:assert/strict";
import test from "node:test";
import { derivativeSettlementAmount, planOptionExpiry, requiresMarginLiquidation } from "../lib/trading/lifecycle.ts";
import { orderIsMarketable } from "../lib/trading/execution.ts";

test("out-of-the-money options expire without delivery", () => {
  const outcome = planOptionExpiry({ right: "call", strike: 100, spot: 100.009, positionQuantity: 2 });
  assert.equal(outcome.action, "expire");
  assert.equal(outcome.underlyingQuantity, 0);
  assert.equal(outcome.cashImpact, "0.00");
});

test("long and short in-the-money options exercise or assign with exact cash impact", () => {
  const exercise = planOptionExpiry({ right: "call", strike: "100.05", spot: "105", positionQuantity: 2 });
  assert.deepEqual({ action: exercise.action, underlyingQuantity: exercise.underlyingQuantity, cashImpact: exercise.cashImpact }, { action: "exercise", underlyingQuantity: 200, cashImpact: "-20010.00" });
  const assignment = planOptionExpiry({ right: "put", strike: "50.25", spot: "45", positionQuantity: -3 });
  assert.deepEqual({ action: assignment.action, underlyingQuantity: assignment.underlyingQuantity, cashImpact: assignment.cashImpact }, { action: "assignment", underlyingQuantity: 300, cashImpact: "-15075.00" });
});

test("derivative settlement preserves cents for long and short contracts", () => {
  assert.equal(derivativeSettlementAmount({ entryPrice: "100.05", settlementPrice: "100.10", signedQuantity: 3, multiplier: 50 }), "7.50");
  assert.equal(derivativeSettlementAmount({ entryPrice: "100.05", settlementPrice: "99.95", signedQuantity: -2, multiplier: 100 }), "20.00");
});

test("margin liquidation triggers strictly below the configured buffer", () => {
  assert.equal(requiresMarginLiquidation("1099.99", "1000", 1.1), true);
  assert.equal(requiresMarginLiquidation("1100.00", "1000", 1.1), false);
});

test("queued orders remain pending until their side-aware trigger is marketable", () => {
  assert.equal(orderIsMarketable({ side: "buy", orderType: "stop_limit", mark: 99, estimatedPrice: 99.1, stopPrice: 100, limitPrice: 101 }), false);
  assert.equal(orderIsMarketable({ side: "buy", orderType: "stop_limit", mark: 100, estimatedPrice: 100.5, stopPrice: 100, limitPrice: 101 }), true);
});
