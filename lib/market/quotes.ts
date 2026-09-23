import type { AssetClass, NormalizedQuote } from "../domain";
import { classifyEquityQuoteQuality, quoteIsStale } from "../domain";
import { env } from "cloudflare:workers";
import { ensureCoreSchema, getD1 } from "../../db/runtime";
import { getUsEquitySession } from "./exchange-calendar";
import { deribitDiagnostics } from "./deribit";

const catalog: Record<string, { name: string; base: number; spread: number; averageDailyVolume: number }> = {
  AAPL: { name: "Apple Inc.", base: 238.12, spread: 0.04, averageDailyVolume: 52_000_000 },
  AMZN: { name: "Amazon.com Inc.", base: 231.44, spread: 0.05, averageDailyVolume: 41_000_000 },
  META: { name: "Meta Platforms", base: 742.18, spread: 0.12, averageDailyVolume: 17_000_000 },
  MSFT: { name: "Microsoft Corp.", base: 514.36, spread: 0.06, averageDailyVolume: 23_000_000 },
  NVDA: { name: "NVIDIA Corp.", base: 184.92, spread: 0.04, averageDailyVolume: 176_000_000 },
  QQQ: { name: "Invesco QQQ Trust", base: 603.28, spread: 0.02, averageDailyVolume: 48_000_000 },
  SPY: { name: "SPDR S&P 500 ETF", base: 676.41, spread: 0.02, averageDailyVolume: 72_000_000 },
  TSLA: { name: "Tesla Inc.", base: 424.73, spread: 0.11, averageDailyVolume: 91_000_000 },
  AMD: { name: "Advanced Micro Devices", base: 164.32, spread: 0.05, averageDailyVolume: 48_000_000 },
  AVGO: { name: "Broadcom Inc.", base: 346.18, spread: 0.08, averageDailyVolume: 24_000_000 },
  "BRK.B": { name: "Berkshire Hathaway Class B", base: 502.16, spread: 0.12, averageDailyVolume: 4_000_000 },
  COST: { name: "Costco Wholesale", base: 946.21, spread: 0.15, averageDailyVolume: 2_000_000 },
  DIA: { name: "SPDR Dow Jones Industrial Average ETF", base: 465.11, spread: 0.03, averageDailyVolume: 4_000_000 },
  GOOGL: { name: "Alphabet Class A", base: 245.68, spread: 0.05, averageDailyVolume: 31_000_000 },
  HD: { name: "Home Depot", base: 401.74, spread: 0.08, averageDailyVolume: 3_000_000 },
  IWM: { name: "iShares Russell 2000 ETF", base: 248.51, spread: 0.03, averageDailyVolume: 32_000_000 },
  JPM: { name: "JPMorgan Chase", base: 315.43, spread: 0.05, averageDailyVolume: 10_000_000 },
  NFLX: { name: "Netflix Inc.", base: 1238.44, spread: 0.22, averageDailyVolume: 4_000_000 },
  UNH: { name: "UnitedHealth Group", base: 356.19, spread: 0.12, averageDailyVolume: 7_000_000 },
  V: { name: "Visa Class A", base: 351.72, spread: 0.05, averageDailyVolume: 7_000_000 },
  VTI: { name: "Vanguard Total Stock Market ETF", base: 334.92, spread: 0.03, averageDailyVolume: 5_000_000 },
  XOM: { name: "Exxon Mobil", base: 132.54, spread: 0.04, averageDailyVolume: 17_000_000 },
  "BTC-USD": { name: "Bitcoin / US Dollar", base: 116842, spread: 18, averageDailyVolume: 25_000 },
  "ETH-USD": { name: "Ether / US Dollar", base: 4480, spread: 1.4, averageDailyVolume: 80_000 },
  "SOL-USD": { name: "Solana / US Dollar", base: 236, spread: 0.18, averageDailyVolume: 160_000 },
  "AVAX-USD": { name: "Avalanche / US Dollar", base: 31, spread: 0.05, averageDailyVolume: 90_000 },
  "XRP-USD": { name: "XRP / US Dollar", base: 2.85, spread: 0.002, averageDailyVolume: 450_000 },
  "ADA-USD": { name: "Cardano / US Dollar", base: 0.86, spread: 0.002, averageDailyVolume: 400_000 },
  "DOGE-USD": { name: "Dogecoin / US Dollar", base: 0.24, spread: 0.001, averageDailyVolume: 500_000 },
  "LINK-USD": { name: "Chainlink / US Dollar", base: 22.4, spread: 0.03, averageDailyVolume: 110_000 },
  "LTC-USD": { name: "Litecoin / US Dollar", base: 118, spread: 0.08, averageDailyVolume: 70_000 },
  "BCH-USD": { name: "Bitcoin Cash / US Dollar", base: 598, spread: 0.4, averageDailyVolume: 35_000 },
};

