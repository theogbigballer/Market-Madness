import type { AssetClass } from "../../../lib/domain";
import { placeOrder } from "../../../lib/trading/store";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { portfolioId?: string; symbol?: string; assetClass?: AssetClass; side?: "buy" | "sell"; orderType?: "market" | "limit"; quantity?: number; limitPrice?: number; timeInForce?: "day" | "gtc" };
    if (!body.portfolioId || !body.symbol || !body.assetClass || !body.side || !body.orderType || !body.timeInForce) throw new Error("Missing required order details.");
    const result = await placeOrder({ portfolioId: body.portfolioId, symbol: body.symbol, assetClass: body.assetClass, side: body.side, orderType: body.orderType, quantity: Number(body.quantity), limitPrice: body.limitPrice, timeInForce: body.timeInForce });
    return Response.json(result, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to submit order." }, { status: 400 }); }
}
