import assert from "node:assert/strict";
import test from "node:test";
import { compareDecimal, compareMoney, formatMoney, multiplyMoney, subtractDecimal, sumMoney } from "../lib/trading/money.ts";

test("money rounds decimal strings to cents without binary floating-point drift", () => {
  assert.equal(formatMoney("1.005"), "1.01");
  assert.equal(formatMoney("-1.005"), "-1.01");
  assert.equal(formatMoney(1e-7), "0.00");
});

test("cash products and ledger totals remain exact", () => {
  assert.equal(multiplyMoney("10.015", "3", "100"), "3004.50");
  assert.equal(sumMoney(["0.10", "0.20", "-0.05"]), "0.25");
  assert.equal(subtractDecimal("112.10", "100.05"), "12.05");
  assert.equal(compareMoney("10.004", "10.00"), 0);
  assert.equal(compareDecimal("0.009", "0.01"), -1);
});