export function supportedSymbols(query = "", assetClass?: "equity" | "crypto") {
  const needle = query.trim().toUpperCase();
  return Object.entries(catalog).filter(([symbol, value]) => (!assetClass || (symbol.endsWith("-USD") ? "crypto" : "equity") === assetClass) && (!needle || symbol.includes(needle) || value.name.toUpperCase().includes(needle))).slice(0, 20).map(([symbol, value]) => ({ symbol, name: value.name, assetClass: symbol.endsWith("-USD") ? "crypto" as const : "equity" as const }));
}

export function getDemoQuote(symbolInput: string, assetClass: AssetClass = "equity"): NormalizedQuote & { name: string; averageDailyVolume: number } {
  const symbol = symbolInput.trim().toUpperCase();
  const symbolSeed = [...symbol].reduce((total, character) => total + character.charCodeAt(0), 0);
  const item = catalog[symbol] || { name: `${symbol} simulated instrument`, base: assetClass === "crypto" ? 10 + symbolSeed % 190 : 25 + symbolSeed % 475, spread: assetClass === "crypto" ? 0.12 : 0.05, averageDailyVolume: assetClass === "crypto" ? 50_000 : 2_000_000 };
  const bucket = Math.floor(Date.now() / 30_000);
  const movement = Math.sin((bucket + symbolSeed) / 9) * item.base * (assetClass === "crypto" ? 0.002 : 0.0007);
  const mark = item.base + movement;
  return {
    instrumentId: `${assetClass}:${symbol}`, provider: "Market Madness demonstration feed", quality: "simulated",
    bid: (mark - item.spread / 2).toFixed(2), ask: (mark + item.spread / 2).toFixed(2), last: mark.toFixed(2), mark: mark.toFixed(2),
    observedAt: new Date().toISOString(), name: item.name, averageDailyVolume: item.averageDailyVolume,
  };
}

type ExtendedQuote = ReturnType<typeof getDemoQuote>;
type ProviderState = { lastSuccess: string | null; lastFailure: string | null; consecutiveFailures: number; lastError: string | null };
const providerState: Record<"alpaca" | "coinbase", ProviderState> = { alpaca: { lastSuccess: null, lastFailure: null, consecutiveFailures: 0, lastError: null }, coinbase: { lastSuccess: null, lastFailure: null, consecutiveFailures: 0, lastError: null } };
const quoteCache = new Map<string, { quote: ExtendedQuote; cachedAt: number }>();
function success(provider: "alpaca" | "coinbase") { providerState[provider] = { lastSuccess: new Date().toISOString(), lastFailure: providerState[provider].lastFailure, consecutiveFailures: 0, lastError: null }; }
function failure(provider: "alpaca" | "coinbase", error: unknown) { const current = providerState[provider]; providerState[provider] = { ...current, lastFailure: new Date().toISOString(), consecutiveFailures: current.consecutiveFailures + 1, lastError: error instanceof Error ? error.message : "Provider request failed." }; }

export function marketDataDiagnostics() {
  const runtime = env as unknown as { ALPACA_API_KEY_ID?: string; ALPACA_API_SECRET_KEY?: string };
  return [
    { id: "alpaca", name: "Alpaca IEX", assetClasses: ["US equities"], mode: runtime.ALPACA_API_KEY_ID && runtime.ALPACA_API_SECRET_KEY ? "configured" : "not configured", priority: 1, ...providerState.alpaca },
    { id: "coinbase", name: "Coinbase Exchange", assetClasses: ["Crypto / USD"], mode: "public API", priority: 1, ...providerState.coinbase },
    deribitDiagnostics(),
    { id: "simulation", name: "Market Madness fallback", assetClasses: ["Equities", "Crypto", "Derivatives"], mode: "always available", priority: 2, lastSuccess: new Date().toISOString(), lastFailure: null, consecutiveFailures: 0, lastError: null },
  ];
}

async function alpacaQuote(symbol: string): Promise<ExtendedQuote | null> {
  const runtime = env as unknown as { ALPACA_API_KEY_ID?: string; ALPACA_API_SECRET_KEY?: string };
  if (!runtime.ALPACA_API_KEY_ID || !runtime.ALPACA_API_SECRET_KEY) return null;
  const response = await fetch(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest?feed=iex`, {
    headers: { "APCA-API-KEY-ID": runtime.ALPACA_API_KEY_ID, "APCA-API-SECRET-KEY": runtime.ALPACA_API_SECRET_KEY },
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) throw new Error(`Alpaca returned ${response.status}.`);
  const payload = await response.json() as { quote?: { bp?: number; ap?: number; t?: string } };
  const item = catalog[symbol] || { name: symbol, spread: 0.05, averageDailyVolume: 2_000_000 };
  let bid = payload.quote?.bp, ask = payload.quote?.ap, observedAt = payload.quote?.t || new Date().toISOString(), provider = "Alpaca IEX";
  if (!bid || !ask) {
    const tradeResponse = await fetch(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/trades/latest?feed=iex`, {
      headers: { "APCA-API-KEY-ID": runtime.ALPACA_API_KEY_ID, "APCA-API-SECRET-KEY": runtime.ALPACA_API_SECRET_KEY }, signal: AbortSignal.timeout(4_000),
    });
    if (!tradeResponse.ok) throw new Error(`Alpaca latest trade returned ${tradeResponse.status}.`);
    const tradePayload = await tradeResponse.json() as { trade?: { p?: number; t?: string } };
    const trade = tradePayload.trade?.p;
    if (!trade) throw new Error("Alpaca did not return a usable quote or trade.");
    const spread = Math.max(item.spread, trade * 0.0001);
    bid = trade - spread / 2; ask = trade + spread / 2; observedAt = tradePayload.trade?.t || observedAt; provider = "Alpaca IEX · latest trade reference";
  }
  const mark = (bid + ask) / 2;
  const quote = { instrumentId: `equity:${symbol}`, provider, quality: "live", bid: bid.toFixed(2), ask: ask.toFixed(2), last: mark.toFixed(2), mark: mark.toFixed(2), observedAt, name: item.name, averageDailyVolume: item.averageDailyVolume } satisfies ExtendedQuote;
  success("alpaca");
  return { ...quote, quality: classifyEquityQuoteQuality(quote.observedAt, getUsEquitySession().isOpen) };
}

