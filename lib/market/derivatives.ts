import type { NormalizedQuote } from "../domain";
import { getMarketQuote } from "./quotes";

export type FutureContract = {
  root: "ES" | "NQ" | "CL" | "GC";
  symbol: string;
  name: string;
  expiration: string;
  firstNotice?: string;
  multiplier: number;
  initialMargin: number;
  maintenanceMargin: number;
  settlementType: "cash" | "physical";
};

export type ForwardContract = {
  underlying: string;
  deliveryDate: string;
  deliveryPrice: number;
  quantityUnit: string;
};

const futures: FutureContract[] = [
  { root: "ES", symbol: "ESZ6", name: "E-mini S&P 500 Dec 2026", expiration: "2026-12-18", multiplier: 50, initialMargin: 24860, maintenanceMargin: 22600, settlementType: "cash" },
  { root: "NQ", symbol: "NQZ6", name: "E-mini Nasdaq-100 Dec 2026", expiration: "2026-12-18", multiplier: 20, initialMargin: 35100, maintenanceMargin: 31900, settlementType: "cash" },
  { root: "CL", symbol: "CLX6", name: "WTI Crude Oil Nov 2026", expiration: "2026-10-20", firstNotice: "2026-10-22", multiplier: 1000, initialMargin: 9400, maintenanceMargin: 8500, settlementType: "physical" },
  { root: "GC", symbol: "GCZ6", name: "Gold Dec 2026", expiration: "2026-12-28", firstNotice: "2026-11-30", multiplier: 100, initialMargin: 15800, maintenanceMargin: 14350, settlementType: "physical" },
  { root: "ES", symbol: "ESH7", name: "E-mini S&P 500 Mar 2027", expiration: "2027-03-19", multiplier: 50, initialMargin: 24860, maintenanceMargin: 22600, settlementType: "cash" },
  { root: "NQ", symbol: "NQH7", name: "E-mini Nasdaq-100 Mar 2027", expiration: "2027-03-19", multiplier: 20, initialMargin: 35100, maintenanceMargin: 31900, settlementType: "cash" },
];

export function futuresCatalog() { return futures; }
export function findFuture(symbol: string) { return futures.find((contract) => contract.symbol === symbol.toUpperCase()); }

function cmeIsOpen(now: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((part) => [part.type, part.value]));
  const weekday = parts.weekday, minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const weekendClosed = weekday === "Fri" && minutes >= 17 * 60 || weekday === "Sat" || weekday === "Sun" && minutes < 18 * 60;
  const maintenance = minutes >= 17 * 60 && minutes < 18 * 60;
  return !weekendClosed && !maintenance;
}

export function getCmeSession(now = new Date()) {
  const isOpen = cmeIsOpen(now), cursor = new Date(now);
  if (!isOpen) for (let step = 0; step < 144 && !cmeIsOpen(cursor); step += 1) cursor.setUTCMinutes(cursor.getUTCMinutes() + 30);
  return { isOpen, calendarId: "CMES", opensAt: now.toISOString(), closesAt: now.toISOString(), nextOpenAt: cursor.toISOString() };
}

export async function getFutureQuote(contract: FutureContract): Promise<NormalizedQuote & { name: string; averageDailyVolume: number }> {
  let base: number, provider: string, quality: NormalizedQuote["quality"] = "indicative";
  if (contract.root === "ES" || contract.root === "NQ") {
    const proxy = await getMarketQuote(contract.root === "ES" ? "SPY" : "QQQ", "equity");
    base = Number(proxy.mark) * (contract.root === "ES" ? 10 : 40);
    provider = `Index proxy curve · ${proxy.provider}`;
  } else {
    const anchor = contract.root === "CL" ? 64.8 : 3654;
    const bucket = Math.floor(Date.now() / 30_000), seed = [...contract.symbol].reduce((sum, character) => sum + character.charCodeAt(0), 0);
    base = anchor * (1 + Math.sin((bucket + seed) / 11) * 0.0015);
    provider = "Market Madness futures curve"; quality = "simulated";
  }
  const days = Math.max(0, (new Date(`${contract.expiration}T20:00:00Z`).getTime() - Date.now()) / 86_400_000);
  const mark = base * (1 + Math.min(days, 365) * 0.00001), tick = contract.root === "CL" ? 0.01 : contract.root === "GC" ? 0.1 : 0.25;
  return { instrumentId: `future:${contract.symbol}`, provider, quality, bid: (mark - tick / 2).toFixed(2), ask: (mark + tick / 2).toFixed(2), last: mark.toFixed(2), mark: mark.toFixed(2), observedAt: new Date().toISOString(), name: contract.name, averageDailyVolume: contract.root === "ES" ? 1_500_000 : 350_000 };
}

export function forwardSymbol(contract: ForwardContract) { return `${contract.underlying.toUpperCase()} FWD ${contract.deliveryDate} @ ${contract.deliveryPrice.toFixed(2)}`; }

export async function getForwardQuote(contract: ForwardContract): Promise<NormalizedQuote & { name: string; averageDailyVolume: number }> {
  const assetClass = contract.underlying.endsWith("-USD") ? "crypto" : "equity";
  const underlying = await getMarketQuote(contract.underlying, assetClass);
  const mark = Number(underlying.mark), spread = Math.max(0.01, mark * 0.0005);
  return { instrumentId: `forward:${forwardSymbol(contract)}`, provider: `Indicative forward · ${underlying.provider}`, quality: "indicative", bid: (mark - spread / 2).toFixed(2), ask: (mark + spread / 2).toFixed(2), last: mark.toFixed(2), mark: mark.toFixed(2), observedAt: underlying.observedAt, name: `${contract.underlying.toUpperCase()} forward to ${contract.deliveryDate}`, averageDailyVolume: 100_000 };
}
