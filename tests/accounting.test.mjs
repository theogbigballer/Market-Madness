import assert from "node:assert/strict";
import test from "node:test";
import { calculateFlowAdjustedPnl, calculatePortfolioOptionMargin, calculateRealizedPnl, netSignedQuantity, strategyLimitIsMarketable } from "../lib/trading/accounting.ts";

test("realized P&L respects long, short, partial, and contract multiplier economics", () => {
  assert.equal(calculateRealizedPnl({ entryPrice: 100, exitPrice: 112, signedOpenQuantity: 10, closedQuantity: 4, multiplier: 1 }), 48);
  assert.equal(calculateRealizedPnl({ entryPrice: 5, exitPrice: 2, signedOpenQuantity: -3, closedQuantity: 2, multiplier: 100 }), 600);
});

test("external cash flows do not create portfolio P&L", () => {
  assert.equal(calculateFlowAdjustedPnl(525_000, 500_000, 25_000), 0);
  assert.equal(calculateFlowAdjustedPnl(510_000, 500_000, -5_000), 15_000);
});

test("delivered shares close opposing lots before opening a residual position", () => {
  const result = netSignedQuantity(100, [{ id: "short-a", quantity: -60 }, { id: "short-b", quantity: -70 }]);
  assert.equal(result.remaining, 0);
  assert.deepEqual(result.closures.map((item) => ({ id: item.lot.id, closed: item.quantity, next: item.nextQuantity })), [
    { id: "short-a", closed: 60, next: 0 },
    { id: "short-b", closed: 40, next: -30 },
  ]);
  assert.equal(netSignedQuantity(-150, [{ id: "long", quantity: 100 }]).remaining, -50);
});

test("net debit and credit strategy limits use their correct direction", () => {
  assert.equal(strategyLimitIsMarketable("buy", 2.4, 2.5), true);
  assert.equal(strategyLimitIsMarketable("buy", 2.6, 2.5), false);
  assert.equal(strategyLimitIsMarketable("sell", -1.2, 1.1), true);
  assert.equal(strategyLimitIsMarketable("sell", -1.0, 1.1), false);
});

test("portfolio option margin recognizes covered calls, verticals, and iron-condor offsets", () => {
  const covered = calculatePortfolioOptionMargin([{ underlying: "SPY", expiration: "2026-12-18", right: "call", strike: 600, quantity: -1, spot: 590, mark: 8 }], { SPY: 100 });
  assert.equal(covered.requirement, 0);
  assert.equal(covered.coveredContracts, 1);
  const vertical = calculatePortfolioOptionMargin([
    { underlying: "SPY", expiration: "2026-12-18", right: "call", strike: 600, quantity: -1, spot: 590, mark: 8 },
    { underlying: "SPY", expiration: "2026-12-18", right: "call", strike: 610, quantity: 1, spot: 590, mark: 5 },
  ], {});
  assert.equal(vertical.requirement, 1000);
  const condor = calculatePortfolioOptionMargin([
    { underlying: "SPY", expiration: "2026-12-18", right: "put", strike: 560, quantity: 1, spot: 590, mark: 3 },
    { underlying: "SPY", expiration: "2026-12-18", right: "put", strike: 570, quantity: -1, spot: 590, mark: 5 },
    { underlying: "SPY", expiration: "2026-12-18", right: "call", strike: 610, quantity: -1, spot: 590, mark: 5 },
    { underlying: "SPY", expiration: "2026-12-18", right: "call", strike: 620, quantity: 1, spot: 590, mark: 3 },
  ], {});
  assert.equal(condor.requirement, 1000);
});
