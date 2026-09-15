import { cancelCorporateAction, listCorporateActions, scheduleCorporateAction } from "../../../lib/trading/store";

export async function GET() {
  try { return Response.json({ actions: await listCorporateActions() }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load corporate actions." }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { symbol?: string; actionType?: "cash_dividend" | "split"; effectiveDate?: string; ratio?: number; cashAmount?: number; notes?: string };
    if (!body.symbol || !body.actionType || !body.effectiveDate) throw new Error("Symbol, action type, and effective date are required.");
    return Response.json(await scheduleCorporateAction({ symbol: body.symbol, actionType: body.actionType, effectiveDate: body.effectiveDate, ratio: body.ratio, cashAmount: body.cashAmount, notes: body.notes }), { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to schedule the corporate action." }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id"); if (!id) throw new Error("Action id is required.");
    return Response.json(await cancelCorporateAction(id));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to cancel the corporate action." }, { status: 400 }); }
}
