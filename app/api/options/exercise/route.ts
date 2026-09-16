import { exerciseAmericanOption } from "../../../../lib/trading/store";
import { portfolioId, positiveNumber, requiredString } from "../../../../lib/trading/validation";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { portfolioId?: string; instrumentId?: string; quantity?: number };
    return Response.json(await exerciseAmericanOption({ portfolioId: portfolioId(body.portfolioId), instrumentId: requiredString(body.instrumentId, "instrumentId", 160), quantity: positiveNumber(body.quantity, "Exercise quantity", { integer: true, maximum: 1_000_000 }) }));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to exercise the option." }, { status: 400 }); }
}
