import { exerciseAmericanOption } from "../../../../lib/trading/store";
import { portfolioId, positiveNumber, requiredString } from "../../../../lib/trading/validation";
import { normalizeRequestId, withPortfolioMutation } from "../../../../lib/trading/mutation";
import { apiErrorResponse } from "../../../../lib/http/api-error";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { portfolioId?: string; instrumentId?: string; quantity?: number };
    const id = portfolioId(body.portfolioId), requestId = normalizeRequestId(request.headers.get("idempotency-key"));
    const result = await withPortfolioMutation(id, () => exerciseAmericanOption({ portfolioId: id, instrumentId: requiredString(body.instrumentId, "instrumentId", 160), quantity: positiveNumber(body.quantity, "Exercise quantity", { integer: true, maximum: 1_000_000 }), requestId }));
    return Response.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) { return apiErrorResponse(error, "Unable to exercise the option."); }
}
