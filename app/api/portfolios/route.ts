import { archivePortfolio, createPortfolio, listPortfolios, permanentlyDeletePortfolio } from "../../../lib/trading/store";
import { enumValue, optionalBoolean, portfolioId as validPortfolioId, positiveNumber, requiredString } from "../../../lib/trading/validation";

export async function GET() {
  try { return Response.json({ portfolios: await listPortfolios() }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load portfolios." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { portfolioId?: string };
    return Response.json(await archivePortfolio(validPortfolioId(body.portfolioId)));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to archive portfolio." }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    const portfolioId = new URL(request.url).searchParams.get("portfolioId");
    return Response.json(await permanentlyDeletePortfolio(validPortfolioId(portfolioId)));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to delete portfolio." }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: string; startingCapital?: number; advancedDerivativesEnabled?: boolean; theme?: string };
    const result = await createPortfolio({
      name: requiredString(body.name, "Portfolio name", 80),
      startingCapital: positiveNumber(body.startingCapital, "Starting capital", { maximum: 1_000_000_000_000 }),
      advancedDerivativesEnabled: optionalBoolean(body.advancedDerivativesEnabled, "Advanced derivatives"),
      theme: enumValue(body.theme ?? "dark", ["light", "dark"] as const, "Theme"),
    });
    return Response.json(result, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to create portfolio." }, { status: 400 }); }
}
