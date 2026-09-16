import { ensureCoreSchema, getD1 } from "../../db/runtime";
import { getMarketQuote } from "../market/quotes";

export type AlertRuleInput = { portfolioId: string; ruleType: "price" | "pnl"; symbol?: string; assetClass?: "equity" | "crypto"; comparator: "above" | "below"; threshold: number };

export async function listAlertRules(portfolioId: string) {
  await ensureCoreSchema();
  const result = await getD1().prepare("SELECT id, rule_type, symbol, asset_class, comparator, threshold, status, last_value, triggered_at, created_at FROM alert_rules WHERE portfolio_id = ? ORDER BY created_at DESC").bind(portfolioId).all<Record<string, string | null>>();
  return result.results.map((row) => ({ ...row, threshold: Number(row.threshold), last_value: row.last_value === null ? null : Number(row.last_value) }));
}

export async function createAlertRule(input: AlertRuleInput) {
  await ensureCoreSchema();
  if (!Number.isFinite(input.threshold)) throw new Error("Alert threshold must be a number.");
  const symbol = input.ruleType === "price" ? input.symbol?.trim().toUpperCase() : null;
  if (input.ruleType === "price" && !symbol) throw new Error("A ticker is required for a price alert.");
  const id = crypto.randomUUID();
  await getD1().prepare("INSERT INTO alert_rules (id, portfolio_id, rule_type, symbol, asset_class, comparator, threshold) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, input.portfolioId, input.ruleType, symbol, input.ruleType === "price" ? (input.assetClass || (symbol?.endsWith("-USD") ? "crypto" : "equity")) : null, input.comparator, input.threshold.toString()).run();
  return { id };
}

export async function deleteAlertRule(portfolioId: string, id: string) {
  await ensureCoreSchema();
  const result = await getD1().prepare("DELETE FROM alert_rules WHERE portfolio_id = ? AND id = ?").bind(portfolioId, id).run();
  if (!result.meta.changes) throw new Error("Alert rule not found.");
  return { id };
}

export async function evaluateAlertRules(portfolioId: string, totalPnl: number) {
  await ensureCoreSchema();
  const db = getD1();
  const result = await db.prepare("SELECT id, rule_type, symbol, asset_class, comparator, threshold FROM alert_rules WHERE portfolio_id = ? AND status = 'active'").bind(portfolioId).all<{ id: string; rule_type: "price" | "pnl"; symbol: string | null; asset_class: "equity" | "crypto" | null; comparator: "above" | "below"; threshold: string }>();
  for (const rule of result.results) {
    const value = rule.rule_type === "pnl" ? totalPnl : Number((await getMarketQuote(rule.symbol!, rule.asset_class || "equity")).mark);
    const threshold = Number(rule.threshold), triggered = rule.comparator === "above" ? value >= threshold : value <= threshold;
    if (triggered) {
      const now = new Date().toISOString(), label = rule.rule_type === "pnl" ? "Portfolio P&L" : rule.symbol!;
      await db.batch([
        db.prepare("UPDATE alert_rules SET status = 'triggered', last_value = ?, triggered_at = ? WHERE id = ? AND status = 'active'").bind(value.toString(), now, rule.id),
        db.prepare("INSERT INTO alerts (id, portfolio_id, severity, event_type, title, message, created_at) VALUES (?, ?, 'info', 'user_alert', ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, `${label} alert triggered`, `${label} moved ${rule.comparator} ${threshold.toLocaleString("en-US", { style: "currency", currency: "USD" })}; observed value ${value.toLocaleString("en-US", { style: "currency", currency: "USD" })}.`, now),
      ]);
    } else await db.prepare("UPDATE alert_rules SET last_value = ? WHERE id = ?").bind(value.toString(), rule.id).run();
  }
}
