import type { AssetClass, NormalizedQuote } from "../domain";

const catalog: Record<string, { name: string; base: number; spread: number; averageDailyVolume: number }> = {
  AAPL: { name: "Apple Inc.", base: 238.12, spread: 0.04, averageDailyVolume: 52_000_000 },
  AMZN: { name: "Amazon.com Inc.", base: 231.44, spread: 0.05, averageDailyVolume: 41_000_000 },
  META: { name: "Meta Platforms", base: 742.18, spread: 0.12, averageDailyVolume: 17_000_000 },
  MSFT: { name: "Microsoft Corp.", base: 514.36, spread: 0.06, averageDailyVolume: 23_000_000 },
  NVDA: { name: "NVIDIA Corp.", base: 184.92, spread: 0.04, averageDailyVolume: 176_000_000 },
  QQQ: { name: "Invesco QQQ Trust", base: 603.28, spread: 0.02, averageDailyVolume: 48_000_000 },
  SPY: { name: "SPDR S&P 500 ETF", base: 676.41, spread: 0.02, averageDailyVolume: 72_000_000 },
  TSLA: { name: "Tesla Inc.", base: 424.73, spread: 0.11, averageDailyVolume: 91_000_000 },
  "BTC-USD": { name: "Bitcoin / US Dollar", base: 116842, spread: 18, averageDailyVolume: 25_000 },
};

export function supportedSymbols() { return Object.entries(catalog).map(([symbol, value]) => ({ symbol, name: value.name })); }

export function getDemoQuote(symbolInput: string, assetClass: AssetClass = "equity"): NormalizedQuote & { name: string; averageDailyVolume: number } {
  const symbol = symbolInput.trim().toUpperCase();
  const item = catalog[symbol];
  if (!item) throw new Error(`No free demonstration quote is available for ${symbol}.`);
  const bucket = Math.floor(Date.now() / 30_000);
  const symbolSeed = [...symbol].reduce((total, character) => total + character.charCodeAt(0), 0);
  const movement = Math.sin((bucket + symbolSeed) / 9) * item.base * (assetClass === "crypto" ? 0.002 : 0.0007);
  const mark = item.base + movement;
  return {
    instrumentId: `${assetClass}:${symbol}`, provider: "Market Madness demonstration feed", quality: "simulated",
    bid: (mark - item.spread / 2).toFixed(2), ask: (mark + item.spread / 2).toFixed(2), last: mark.toFixed(2), mark: mark.toFixed(2),
    observedAt: new Date().toISOString(), name: item.name, averageDailyVolume: item.averageDailyVolume,
  };
}

export function estimateExecution(quote: ReturnType<typeof getDemoQuote>, side: "buy" | "sell", quantity: number) {
  const reference = Number(side === "buy" ? quote.ask : quote.bid);
  const participation = Math.max(0, quantity / quote.averageDailyVolume);
  const impactBps = Math.min(200, Math.sqrt(participation) * 75);
  const direction = side === "buy" ? 1 : -1;
  const price = reference * (1 + direction * impactBps / 10_000);
  return { price: Number(price.toFixed(2)), slippage: Number((Math.abs(price - reference) * quantity).toFixed(2)), impactBps: Number(impactBps.toFixed(2)), model: "bid/ask + square-root participation" };
}
