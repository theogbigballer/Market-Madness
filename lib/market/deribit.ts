export type DeribitInstrument = {
  instrument_name: string;
  base_currency: string;
  quote_currency: string;
  kind: "option";
  option_type: "call" | "put";
  expiration_timestamp: number;
  strike: number;
  contract_size: number;
  is_active: boolean;
  instrument_type?: string;
};

export type DeribitBookSummary = {
  instrument_name: string;
  base_currency: string;
  quote_currency: string;
  bid_price?: number | null;
  ask_price?: number | null;
  mark_price?: number | null;
  mid_price?: number | null;
  last?: number | null;
  mark_iv?: number | null;
  underlying_price?: number | null;
  volume?: number | null;
  open_interest?: number | null;
  creation_timestamp?: number | null;
};

export type DeribitMarket = {
  instruments: DeribitInstrument[];
  summaries: Map<string, DeribitBookSummary>;
  observedAt: string;
};

type ProviderState = { lastSuccess: string | null; lastFailure: string | null; consecutiveFailures: number; lastError: string | null };

let instrumentsCache: { value: DeribitInstrument[]; cachedAt: number } | null = null;
let marketCache: { value: DeribitMarket; cachedAt: number } | null = null;
const state: ProviderState = { lastSuccess: null, lastFailure: null, consecutiveFailures: 0, lastError: null };

function asObservedAt(payload: { usOut?: number }, fallback = Date.now()) {
  return new Date(payload.usOut ? Math.floor(payload.usOut / 1_000) : fallback).toISOString();
}

async function deribitRequest<T>(method: string, params: URLSearchParams) {
  const response = await fetch(`https://www.deribit.com/api/v2/public/${method}?${params}`, {
    headers: { accept: "application/json" }, signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error(`Deribit returned ${response.status}.`);
  const payload = await response.json() as { result?: T; error?: { message?: string }; usOut?: number };
  if (!payload.result) throw new Error(payload.error?.message || "Deribit returned an incomplete response.");
  return { result: payload.result, observedAt: asObservedAt(payload) };
}

export function deribitBaseCurrency(underlying: string) {
  const base = underlying.trim().toUpperCase().replace(/-USD$/, "");
  return ["BTC", "ETH", "SOL", "AVAX", "XRP", "TRX", "HYPE"].includes(base) ? base : null;
}

export function deribitExpiration(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function matchDeribitInstrument(instruments: DeribitInstrument[], input: { underlying: string; expiration: string; strike: number; right: "call" | "put" }) {
  const base = deribitBaseCurrency(input.underlying);
  if (!base) return undefined;
  return instruments.find((item) => item.base_currency === base && item.quote_currency === "USDC" && item.kind === "option" && item.is_active && item.option_type === input.right && deribitExpiration(item.expiration_timestamp) === input.expiration && Math.abs(item.strike - input.strike) < 1e-8);
}

export function selectDeribitChain(market: DeribitMarket, underlying: string, selectedExpiration?: string) {
  const base = deribitBaseCurrency(underlying);
  if (!base) return null;
  const listed = market.instruments.filter((item) => item.base_currency === base && item.quote_currency === "USDC" && item.kind === "option" && item.is_active && item.instrument_type === "linear");
  if (!listed.length) return null;
  const expirations = [...new Set(listed.map((item) => deribitExpiration(item.expiration_timestamp)))].sort().slice(0, 8);
  const expiration = expirations.includes(selectedExpiration || "") ? selectedExpiration! : expirations[0];
  const expiryInstruments = listed.filter((item) => deribitExpiration(item.expiration_timestamp) === expiration);
  const spot = expiryInstruments.map((item) => market.summaries.get(item.instrument_name)?.underlying_price).find((value) => Number(value) > 0) || 0;
  const pairedStrikes = [...new Set(expiryInstruments.map((item) => item.strike))]
    .filter((strike) => (["call", "put"] as const).every((right) => expiryInstruments.some((item) => item.strike === strike && item.option_type === right)))
    .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot)).slice(0, 13).sort((a, b) => a - b);
  const instruments = expiryInstruments.filter((item) => pairedStrikes.includes(item.strike));
  return { base, expirations, expiration, strikes: pairedStrikes, instruments, spot: Number(spot), multiplier: Number(instruments[0]?.contract_size || listed[0].contract_size) };
}

export async function getDeribitMarket(): Promise<DeribitMarket> {
  const now = Date.now();
  if (marketCache && now - marketCache.cachedAt < 30_000) return marketCache.value;
  try {
    let instruments = instrumentsCache?.value;
    if (!instruments || now - instrumentsCache!.cachedAt > 15 * 60_000) {
      const response = await deribitRequest<DeribitInstrument[]>("get_instruments", new URLSearchParams({ currency: "USDC", kind: "option", expired: "false" }));
      instruments = response.result;
      instrumentsCache = { value: instruments, cachedAt: now };
    }
    const snapshot = await deribitRequest<DeribitBookSummary[]>("get_book_summary_by_currency", new URLSearchParams({ currency: "USDC", kind: "option" }));
    const value = { instruments, summaries: new Map(snapshot.result.map((item) => [item.instrument_name, item])), observedAt: snapshot.observedAt };
    marketCache = { value, cachedAt: now };
    state.lastSuccess = new Date().toISOString(); state.consecutiveFailures = 0; state.lastError = null;
    return value;
  } catch (error) {
    state.lastFailure = new Date().toISOString(); state.consecutiveFailures += 1; state.lastError = error instanceof Error ? error.message : "Deribit request failed.";
    if (marketCache && now - marketCache.cachedAt < 5 * 60_000) return { ...marketCache.value, observedAt: marketCache.value.observedAt };
    throw error;
  }
}

export function deribitDiagnostics() {
  return { id: "deribit", name: "Deribit", assetClasses: ["Crypto options"], mode: "public USDC API", priority: 1, ...state };
}
