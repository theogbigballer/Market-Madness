import assert from "node:assert/strict";
import test from "node:test";
import { calculateFlowAdjustedPnl, calculateRealizedPnl, strategyLimitIsMarketable } from "../lib/trading/accounting.ts";

test("realized P&L respects long, short, partial, and contract multiplier economics", () => {
  assert.equal(calculateRealizedPnl({ entryPrice: 100, exitPrice: 112, signedOpenQuantity: 10, closedQuantity: 4, multiplier: 1 }), 48);
  assert.equal(calculateRealizedPnl({ entryPrice: 5, exitPrice: 2, signedOpenQuantity: -3, closedQuantity: 2, multiplier: 100 }), 600);
});

test("external cash flows do not create portfolio P&L", () => {
  assert.equal(calculateFlowAdjustedPnl(525_000, 500_000, 25_000), 0);
  assert.equal(calculateFlowAdjustedPnl(510_000, 500_000, -5_000), 15_000);
});

test("net debit and credit strategy limits use their correct direction", () => {
  assert.equal(strategyLimitIsMarketable("buy", 2.4, 2.5), true);
  assert.equal(strategyLimitIsMarketable("buy", 2.6, 2.5), false);
  assert.equal(strategyLimitIsMarketable("sell", -1.2, 1.1), true);
  assert.equal(strategyLimitIsMarketable("sell", -1.0, 1.1), false);
});
