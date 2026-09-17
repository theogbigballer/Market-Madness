import { access, mkdir, readdir, rename } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const statePath = path.join(projectRoot, ".wrangler", "state", "v3", "d1");
const backupRoot = path.join(projectRoot, ".wrangler", "backups");

async function exists(target) { try { await access(target, constants.F_OK); return true; } catch { return false; } }
export function isBackupName(value) { return /^d1-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(value); }

async function listBackups() {
  if (!await exists(backupRoot)) return [];
  return (await readdir(backupRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory() && isBackupName(entry.name)).map((entry) => entry.name).sort().reverse();
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--restore") {
    const name = args[1];
    if (!name || !isBackupName(name)) throw new Error("Pass a backup name printed by --list.");
    if (await exists(statePath)) throw new Error("Current local state exists. Back it up before restoring.");
    const source = path.join(backupRoot, name);
    if (!await exists(source)) throw new Error(`Backup ${name} was not found.`);
    await mkdir(path.dirname(statePath), { recursive: true });
    await rename(source, statePath);
    console.log(`Restored ${name}.`);
    return;
  }
  const backups = await listBackups();
  if (args.includes("--list")) {
    console.log(backups.length ? backups.join("\n") : "No local D1 backups found.");
    return;
  }
  if (!await exists(statePath)) {
    console.log("No local D1 state exists; nothing to reset.");
    return;
  }
  if (!args.includes("--confirm")) {
    console.log("Dry run: local D1 state is present.\nRun `npm run db:reset-local -- --confirm` to move it into a recoverable backup.");
    return;
  }
  await mkdir(backupRoot, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const name = `d1-${stamp}`;
  await rename(statePath, path.join(backupRoot, name));
  console.log(`Local D1 state moved to .wrangler/backups/${name}.\nThe next app start will create a fresh database.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`Reset failed: ${error.message}`); process.exitCode = 1; });
