import { compareDecimal, compareMoney, multiplyMoney, subtractDecimal } from "./money.ts";

export function planOptionExpiry(input: { right: "call" | "put"; strike: number | string; spot: number | string; positionQuantity: number; multiplier?: number; exerciseThreshold?: number }) {
  const intrinsicDecimal = input.right === "call" ? subtractDecimal(input.spot, input.strike) : subtractDecimal(input.strike, input.spot);
  const intrinsic = Number(intrinsicDecimal);
  const threshold = input.exerciseThreshold ?? 0.01;
  if (compareDecimal(intrinsicDecimal, threshold) < 0) return { action: "expire" as const, intrinsic: Math.max(0, intrinsic), underlyingQuantity: 0, cashImpact: "0.00" };
  const multiplier = input.multiplier ?? 100;
  const underlyingQuantity = (input.right === "call" ? 1 : -1) * input.positionQuantity * multiplier;
  return {
    action: input.positionQuantity > 0 ? "exercise" as const : "assignment" as const,
    intrinsic,
    underlyingQuantity,
    cashImpact: multiplyMoney(-underlyingQuantity, input.strike),
  };
}

export function derivativeSettlementAmount(input: { entryPrice: number | string; settlementPrice: number | string; signedQuantity: number; multiplier: number }) {
  return multiplyMoney(subtractDecimal(input.settlementPrice, input.entryPrice), input.signedQuantity, input.multiplier);
}

export function requiresMarginLiquidation(equity: number | string, maintenance: number | string, buffer = 1.1) {
  return compareMoney(equity, multiplyMoney(maintenance, buffer)) < 0;
}
