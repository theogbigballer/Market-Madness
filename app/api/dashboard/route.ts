import { getDashboard } from "../../../lib/trading/store";

export async function GET(request: Request) {
  try {
    const portfolioId = new URL(request.url).searchParams.get("portfolioId");
    if (!portfolioId) return Response.json({ error: "portfolioId is required." }, { status: 400 });
    return Response.json(await getDashboard(portfolioId));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load dashboard." }, { status: 400 }); }
}
