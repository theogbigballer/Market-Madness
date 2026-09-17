import { optionChain } from "../../../lib/market/options";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams, underlying = params.get("underlying") || "SPY", expiration = params.get("expiration") || undefined;
    const exerciseStyle = params.get("exerciseStyle") === "european" ? "european" : "american";
    return Response.json(await optionChain(underlying, expiration, exerciseStyle));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to build the option chain." }, { status: 400 });
  }
}
