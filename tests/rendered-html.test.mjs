import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    DB: { prepare() { throw new Error("Database should not be required to render the shell"); } },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the Market Madness dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Market Madness/);
  assert.match(html, /Portfolio overview/);
  assert.match(html, /Available buying power/);
  assert.match(html, /Open positions/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /Building your site/);
});
