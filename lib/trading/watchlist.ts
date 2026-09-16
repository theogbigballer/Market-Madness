import { ensureCoreSchema, getD1 } from "../../db/runtime";
import { getMarketQuote } from "../market/quotes";

type WatchAssetClass = "equity" | "crypto";

function normalizeSymbol(symbolInput: string) {
  const symbol = symbolInput.trim().toUpperCase();
  if (!/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) throw new Error("Enter a valid ticker symbol.");
  return symbol;
}

function newYorkDayStart() {
  const now = new Date(), parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localNoonUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), 12);
  const zonedNoon = new Date(new Date(localNoonUtc).toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offset = localNoonUtc - zonedNoon.getTime();
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)) + offset).toISOString();
}

export async function addWatchlistItem(portfolioId: string, symbolInput: string, requestedAssetClass?: WatchAssetClass) {
  await ensureCoreSchema();
  const symbol = normalizeSymbol(symbolInput), assetClass: WatchAssetClass = requestedAssetClass || (symbol.endsWith("-USD") ? "crypto" : "equity"), db = getD1();
  const portfolio = await db.prepare("SELECT id FROM portfolios WHERE id = ? AND status = 'active'").bind(portfolioId).first();
  if (!portfolio) throw new Error("Portfolio not found.");
  const count = await db.prepare("SELECT COUNT(*) AS count FROM watchlist_items WHERE portfolio_id = ?").bind(portfolioId).first<{ count: number }>();
  if (Number(count?.count || 0) >= 24) throw new Error("A watchlist can contain up to 24 symbols.");
  await getMarketQuote(symbol, assetClass);
  await db.prepare("INSERT OR IGNORE INTO watchlist_items (id, portfolio_id, symbol, asset_class) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, symbol, assetClass).run();
  return { symbol, assetClass };
}

export async function removeWatchlistItem(portfolioId: string, symbolInput: string) {
  await ensureCoreSchema();
  const symbol = normalizeSymbol(symbolInput), db = getD1();
  await db.prepare("DELETE FROM watchlist_items WHERE portfolio_id = ? AND symbol = ?").bind(portfolioId, symbol).run();
  return { symbol };
}

export async function getWatchlist(portfolioId: string) {
  await ensureCoreSchema();
  const db = getD1();
  let rows = await db.prepare("SELECT symbol, asset_class FROM watchlist_items WHERE portfolio_id = ? ORDER BY created_at").bind(portfolioId).all<{ symbol: string; asset_class: WatchAssetClass }>();
  if (!rows.results.length) {
    await db.batch(["SPY", "QQQ", "BTC-USD"].map((symbol) => db.prepare("INSERT OR IGNORE INTO watchlist_items (id, portfolio_id, symbol, asset_class) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), portfolioId, symbol, symbol.endsWith("-USD") ? "crypto" : "equity")));
    rows = await db.prepare("SELECT symbol, asset_class FROM watchlist_items WHERE portfolio_id = ? ORDER BY created_at").bind(portfolioId).all<{ symbol: string; asset_class: WatchAssetClass }>();
  }
  const cutoff = newYorkDayStart();
  const items = await Promise.all(rows.results.map(async (row) => {
    const quote = await getMarketQuote(row.symbol, row.asset_class), instrumentId = `${row.asset_class}:${row.symbol}`;
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO instruments (id, symbol, display_name, asset_class, exchange, calendar_id) VALUES (?, ?, ?, ?, ?, ?)").bind(instrumentId, row.symbol, quote.name, row.asset_class, row.asset_class === "crypto" ? "CRYPTO" : "US", row.asset_class === "crypto" ? "24/7" : "XNYS"),
      db.prepare("INSERT INTO quotes (id, instrument_id, provider, bid, ask, last, mark, quality, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), instrumentId, quote.provider, quote.bid || null, quote.ask || null, quote.last || null, quote.mark, quote.quality, quote.observedAt),
    ]);
    const history = await db.prepare("SELECT mark, quality, observed_at FROM quotes WHERE instrument_id = ? AND observed_at >= ? ORDER BY observed_at DESC LIMIT 480").bind(instrumentId, cutoff).all<{ mark: string; quality: string; observed_at: string }>();
    const points = history.results.reverse().map((point) => ({ value: Number(point.mark), quality: point.quality, at: point.observed_at })), first = points[0]?.value || Number(quote.mark);
    return { symbol: row.symbol, assetClass: row.asset_class, name: quote.name, quote, change: Number(quote.mark) - first, changePercent: first ? Number(quote.mark) / first - 1 : 0, history: points };
  }));
  await db.prepare("DELETE FROM quotes WHERE observed_at < ?").bind(new Date(Date.now() - 7 * 86_400_000).toISOString()).run();
  return { items, refreshedAt: new Date().toISOString() };
}
