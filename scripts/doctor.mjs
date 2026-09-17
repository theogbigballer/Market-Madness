import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = ["package.json", ".openai/hosting.json", "drizzle.config.ts", "app/page.tsx", "lib/trading/store.ts"];
const minimumNode = [22, 13, 0];

function versionAtLeast(actual, minimum) {
  const parts = actual.replace(/^v/, "").split(".").map(Number);
  for (let index = 0; index < minimum.length; index += 1) {
    if ((parts[index] || 0) > minimum[index]) return true;
    if ((parts[index] || 0) < minimum[index]) return false;
  }
  return true;
}

async function exists(relativePath) {
  try { await access(path.join(projectRoot, relativePath), constants.R_OK); return true; } catch { return false; }
}

export async function inspectProject() {
  const checks = [];
  checks.push({ label: `Node ${process.version}`, ok: versionAtLeast(process.version, minimumNode), detail: "requires 22.13.0 or newer" });
  for (const file of requiredFiles) checks.push({ label: file, ok: await exists(file), detail: "required project file" });
  checks.push({ label: "node_modules", ok: await exists("node_modules"), detail: "run npm install if missing" });
  const envPath = path.join(projectRoot, ".env");
  let liveEquityConfigured = false;
  if (await exists(".env")) {
    const env = await readFile(envPath, "utf8");
    liveEquityConfigured = /(?:^|\n)ALPACA_KEY_ID=.+/.test(env) && /(?:^|\n)ALPACA_SECRET_KEY=.+/.test(env);
  }
  return { checks, liveEquityConfigured, hasLocalDatabase: await exists(".wrangler/state/v3/d1") };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await inspectProject();
  console.log("Market Madness environment check\n");
  for (const check of report.checks) console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.label} — ${check.detail}`);
  console.log(`\nINFO  Equity feed — ${report.liveEquityConfigured ? "Alpaca credentials detected" : "simulation fallback (optional credentials not detected)"}`);
  console.log(`INFO  Local database — ${report.hasLocalDatabase ? "existing D1 state detected" : "will be created on first run"}`);
  if (report.checks.some((check) => !check.ok)) process.exitCode = 1;
}
