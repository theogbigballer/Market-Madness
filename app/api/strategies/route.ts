import type { OptionStrategyLeg } from "../../../lib/trading/strategies";
import { previewOptionStrategy } from "../../../lib/trading/strategies";
import { placeOptionStrategy } from "../../../lib/trading/store";
import { enumValue, optionalPositiveNumber, portfolioId, positiveNumber } from "../../../lib/trading/validation";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: "preview" | "submit"; portfolioId?: string; units?: number; legs?: OptionStrategyLeg[]; orderType?: "market" | "limit"; netLimitPrice?: number };
    if (!Array.isArray(body.legs)) throw new Error("Strategy legs are required.");
    const units = positiveNumber(body.units ?? 1, "Strategy quantity", { integer: true, maximum: 100_000 });
    if (body.action === "submit") {
      return Response.json(await placeOptionStrategy({ portfolioId: portfolioId(body.portfolioId), units, legs: body.legs, orderType: enumValue(body.orderType ?? "market", ["market", "limit"] as const, "Order type"), netLimitPrice: optionalPositiveNumber(body.netLimitPrice, "Net limit price") }), { status: 201 });
    }
    if (body.action !== undefined) enumValue(body.action, ["preview", "submit"] as const, "Strategy action");
    return Response.json(await previewOptionStrategy(body.legs, units));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to process the strategy." }, { status: 400 }); }
}
