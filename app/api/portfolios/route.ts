import { archivePortfolio, createPortfolio, listPortfolios, permanentlyDeletePortfolio } from "../../../lib/trading/store";

export async function GET() {
  try { return Response.json({ portfolios: await listPortfolios() }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load portfolios." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { portfolioId?: string };
    if (!body.portfolioId) throw new Error("portfolioId is required.");
    return Response.json(await archivePortfolio(body.portfolioId));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to archive portfolio." }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    const portfolioId = new URL(request.url).searchParams.get("portfolioId");
    if (!portfolioId) throw new Error("portfolioId is required.");
    return Response.json(await permanentlyDeletePortfolio(portfolioId));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to delete portfolio." }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: string; startingCapital?: number; advancedDerivativesEnabled?: boolean; theme?: string };
    const result = await createPortfolio({ name: body.name ?? "", startingCapital: Number(body.startingCapital), advancedDerivativesEnabled: body.advancedDerivativesEnabled, theme: body.theme });
    return Response.json(result, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to create portfolio." }, { status: 400 }); }
}
