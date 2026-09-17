import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRequestId, withPortfolioMutation } from "../lib/trading/mutation.ts";

test("portfolio mutations execute serially while different portfolios remain independent", async () => {
  const events = [];
  const first = withPortfolioMutation("portfolio-a", async () => {
    events.push("a1:start");
    await new Promise((resolve) => setTimeout(resolve, 10));
    events.push("a1:end");
  });
  const second = withPortfolioMutation("portfolio-a", async () => { events.push("a2"); });
  const independent = withPortfolioMutation("portfolio-b", async () => { events.push("b1"); });
  await Promise.all([first, second, independent]);
  assert.ok(events.indexOf("a1:end") < events.indexOf("a2"));
  assert.ok(events.indexOf("b1") < events.indexOf("a2"));
});

test("idempotency keys accept safe request identifiers only", () => {
  assert.equal(normalizeRequestId(" order:retry-001 "), "order:retry-001");
  assert.equal(normalizeRequestId(null), undefined);
  assert.throws(() => normalizeRequestId("short"), /8–128/);
  assert.throws(() => normalizeRequestId("unsafe key with spaces"), /Idempotency-Key/);
});
