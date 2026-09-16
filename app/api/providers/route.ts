import { marketDataDiagnostics } from "../../../lib/market/quotes";

export async function GET() {
  return Response.json({ providers: marketDataDiagnostics(), policy: { refreshSeconds: 30, cachedLiveQuoteSeconds: 300, equityExtendedHours: false, fallback: "Deterministic simulation with explicit quality labels" }, checkedAt: new Date().toISOString() });
}
