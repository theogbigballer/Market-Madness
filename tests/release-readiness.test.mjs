import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("release commands and recovery documentation stay wired", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts.doctor, "node scripts/doctor.mjs");
  assert.equal(packageJson.scripts["db:reset-local"], "node scripts/reset-local-data.mjs");
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /npm run db:reset-local -- --confirm/);
  assert.match(readme, /portable portfolio package/i);
});

test("environment doctor succeeds in an installed checkout", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/doctor.mjs", import.meta.url))], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PASS\s+Node/);
  assert.match(result.stdout, /Local database/);
});

test("local reset defaults to a non-mutating dry run", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/reset-local-data.mjs", import.meta.url))], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Dry run|nothing to reset/);
});

test("backup names are strictly validated", async () => {
  const { isBackupName } = await import("../scripts/reset-local-data.mjs");
  assert.equal(isBackupName("d1-2026-09-17T12-34-56-789Z"), true);
  assert.equal(isBackupName("../../somewhere"), false);
  assert.equal(isBackupName("d1-latest"), false);
});