async function coinbaseQuote(symbol: string): Promise<ExtendedQuote | null> {
  if (!symbol.endsWith("-USD")) return null;
  const response = await fetch(`https://api.exchange.coinbase.com/products/${encodeURIComponent(symbol)}/ticker`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4_000) });
  if (!response.ok) throw new Error(`Coinbase returned ${response.status}.`);
  const payload = await response.json() as { bid?: string; ask?: string; price?: string; time?: string };
  if (!payload.bid || !payload.ask || !payload.price) throw new Error("Coinbase did not return a complete quote.");
  const item = catalog[symbol] || { name: symbol.replace("-USD", " / US Dollar"), averageDailyVolume: 50_000 };
  const quote = { instrumentId: `crypto:${symbol}`, provider: "Coinbase Exchange", quality: "live", bid: Number(payload.bid).toFixed(2), ask: Number(payload.ask).toFixed(2), last: Number(payload.price).toFixed(2), mark: Number(payload.price).toFixed(2), observedAt: payload.time || new Date().toISOString(), name: item.name, averageDailyVolume: item.averageDailyVolume } satisfies ExtendedQuote;
  success("coinbase"); return quoteIsStale(quote.observedAt, new Date(), 90) ? { ...quote, quality: "stale" } : quote;
}

export async function getMarketQuote(symbolInput: string, assetClass: AssetClass = "equity", applyCorporateActions = true): Promise<ExtendedQuote> {
  const symbol = symbolInput.trim().toUpperCase();
  if (!/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) throw new Error("Enter a valid ticker symbol.");
  const cacheKey = `${assetClass}:${symbol}`;
  let quote: ExtendedQuote;
  try {
    const live = assetClass === "crypto" ? await coinbaseQuote(symbol) : assetClass === "equity" ? await alpacaQuote(symbol) : null;
    quote = live || getDemoQuote(symbol, assetClass);
    if (live) quoteCache.set(cacheKey, { quote: live, cachedAt: Date.now() });
  } catch (error) {
    if (assetClass === "crypto") failure("coinbase", error); else if (assetClass === "equity") failure("alpaca", error);
    const cached = quoteCache.get(cacheKey), fallback = getDemoQuote(symbol, assetClass);
    quote = cached && Date.now() - cached.cachedAt < 5 * 60_000 ? { ...cached.quote, quality: "stale", provider: `${cached.quote.provider} · cached after provider failure` } : { ...fallback, provider: `${fallback.provider} · live provider unavailable` };
  }
  if (assetClass !== "equity" || !applyCorporateActions) return quote;
  try {
    await ensureCoreSchema();
    const actions = await getD1().prepare("SELECT ratio FROM corporate_actions WHERE instrument_id = ? AND action_type = 'split' AND status = 'applied' AND source = 'manual_simulation'").bind(`equity:${symbol}`).all<{ ratio: string }>();
    const adjustment = actions.results.reduce((factor, action) => factor * Number(action.ratio), 1);
    if (adjustment === 1) return quote;
    const adjusted = (value?: string) => value === undefined ? undefined : (Number(value) / adjustment).toFixed(2);
    return { ...quote, bid: adjusted(quote.bid), ask: adjusted(quote.ask), last: adjusted(quote.last), mark: adjusted(quote.mark)!, provider: `${quote.provider} · simulated split-adjusted` };
  } catch { return quote; }
}

export function estimateExecution(quote: ReturnType<typeof getDemoQuote>, side: "buy" | "sell", quantity: number) {
  const reference = Number(side === "buy" ? quote.ask : quote.bid);
  const participation = Math.max(0, quantity / quote.averageDailyVolume);
  const impactBps = Math.min(200, Math.sqrt(participation) * 75);
  const direction = side === "buy" ? 1 : -1;
  const price = reference * (1 + direction * impactBps / 10_000);
  return { price: Number(price.toFixed(2)), slippage: Number((Math.abs(price - reference) * quantity).toFixed(2)), impactBps: Number(impactBps.toFixed(2)), model: "bid/ask + square-root participation" };
}
