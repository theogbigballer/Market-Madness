import assert from "node:assert/strict";
import test from "node:test";
import { deribitBaseCurrency, matchDeribitInstrument, selectDeribitChain } from "../lib/market/deribit.ts";

const expiration = Date.parse("2026-09-25T08:00:00.000Z");
const instrument = (strike, option_type) => ({
  instrument_name: `BTC_USDC-25SEP26-${strike}-${option_type === "call" ? "C" : "P"}`,
  base_currency: "BTC", quote_currency: "USDC", kind: "option", option_type,
  expiration_timestamp: expiration, strike, contract_size: 1, is_active: true, instrument_type: "linear",
});

test("Deribit mapping only enables supported USD crypto underlyings", () => {
  assert.equal(deribitBaseCurrency("btc-usd"), "BTC");
  assert.equal(deribitBaseCurrency("ADA-USD"), null);
});

test("exact listed contracts can be matched without adopting the venue contract size", () => {
  const sol = { ...instrument(200, "call"), instrument_name: "SOL_USDC-25SEP26-200-C", base_currency: "SOL", contract_size: 10 };
  const matched = matchDeribitInstrument([sol], { underlying: "SOL-USD", expiration: "2026-09-25", strike: 200, right: "call" });
  assert.equal(matched?.contract_size, 10);
  assert.equal(matchDeribitInstrument([sol], { underlying: "SOL-USD", expiration: "2026-09-25", strike: 201, right: "call" }), undefined);
});

test("chain selection returns paired strikes nearest the live underlying", () => {
  const instruments = [80_000, 85_000, 90_000].flatMap((strike) => [instrument(strike, "call"), instrument(strike, "put")]);
  const summaries = new Map(instruments.map((item) => [item.instrument_name, { instrument_name: item.instrument_name, base_currency: "BTC", quote_currency: "USDC", underlying_price: 86_000 }]));
  const chain = selectDeribitChain({ instruments, summaries, observedAt: "2026-09-22T12:00:00.000Z" }, "BTC-USD");
  assert.deepEqual(chain?.strikes, [80_000, 85_000, 90_000]);
  assert.equal(chain?.expiration, "2026-09-25");
  assert.equal(chain?.multiplier, 1);
});
