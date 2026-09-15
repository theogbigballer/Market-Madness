import type { AssetClass } from "../../../lib/domain";
import { getDemoQuote, supportedSymbols } from "../../../lib/market/quotes";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const symbol = params.get("symbol");
    if (!symbol) return Response.json({ symbols: supportedSymbols() });
    return Response.json(getDemoQuote(symbol, (params.get("assetClass") || "equity") as AssetClass));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load quote." }, { status: 404 }); }
}
