import { getBenchmarks, setBenchmarks } from "../../../lib/trading/store";

export async function GET(request: Request) {
  try {
    const portfolioId = new URL(request.url).searchParams.get("portfolioId");
    if (!portfolioId) throw new Error("portfolioId is required.");
    return Response.json({ benchmarks: await getBenchmarks(portfolioId) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load benchmarks." }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { portfolioId?: string; symbols?: string[] };
    if (!body.portfolioId || !Array.isArray(body.symbols)) throw new Error("Portfolio and benchmark symbols are required.");
    return Response.json({ benchmarks: await setBenchmarks(body.portfolioId, body.symbols) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save benchmarks." }, { status: 400 });
  }
}
