import type { AssetClass } from "../../../lib/domain";
import type { OptionContract } from "../../../lib/market/options";
import type { ForwardContract, FutureContract } from "../../../lib/market/derivatives";
import { cancelOrder, placeOrder, replaceOrderPrice } from "../../../lib/trading/store";
import { enumValue, optionalPositiveNumber, portfolioId as validPortfolioId, positiveNumber, requiredString } from "../../../lib/trading/validation";
import { normalizeRequestId, withPortfolioMutation } from "../../../lib/trading/mutation";
import { apiErrorResponse } from "../../../lib/http/api-error";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { portfolioId?: string; symbol?: string; assetClass?: AssetClass; side?: "buy" | "sell"; orderType?: "market" | "limit" | "stop" | "stop_limit"; quantity?: number; limitPrice?: number; stopPrice?: number; timeInForce?: "day" | "gtc"; optionContract?: OptionContract; futureContract?: FutureContract; forwardContract?: ForwardContract };
    const portfolioId = validPortfolioId(body.portfolioId), requestId = normalizeRequestId(request.headers.get("idempotency-key"));
    const result = await withPortfolioMutation(portfolioId, () => placeOrder({
      portfolioId,
      symbol: requiredString(body.symbol, "Symbol", 40),
      assetClass: enumValue(body.assetClass, ["equity", "crypto", "future", "forward", "option"] as const, "Asset class"),
      side: enumValue(body.side, ["buy", "sell"] as const, "Side"),
      orderType: enumValue(body.orderType, ["market", "limit", "stop", "stop_limit"] as const, "Order type"),
      quantity: positiveNumber(body.quantity, "Quantity", { maximum: 1_000_000_000 }),
      limitPrice: optionalPositiveNumber(body.limitPrice, "Limit price"),
      stopPrice: optionalPositiveNumber(body.stopPrice, "Stop price"),
      timeInForce: enumValue(body.timeInForce, ["day", "gtc"] as const, "Time in force"),
      optionContract: body.optionContract,
      futureContract: body.futureContract,
      forwardContract: body.forwardContract,
      requestId,
    }));
    return Response.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) { return apiErrorResponse(error, "Unable to submit order."); }
}

export async function DELETE(request: Request) {
  try {
    const params = new URL(request.url).searchParams, portfolioId = params.get("portfolioId"), orderId = params.get("orderId");
    const id = validPortfolioId(portfolioId);
    return Response.json(await withPortfolioMutation(id, () => cancelOrder(id, requiredString(orderId, "orderId", 128))));
  } catch (error) { return apiErrorResponse(error, "Unable to cancel order."); }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { portfolioId?: string; orderId?: string; limitPrice?: number; stopPrice?: number };
    const id = validPortfolioId(body.portfolioId);
    return Response.json(await withPortfolioMutation(id, () => replaceOrderPrice(id, requiredString(body.orderId, "orderId", 128), optionalPositiveNumber(body.limitPrice, "Limit price"), optionalPositiveNumber(body.stopPrice, "Stop price"))));
  } catch (error) { return apiErrorResponse(error, "Unable to replace order."); }
}
