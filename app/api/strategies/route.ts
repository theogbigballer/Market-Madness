import type { OptionStrategyLeg } from "../../../lib/trading/strategies";
import { previewOptionStrategy } from "../../../lib/trading/strategies";
import { placeOptionStrategy } from "../../../lib/trading/store";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: "preview" | "submit"; portfolioId?: string; units?: number; legs?: OptionStrategyLeg[]; orderType?: "market" | "limit"; netLimitPrice?: number };
    if (!body.legs) throw new Error("Strategy legs are required.");
    if (body.action === "submit") {
      if (!body.portfolioId) throw new Error("portfolioId is required.");
      return Response.json(await placeOptionStrategy({ portfolioId: body.portfolioId, units: Number(body.units), legs: body.legs, orderType: body.orderType, netLimitPrice: body.netLimitPrice }), { status: 201 });
    }
    return Response.json(await previewOptionStrategy(body.legs, Number(body.units)));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to process the strategy." }, { status: 400 }); }
}
