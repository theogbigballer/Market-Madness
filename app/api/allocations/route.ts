import { getAllocations, setAllocations } from "../../../lib/trading/store";

export async function GET(request: Request) {
  try {
    const portfolioId = new URL(request.url).searchParams.get("portfolioId");
    if (!portfolioId) throw new Error("portfolioId is required.");
    return Response.json({ allocations: await getAllocations(portfolioId) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load allocation targets." }, { status: 400 }); }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { portfolioId?: string; targets?: { bucket: string; targetWeight: number }[] };
    if (!body.portfolioId || !Array.isArray(body.targets)) throw new Error("Portfolio and allocation targets are required.");
    return Response.json({ allocations: await setAllocations(body.portfolioId, body.targets) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to save allocation targets." }, { status: 400 }); }
}
