import { futuresCatalog, getFutureQuote } from "../../../lib/market/derivatives";

export async function GET() {
  try {
    const contracts = await Promise.all(futuresCatalog().map(async (contract) => ({ ...contract, quote: await getFutureQuote(contract) })));
    return Response.json({ contracts });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load the futures catalog." }, { status: 400 });
  }
}
