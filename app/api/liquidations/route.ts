import { apiErrorResponse } from "../../../lib/http/api-error";
import { normalizeRequestId, withPortfolioMutation } from "../../../lib/trading/mutation";
import { liquidatePositions } from "../../../lib/trading/store";
import { portfolioId as validPortfolioId } from "../../../lib/trading/validation";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { portfolioId?: string; instrumentId?: string };
    const portfolioId = validPortfolioId(body.portfolioId), instrumentId = body.instrumentId?.trim();
    if (instrumentId && !/^(equity|crypto|future|forward|option):[^\r\n]{1,160}$/i.test(instrumentId)) throw new Error("Enter a valid position instrument.");
    const requestId = normalizeRequestId(request.headers.get("idempotency-key"));
    return Response.json(await withPortfolioMutation(portfolioId, () => liquidatePositions({ portfolioId, instrumentId, requestId })), { status: 201 });
  } catch (error) { return apiErrorResponse(error, "Unable to liquidate positions."); }
}
