import { ensureCoreSchema, getD1 } from "../../db/runtime";
import { currentUser } from "./identity";

export async function assertPortfolioAccess(portfolioId: string) {
  await ensureCoreSchema();
  const portfolio = await getD1().prepare("SELECT id FROM portfolios WHERE id = ? AND owner_user_id = ?").bind(portfolioId, currentUser().id).first();
  if (!portfolio) throw new Error("Portfolio not found.");
}
