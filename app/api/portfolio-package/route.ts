import { exportPortfolioPackage, importPortfolioPackage, type PortfolioPackage } from "../../../lib/trading/portfolio-package";

export async function GET(request: Request) {
  try {
    const portfolioId = new URL(request.url).searchParams.get("portfolioId"); if (!portfolioId) throw new Error("portfolioId is required.");
    const pkg = await exportPortfolioPackage(portfolioId), name = String(pkg.data.portfolios[0]?.name || "portfolio").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    return new Response(JSON.stringify(pkg, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${name}.market-madness.json"` } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to export portfolio." }, { status: 400 }); }
}
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") || 0) > 8_000_000) throw new Error("Portfolio package must be smaller than 8 MB.");
    return Response.json(await importPortfolioPackage(await request.json() as PortfolioPackage), { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to import portfolio." }, { status: 400 }); }
}
