import type { NormalizedQuote } from "../domain";

export function orderIsMarketable(input: { side: "buy" | "sell"; orderType: "market" | "limit" | "stop" | "stop_limit"; mark: number; estimatedPrice: number; limitPrice?: number | null; stopPrice?: number | null }) {
  const stopTriggered = input.orderType === "stop" || input.orderType === "stop_limit" ? input.side === "buy" ? input.mark >= Number(input.stopPrice) : input.mark <= Number(input.stopPrice) : true;
  const limitSatisfied = input.orderType === "limit" || input.orderType === "stop_limit" ? input.side === "buy" ? Number(input.limitPrice) >= input.estimatedPrice : Number(input.limitPrice) <= input.estimatedPrice : true;
  return stopTriggered && limitSatisfied;
}

export function buildFillAudit(input: { quote?: Pick<NormalizedQuote, "provider" | "quality" | "observedAt" | "bid" | "ask" | "mark">; price: number; slippage: number; model: string; context: string }) {
  const referencePrice = Number(input.quote?.mark ?? input.price);
  return {
    quoteProvider: input.quote?.provider || "Contract terms",
    quoteQuality: input.quote?.quality || "reconstructed",
    quoteObservedAt: input.quote?.observedAt || null,
    quoteBid: input.quote?.bid || null,
    quoteAsk: input.quote?.ask || null,
    referencePrice: referencePrice.toFixed(6),
    assumptions: JSON.stringify({ context: input.context, model: input.model, referencePrice, executionPrice: input.price, slippage: input.slippage }),
  };
}
