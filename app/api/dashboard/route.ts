import { getDashboard } from "../../../lib/trading/store";
import { portfolioId as validPortfolioId } from "../../../lib/trading/validation";

export async function GET(request: Request) {
  try {
    const portfolioId = new URL(request.url).searchParams.get("portfolioId");
    return Response.json(await getDashboard(validPortfolioId(portfolioId)));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load dashboard." }, { status: 400 }); }
}
