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

export function netSignedQuantity<T extends { quantity: number }>(incomingQuantity: number, lots: T[]) {
  let remaining = incomingQuantity;
  const closures: { lot: T; quantity: number; nextQuantity: number }[] = [];
  for (const lot of lots.filter((item) => item.quantity * incomingQuantity < 0)) {
    if (Math.abs(remaining) < 1e-9) break;
    const closed = Math.min(Math.abs(remaining), Math.abs(lot.quantity));
    const nextQuantity = lot.quantity + Math.sign(remaining) * closed;
    remaining -= Math.sign(remaining) * closed;
    closures.push({ lot, quantity: closed, nextQuantity });
  }
  return { remaining, closures };
}

export function strategyLimitIsMarketable(side: "buy" | "sell", currentNetPrice: number, limitPrice: number) {
  return side === "buy" ? currentNetPrice <= limitPrice : Math.abs(currentNetPrice) >= limitPrice;
}

export type OptionMarginPosition = { underlying: string; expiration: string; right: "call" | "put"; strike: number; quantity: number; spot: number; mark: number };

export function calculatePortfolioOptionMargin(positions: OptionMarginPosition[], equityShares: Record<string, number>) {
  const groups = new Map<string, OptionMarginPosition[]>();
  for (const position of positions) {
    const key = `${position.underlying}:${position.expiration}`;
    groups.set(key, [...(groups.get(key) || []), { ...position }]);
  }
  const shares = { ...equityShares };
  let requirement = 0, definedRiskOffsets = 0, coveredContracts = 0, uncoveredContracts = 0;
  for (const legs of [...groups.values()].sort((left, right) => left[0].expiration.localeCompare(right[0].expiration))) {
    const sideRequirement = (right: "call" | "put") => {
      const longs = legs.filter((leg) => leg.right === right && leg.quantity > 0).map((leg) => ({ ...leg, available: leg.quantity }));
      const shorts = legs.filter((leg) => leg.right === right && leg.quantity < 0).map((leg) => ({ ...leg, remaining: Math.abs(leg.quantity) }));
      let required = 0, uncovered = 0;
      for (const short of shorts) {
        if (right === "call") {
          const cover = Math.min(short.remaining, Math.floor(Math.max(0, shares[short.underlying] || 0) / 100));
          short.remaining -= cover; shares[short.underlying] = (shares[short.underlying] || 0) - cover * 100; coveredContracts += cover;
        }
        const protective = longs.filter((long) => long.available > 0 && (right === "call" ? long.strike > short.strike : long.strike < short.strike)).sort((left, rightLeg) => Math.abs(left.strike - short.strike) - Math.abs(rightLeg.strike - short.strike));
        for (const long of protective) {
          if (!short.remaining) break;
          const paired = Math.min(short.remaining, long.available), width = Math.abs(long.strike - short.strike);
          required += paired * width * 100; definedRiskOffsets += paired * Math.max(0, short.spot * 0.2 - width) * 100;
          short.remaining -= paired; long.available -= paired;
        }
        if (short.remaining) {
          const outOfMoney = right === "call" ? Math.max(0, short.strike - short.spot) : Math.max(0, short.spot - short.strike);
          const perContract = Math.max(short.spot * 0.2 - outOfMoney + short.mark, short.spot * 0.1 + short.mark) * 100;
          required += short.remaining * perContract; uncovered += short.remaining; uncoveredContracts += short.remaining;
        }
      }
      return { required, uncovered };
    };
    const calls = sideRequirement("call"), puts = sideRequirement("put");
    if (!calls.uncovered && !puts.uncovered && calls.required > 0 && puts.required > 0) {
      requirement += Math.max(calls.required, puts.required); definedRiskOffsets += Math.min(calls.required, puts.required);
    } else requirement += calls.required + puts.required;
  }
  return { requirement, definedRiskOffsets, coveredContracts, uncoveredContracts };
}
