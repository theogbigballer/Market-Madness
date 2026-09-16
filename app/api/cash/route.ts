import { transferCash } from "../../../lib/trading/store";
import { enumValue, portfolioId, positiveNumber } from "../../../lib/trading/validation";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { portfolioId?: string; direction?: "deposit" | "withdrawal"; amount?: number };
    return Response.json(await transferCash(portfolioId(body.portfolioId), enumValue(body.direction, ["deposit", "withdrawal"] as const, "Transfer direction"), positiveNumber(body.amount, "Transfer amount", { maximum: 1_000_000_000_000 })), { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to transfer cash." }, { status: 400 }); }
}
