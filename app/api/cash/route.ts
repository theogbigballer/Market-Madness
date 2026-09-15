import { transferCash } from "../../../lib/trading/store";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { portfolioId?: string; direction?: "deposit" | "withdrawal"; amount?: number };
    if (!body.portfolioId || !body.direction) throw new Error("Portfolio and transfer direction are required.");
    return Response.json(await transferCash(body.portfolioId, body.direction, Number(body.amount)), { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to transfer cash." }, { status: 400 }); }
}
