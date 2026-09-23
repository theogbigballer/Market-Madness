import assert from "node:assert/strict";
import test from "node:test";
import { classifyEquityQuoteQuality } from "../lib/domain.ts";
import { enumValue, optionalBoolean, optionalPositiveNumber, positiveNumber, requiredString } from "../lib/trading/validation.ts";

test("equity quote quality distinguishes a closed market from a broken feed", () => {
  const now = new Date("2026-09-22T22:30:00.000Z");
  const oldQuote = "2026-09-22T20:00:00.000Z";
  assert.equal(classifyEquityQuoteQuality(oldQuote, false, now), "closed");
  assert.equal(classifyEquityQuoteQuality(oldQuote, true, now), "stale");
  assert.equal(classifyEquityQuoteQuality("2026-09-22T22:29:30.000Z", false, now), "closed");
  assert.equal(classifyEquityQuoteQuality("2026-09-22T22:29:30.000Z", true, now), "live");
});

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
