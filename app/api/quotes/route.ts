import type { AssetClass } from "../../../lib/domain";
import { getOptionQuote } from "../../../lib/market/options";
import { getMarketQuote, supportedSymbols } from "../../../lib/market/quotes";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const symbol = params.get("symbol");
    if (!symbol) return Response.json({ symbols: supportedSymbols() });
    const assetClass = (params.get("assetClass") || "equity") as AssetClass;
    if (assetClass === "option") return Response.json(await getOptionQuote({
      underlying: symbol, expiration: params.get("expiration") || "", strike: Number(params.get("strike")),
      right: params.get("right") === "put" ? "put" : "call", exerciseStyle: params.get("exerciseStyle") === "european" ? "european" : "american",
    }));
    return Response.json(await getMarketQuote(symbol, assetClass));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load quote." }, { status: 404 }); }
}
