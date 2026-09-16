import assert from "node:assert/strict";
import test from "node:test";
import { enumValue, optionalBoolean, optionalPositiveNumber, positiveNumber, requiredString } from "../lib/trading/validation.ts";

test("request validation normalizes valid user input", () => {
  assert.equal(requiredString("  Portfolio  ", "Name"), "Portfolio");
  assert.equal(enumValue("buy", ["buy", "sell"], "Side"), "buy");
  assert.equal(positiveNumber("12.5", "Quantity"), 12.5);
  assert.equal(optionalPositiveNumber(undefined, "Limit"), undefined);
  assert.equal(optionalBoolean(true, "Advanced derivatives"), true);
});

test("request validation rejects invalid enums, bounds, and blank strings", () => {
  assert.throws(() => requiredString("   ", "Name"), /required/);
  assert.throws(() => enumValue("wire", ["deposit", "withdrawal"], "Direction"), /must be one of/);
  assert.throws(() => positiveNumber(1.5, "Contracts", { integer: true }), /whole number/);
  assert.throws(() => positiveNumber(101, "Units", { maximum: 100 }), /cannot exceed/);
  assert.throws(() => optionalBoolean("false", "Advanced derivatives"), /true or false/);
});
