export type AssetClass = "equity" | "crypto" | "future" | "forward" | "option" | "cash";
export type QuoteQuality = "live" | "delayed" | "indicative" | "simulated" | "closed" | "stale";
export type OrderStatus = "draft" | "submitted" | "scheduled" | "accepted" | "partially_filled" | "filled" | "canceled" | "expired" | "rejected";

export interface MarketSession { calendarId: string; opensAt: string; closesAt: string; isOpen: boolean; nextOpenAt?: string; }
export interface NormalizedQuote { instrumentId: string; bid?: string; ask?: string; last?: string; mark: string; provider: string; quality: QuoteQuality; observedAt: string; }
export interface LiquidityEstimate { referencePrice: string; estimatedPrice: string; slippage: string; sizeToVolumeRatio?: string; model: string; }
export interface BuyingPowerImpact { currentBuyingPower: string; cashImpact: string; initialMarginChange: string; maintenanceMarginChange: string; resultingBuyingPower: string; accepted: boolean; reason?: string; }

export const SIMULATION_POLICY = {
  baseCurrency: "USD", minimumStartingCapital: "1000", suggestedStartingCapital: "500000",
  quoteRefreshSeconds: 30, equityExtendedHoursEnabled: false, marginLiquidationBuffer: "1.10",
  optionAutoExerciseThreshold: "0.01", accountInterestRate: "0", defaultCommission: "0",
  lotAccounting: "FIFO", intradayRetentionDays: 30,
} as const;

export function shouldScheduleEquityOrder(assetClass: AssetClass, session: MarketSession) {
  return (assetClass === "equity" || assetClass === "option") && !session.isOpen;
}

export function quoteIsStale(observedAt: string, now = new Date(), thresholdSeconds = 45) {
  return now.getTime() - new Date(observedAt).getTime() > thresholdSeconds * 1000;
}

export function classifyEquityQuoteQuality(observedAt: string, sessionOpen: boolean, now = new Date(), thresholdSeconds = 90): QuoteQuality {
  if (!sessionOpen) return "closed";
  return quoteIsStale(observedAt, now, thresholdSeconds) ? "stale" : "live";
}
