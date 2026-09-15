import type { AssetClass } from "../../../lib/domain";
import type { OptionContract } from "../../../lib/market/options";
import type { ForwardContract, FutureContract } from "../../../lib/market/derivatives";
import { cancelOrder, placeOrder } from "../../../lib/trading/store";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { portfolioId?: string; symbol?: string; assetClass?: AssetClass; side?: "buy" | "sell"; orderType?: "market" | "limit"; quantity?: number; limitPrice?: number; timeInForce?: "day" | "gtc"; optionContract?: OptionContract; futureContract?: FutureContract; forwardContract?: ForwardContract };
    if (!body.portfolioId || !body.symbol || !body.assetClass || !body.side || !body.orderType || !body.timeInForce) throw new Error("Missing required order details.");
    const result = await placeOrder({ portfolioId: body.portfolioId, symbol: body.symbol, assetClass: body.assetClass, side: body.side, orderType: body.orderType, quantity: Number(body.quantity), limitPrice: body.limitPrice, timeInForce: body.timeInForce, optionContract: body.optionContract, futureContract: body.futureContract, forwardContract: body.forwardContract });
    return Response.json(result, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to submit order." }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    const params = new URL(request.url).searchParams, portfolioId = params.get("portfolioId"), orderId = params.get("orderId");
    if (!portfolioId || !orderId) throw new Error("portfolioId and orderId are required.");
    return Response.json(await cancelOrder(portfolioId, orderId));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to cancel order." }, { status: 400 }); }
}
