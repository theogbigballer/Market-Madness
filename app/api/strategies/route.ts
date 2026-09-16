import type { OptionStrategyLeg } from "../../../lib/trading/strategies";
import { previewOptionStrategy } from "../../../lib/trading/strategies";
import { placeOptionStrategy } from "../../../lib/trading/store";
import { enumValue, optionalPositiveNumber, portfolioId, positiveNumber } from "../../../lib/trading/validation";
import { normalizeRequestId, withPortfolioMutation } from "../../../lib/trading/mutation";
import { apiErrorResponse } from "../../../lib/http/api-error";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: "preview" | "submit"; portfolioId?: string; units?: number; legs?: OptionStrategyLeg[]; orderType?: "market" | "limit"; netLimitPrice?: number };
    if (!Array.isArray(body.legs)) throw new Error("Strategy legs are required.");
    const units = positiveNumber(body.units ?? 1, "Strategy quantity", { integer: true, maximum: 100_000 });
    if (body.action === "submit") {
      const id = portfolioId(body.portfolioId), requestId = normalizeRequestId(request.headers.get("idempotency-key"));
      const result = await withPortfolioMutation(id, () => placeOptionStrategy({ portfolioId: id, units, legs: body.legs!, orderType: enumValue(body.orderType ?? "market", ["market", "limit"] as const, "Order type"), netLimitPrice: optionalPositiveNumber(body.netLimitPrice, "Net limit price"), requestId }));
      return Response.json(result, { status: result.duplicate ? 200 : 201 });
    }
    if (body.action !== undefined) enumValue(body.action, ["preview", "submit"] as const, "Strategy action");
    return Response.json(await previewOptionStrategy(body.legs, units));
  } catch (error) { return apiErrorResponse(error, "Unable to process the strategy."); }
}
