import { exerciseAmericanOption } from "../../../../lib/trading/store";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { portfolioId?: string; instrumentId?: string; quantity?: number };
    if (!body.portfolioId || !body.instrumentId) throw new Error("portfolioId and instrumentId are required.");
    return Response.json(await exerciseAmericanOption({ portfolioId: body.portfolioId, instrumentId: body.instrumentId, quantity: Number(body.quantity) }));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to exercise the option." }, { status: 400 }); }
}
