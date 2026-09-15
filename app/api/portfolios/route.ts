import { createPortfolio, listPortfolios } from "../../../lib/trading/store";

export async function GET() {
  try { return Response.json({ portfolios: await listPortfolios() }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load portfolios." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: string; startingCapital?: number; benchmarkSymbol?: string; advancedDerivativesEnabled?: boolean; theme?: string };
    const result = await createPortfolio({ name: body.name ?? "", startingCapital: Number(body.startingCapital), benchmarkSymbol: body.benchmarkSymbol, advancedDerivativesEnabled: body.advancedDerivativesEnabled, theme: body.theme });
    return Response.json(result, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to create portfolio." }, { status: 400 }); }
}
