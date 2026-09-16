export function calculateRealizedPnl(input: {
  entryPrice: number;
  exitPrice: number;
  signedOpenQuantity: number;
  closedQuantity: number;
  multiplier: number;
}) {
  if (![input.entryPrice, input.exitPrice, input.signedOpenQuantity, input.closedQuantity, input.multiplier].every(Number.isFinite)) throw new Error("Realized P&L inputs must be finite numbers.");
  if (input.signedOpenQuantity === 0 || input.closedQuantity < 0 || input.multiplier <= 0) throw new Error("Realized P&L requires a non-zero open lot, non-negative close quantity, and positive multiplier.");
  return (input.exitPrice - input.entryPrice) * Math.sign(input.signedOpenQuantity) * input.closedQuantity * input.multiplier;
}

export function calculateFlowAdjustedPnl(netLiquidationValue: number, startingCapital: number, externalCashFlows: number) {
  return netLiquidationValue - startingCapital - externalCashFlows;
}

export function strategyLimitIsMarketable(side: "buy" | "sell", currentNetPrice: number, limitPrice: number) {
  return side === "buy" ? currentNetPrice <= limitPrice : Math.abs(currentNetPrice) >= limitPrice;
}
