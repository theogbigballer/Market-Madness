import type { NormalizedQuote } from "../domain";
import { getMarketQuote } from "./quotes";

export type OptionContract = {
  underlying: string;
  expiration: string;
  strike: number;
  right: "call" | "put";
  exerciseStyle: "american" | "european";
};

export type OptionGreeks = { delta: number; gamma: number; theta: number; vega: number };
export type OptionAnalytics = { spot: number; volatility: number; years: number; intrinsic: number; extrinsic: number; greeks: OptionGreeks };

function normalCdf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function normalPdf(value: number) { return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI); }

export async function getOptionAnalytics(contract: OptionContract, suppliedQuote?: NormalizedQuote): Promise<OptionAnalytics> {
  const underlyingQuote = suppliedQuote || await getMarketQuote(contract.underlying.toUpperCase(), "equity");
  const spot = Number(underlyingQuote.mark), strike = contract.strike;
  const expiration = new Date(`${contract.expiration}T20:00:00.000Z`);
  const years = Math.max(0, (expiration.getTime() - Date.now()) / (365.25 * 24 * 60 * 60 * 1000));
  const volatility = ["TSLA", "NVDA"].includes(contract.underlying.toUpperCase()) ? 0.45 : 0.28;
  const intrinsic = Math.max(0, contract.right === "call" ? spot - strike : strike - spot);
  if (years <= 0) return { spot, volatility, years, intrinsic, extrinsic: 0, greeks: { delta: intrinsic > 0 ? (contract.right === "call" ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0 } };
  const rootT = Math.sqrt(years), sigmaRootT = volatility * rootT;
  const d1 = (Math.log(spot / strike) + 0.5 * volatility * volatility * years) / sigmaRootT;
  const value = optionValue(spot, strike, years, volatility, contract.right);
  const delta = contract.right === "call" ? normalCdf(d1) : normalCdf(d1) - 1;
  const gamma = normalPdf(d1) / (spot * sigmaRootT);
  const theta = -(spot * normalPdf(d1) * volatility) / (2 * rootT * 365);
  const vega = spot * normalPdf(d1) * rootT / 100;
  return { spot, volatility, years, intrinsic, extrinsic: Math.max(0, value - intrinsic), greeks: { delta, gamma, theta, vega } };
}

function optionValue(spot: number, strike: number, years: number, volatility: number, right: "call" | "put") {
  if (years <= 0) return Math.max(0, right === "call" ? spot - strike : strike - spot);
  const sigmaRootT = volatility * Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + 0.5 * volatility * volatility * years) / sigmaRootT;
  const d2 = d1 - sigmaRootT;
  const european = right === "call"
    ? spot * normalCdf(d1) - strike * normalCdf(d2)
    : strike * normalCdf(-d2) - spot * normalCdf(-d1);
  return Math.max(european, right === "call" ? spot - strike : strike - spot, 0.01);
}

export function optionSymbol(contract: OptionContract) {
  const date = contract.expiration.replaceAll("-", "").slice(2);
  return `${contract.underlying.toUpperCase()} ${date}${contract.right === "call" ? "C" : "P"}${contract.strike.toFixed(2)} ${contract.exerciseStyle === "american" ? "A" : "E"}`;
}

export async function getOptionQuote(contract: OptionContract, suppliedUnderlyingQuote?: NormalizedQuote): Promise<NormalizedQuote & { name: string; averageDailyVolume: number; analytics: OptionAnalytics }> {
  const underlying = contract.underlying.toUpperCase();
  const underlyingQuote = suppliedUnderlyingQuote || await getMarketQuote(underlying, "equity");
  const analytics = await getOptionAnalytics(contract, underlyingQuote);
  const { spot, years, volatility } = analytics;
  const mark = optionValue(spot, contract.strike, years, volatility, contract.right);
  const spread = Math.max(0.02, mark * 0.06);
  const symbol = optionSymbol(contract);
  return {
    instrumentId: `option:${symbol}`, provider: `Market Madness options model · ${underlyingQuote.provider}`,
    quality: "indicative", bid: Math.max(0.01, mark - spread / 2).toFixed(2), ask: (mark + spread / 2).toFixed(2),
    last: mark.toFixed(2), mark: mark.toFixed(2), observedAt: underlyingQuote.observedAt,
    name: `${underlying} ${contract.expiration} ${contract.strike} ${contract.right.toUpperCase()} · ${contract.exerciseStyle}`,
    averageDailyVolume: 5_000, analytics,
  };
}

function thirdFriday(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  return new Date(Date.UTC(year, month, 1 + ((5 - first.getUTCDay() + 7) % 7) + 14));
}

export async function optionChain(underlyingInput: string) {
  const underlying = underlyingInput.toUpperCase();
  const quote = await getMarketQuote(underlying, "equity");
  const spot = Number(quote.mark), today = new Date();
  const expirations: string[] = [];
  for (let offset = 0; expirations.length < 6 && offset < 9; offset += 1) {
    const expiry = thirdFriday(today.getUTCFullYear(), today.getUTCMonth() + offset);
    if (expiry.getTime() > today.getTime() + 24 * 60 * 60 * 1000) expirations.push(expiry.toISOString().slice(0, 10));
  }
  const increment = spot < 100 ? 2.5 : spot < 300 ? 5 : 10;
  const center = Math.round(spot / increment) * increment;
  const strikes = Array.from({ length: 13 }, (_, index) => center + (index - 6) * increment).filter((strike) => strike > 0);
  return { underlying, underlyingQuote: quote, expirations, strikes };
}
