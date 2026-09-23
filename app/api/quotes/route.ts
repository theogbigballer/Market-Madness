import type { AssetClass } from "../../../lib/domain";
import { getOptionQuote } from "../../../lib/market/options";
import { getMarketQuote, supportedSymbols } from "../../../lib/market/quotes";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const symbol = params.get("symbol"), search = params.get("search"), symbols = params.get("symbols");
    if (symbols) {
      const requested = [...new Set(symbols.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean))].slice(0, 32);
      const quotes = [];
      for (const item of requested) {
        const assetClass: AssetClass = item.endsWith("-USD") ? "crypto" : "equity";
        quotes.push({ symbol: item, assetClass, quote: await getMarketQuote(item, assetClass, false) });
      }
      return Response.json({ quotes, refreshedAt: new Date().toISOString() });
    }
    if (!symbol) return Response.json({ symbols: supportedSymbols(search || "", params.get("assetClass") === "crypto" ? "crypto" : params.get("assetClass") === "equity" ? "equity" : undefined) });
    const assetClass = (params.get("assetClass") || "equity") as AssetClass;
    if (assetClass === "option") return Response.json(await getOptionQuote({
      underlying: symbol, expiration: params.get("expiration") || "", strike: Number(params.get("strike")),
      right: params.get("right") === "put" ? "put" : "call", exerciseStyle: params.get("exerciseStyle") === "european" ? "european" : "american",
    }));
    return Response.json(await getMarketQuote(symbol, assetClass));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load quote." }, { status: 404 }); }
}
