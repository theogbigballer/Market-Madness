import { exportPortfolioCsv } from "../../../lib/trading/store";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams, portfolioId = params.get("portfolioId"), report = params.get("report");
    if (!portfolioId || !["transactions", "positions", "pnl"].includes(report || "")) throw new Error("portfolioId and a valid report are required.");
    const exported = await exportPortfolioCsv(portfolioId, report as "transactions" | "positions" | "pnl");
    const safeFilename = exported.filename.replace(/[^a-zA-Z0-9._ -]/g, "_");
    return new Response(exported.content, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${safeFilename}"`, "cache-control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to export report." }, { status: 400 }); }
}
