import { env } from "cloudflare:workers";
import { credentialStatus, deleteCredentials, saveCredentials } from "../../../lib/market/credentials";

function db() {
  if (!env.DB) throw new Error("The portfolio database is unavailable.");
  return env.DB;
}

export async function GET(request: Request) {
  try {
    return Response.json(await credentialStatus(request, db()));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to check the connection." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { keyId?: string; secretKey?: string };
    const keyId = body.keyId?.trim() || "", secretKey = body.secretKey?.trim() || "";
    if (keyId.length < 8 || secretKey.length < 16) return Response.json({ error: "Enter both values from your Alpaca paper API key." }, { status: 400 });
    const response = await fetch("https://data.alpaca.markets/v2/stocks/AAPL/quotes/latest?feed=iex", {
      headers: { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secretKey }, signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return Response.json({ error: response.status === 401 || response.status === 403 ? "Alpaca rejected that key. Make sure you copied the paper API key and secret exactly." : `Alpaca could not validate the connection (${response.status}). Try again shortly.` }, { status: 400 });
    const payload = await response.json() as { quote?: { bp?: number; ap?: number } };
    if (!payload.quote) return Response.json({ error: "Alpaca connected but did not return IEX market data. Try regenerating your paper API key." }, { status: 400 });
    const saved = await saveCredentials(request, db(), { keyId, secretKey });
    return Response.json(saved.status, { headers: { "set-cookie": saved.cookie, "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.name === "TimeoutError" ? "Alpaca took too long to respond. Try again." : "Unable to connect to Alpaca right now." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const cookie = await deleteCredentials(request, db());
    return Response.json({ connected: false, provider: "alpaca" }, { headers: { "set-cookie": cookie, "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to disconnect Alpaca." }, { status: 500 });
  }
}
