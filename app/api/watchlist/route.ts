import { addWatchlistItem, getWatchlist, removeWatchlistItem } from "../../../lib/trading/watchlist";

export async function GET(request: Request) {
  try {
    const portfolioId = new URL(request.url).searchParams.get("portfolioId");
    if (!portfolioId) throw new Error("portfolioId is required.");
    return Response.json(await getWatchlist(portfolioId));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load watchlist." }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { portfolioId?: string; symbol?: string; assetClass?: "equity" | "crypto" };
    if (!body.portfolioId || !body.symbol) throw new Error("Portfolio and symbol are required.");
    return Response.json(await addWatchlistItem(body.portfolioId, body.symbol, body.assetClass));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to add symbol." }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    const params = new URL(request.url).searchParams, portfolioId = params.get("portfolioId"), symbol = params.get("symbol");
    if (!portfolioId || !symbol) throw new Error("Portfolio and symbol are required.");
    return Response.json(await removeWatchlistItem(portfolioId, symbol));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to remove symbol." }, { status: 400 }); }
}
