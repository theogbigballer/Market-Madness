import type { OptionContract, OptionGreeks } from "../market/options";
import { getOptionQuote, optionSymbol } from "../market/options";
import { getMarketQuote } from "../market/quotes";

export type OptionStrategyLeg = { contract: OptionContract; side: "buy" | "sell"; ratio: number };

export async function previewOptionStrategy(legs: OptionStrategyLeg[], units = 1) {
  if (!Number.isInteger(units) || units < 1) throw new Error("Strategy quantity must be a positive whole number.");
  if (legs.length < 2 || legs.length > 4) throw new Error("A strategy requires between two and four legs.");
  const underlying = legs[0].contract.underlying.toUpperCase(), expiration = legs[0].contract.expiration;
  if (legs.some((leg) => leg.contract.underlying.toUpperCase() !== underlying || leg.contract.expiration !== expiration)) throw new Error("All legs must share an underlying and expiration.");
  if (legs.some((leg) => !Number.isInteger(leg.ratio) || leg.ratio < 1 || leg.contract.strike <= 0)) throw new Error("Each leg needs a positive whole-number ratio and strike.");
  const underlyingQuote = await getMarketQuote(underlying, "equity");
  const quoted = await Promise.all(legs.map(async (leg) => ({ ...leg, quote: await getOptionQuote({ ...leg.contract, underlying }, underlyingQuote) })));
  const netDebitPerUnit = quoted.reduce((sum, leg) => sum + (leg.side === "buy" ? Number(leg.quote.ask) : -Number(leg.quote.bid)) * leg.ratio * 100, 0);
  const netCallSlope = legs.reduce((sum, leg) => sum + (leg.contract.right === "call" ? (leg.side === "buy" ? 1 : -1) * leg.ratio * 100 : 0), 0);
  const strikes = [...new Set(legs.map((leg) => leg.contract.strike))].sort((a, b) => a - b);
  const payoff = (spot: number) => legs.reduce((sum, leg) => {
    const intrinsic = Math.max(0, leg.contract.right === "call" ? spot - leg.contract.strike : leg.contract.strike - spot);
    return sum + intrinsic * leg.ratio * 100 * (leg.side === "buy" ? 1 : -1);
  }, -netDebitPerUnit);
  const checkpoints = [0, ...strikes, Math.max(...strikes) * 4];
  const values = checkpoints.map(payoff);
  const unboundedLoss = netCallSlope < 0, unboundedProfit = netCallSlope > 0;
  const maxLossPerUnit = unboundedLoss ? null : Math.max(0, -Math.min(...values));
  const maxProfitPerUnit = unboundedProfit ? null : Math.max(...values);
  const breakevens: number[] = [];
  const boundaries = [0, ...strikes, Math.max(...strikes) * 4];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const left = boundaries[index], right = boundaries[index + 1], leftPnl = payoff(left), rightPnl = payoff(right);
    if (leftPnl === 0) breakevens.push(left);
    if (leftPnl * rightPnl < 0) breakevens.push(left + (right - left) * (-leftPnl / (rightPnl - leftPnl)));
  }
  const greeks = quoted.reduce<OptionGreeks>((total, leg) => {
    const sign = leg.side === "buy" ? 1 : -1, scale = sign * leg.ratio * units * 100;
    total.delta += leg.quote.analytics.greeks.delta * scale;
    total.gamma += leg.quote.analytics.greeks.gamma * scale;
    total.theta += leg.quote.analytics.greeks.theta * scale;
    total.vega += leg.quote.analytics.greeks.vega * scale;
    return total;
  }, { delta: 0, gamma: 0, theta: 0, vega: 0 });
  return {
    underlying, expiration, units,
    netDebit: netDebitPerUnit * units,
    netPrice: netDebitPerUnit / 100,
    maxLoss: maxLossPerUnit === null ? null : maxLossPerUnit * units,
    maxProfit: maxProfitPerUnit === null ? null : maxProfitPerUnit * units,
    breakevens: [...new Set(breakevens.map((value) => Number(value.toFixed(2))))], greeks,
    unboundedRisk: unboundedLoss,
    legs: quoted.map((leg) => ({ contract: leg.contract, side: leg.side, ratio: leg.ratio, symbol: optionSymbol(leg.contract), bid: Number(leg.quote.bid), ask: Number(leg.quote.ask), mark: Number(leg.quote.mark), executionPrice: Number(leg.side === "buy" ? leg.quote.ask : leg.quote.bid), provider: leg.quote.provider, quality: leg.quote.quality, observedAt: leg.quote.observedAt, analytics: leg.quote.analytics })),
    quality: "indicative" as const,
  };
}
