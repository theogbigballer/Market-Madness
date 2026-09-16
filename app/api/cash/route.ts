import { transferCash } from "../../../lib/trading/store";
import { enumValue, portfolioId, positiveNumber } from "../../../lib/trading/validation";
import { normalizeRequestId, withPortfolioMutation } from "../../../lib/trading/mutation";
import { apiErrorResponse } from "../../../lib/http/api-error";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { portfolioId?: string; direction?: "deposit" | "withdrawal"; amount?: number };
    const id = portfolioId(body.portfolioId), requestId = normalizeRequestId(request.headers.get("idempotency-key"));
    const result = await withPortfolioMutation(id, () => transferCash(id, enumValue(body.direction, ["deposit", "withdrawal"] as const, "Transfer direction"), positiveNumber(body.amount, "Transfer amount", { maximum: 1_000_000_000_000 }), requestId));
    return Response.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) { return apiErrorResponse(error, "Unable to transfer cash."); }
}
