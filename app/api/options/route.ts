import { optionChain } from "../../../lib/market/options";

export async function GET(request: Request) {
  try {
    const underlying = new URL(request.url).searchParams.get("underlying") || "SPY";
    return Response.json(await optionChain(underlying));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to build the option chain." }, { status: 400 });
  }
}
