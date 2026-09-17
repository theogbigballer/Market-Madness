import { createAlertRule, deleteAlertRule, listAlertRules } from "../../../lib/trading/alert-rules";

export async function GET(request: Request) {
  try { const portfolioId = new URL(request.url).searchParams.get("portfolioId"); if (!portfolioId) throw new Error("portfolioId is required."); return Response.json({ rules: await listAlertRules(portfolioId) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load alert rules." }, { status: 400 }); }
}
export async function POST(request: Request) {
  try { return Response.json(await createAlertRule(await request.json()), { status: 201 }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to create alert rule." }, { status: 400 }); }
}
export async function DELETE(request: Request) {
  try { const params = new URL(request.url).searchParams, portfolioId = params.get("portfolioId"), id = params.get("id"); if (!portfolioId || !id) throw new Error("portfolioId and id are required."); return Response.json(await deleteAlertRule(portfolioId, id)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to delete alert rule." }, { status: 400 }); }
}
