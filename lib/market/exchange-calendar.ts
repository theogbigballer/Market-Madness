const easternParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

type Day = { year: number; month: number; day: number };

function partsAt(date: Date) {
  const parts = Object.fromEntries(easternParts.formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), weekday: parts.weekday, hour: Number(parts.hour), minute: Number(parts.minute) };
}

function nthWeekday(year: number, month: number, weekday: number, nth: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  return 1 + ((7 + weekday - first.getUTCDay()) % 7) + (nth - 1) * 7;
}

function lastWeekday(year: number, month: number, weekday: number) {
  const last = new Date(Date.UTC(year, month, 0));
  return last.getUTCDate() - ((7 + last.getUTCDay() - weekday) % 7);
}

function observedFixed(year: number, month: number, day: number): Day {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(day - 1);
  if (weekday === 0) date.setUTCDate(day + 1);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function easterSunday(year: number): Day {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

function key(day: Day) { return `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`; }

function marketHolidays(year: number) {
  const easter = easterSunday(year);
  const goodFriday = new Date(Date.UTC(easter.year, easter.month - 1, easter.day - 2));
  return new Set([
    key(observedFixed(year, 1, 1)), `${year}-01-${nthWeekday(year, 1, 1, 3)}`, `${year}-02-${nthWeekday(year, 2, 1, 3)}`,
    key({ year, month: goodFriday.getUTCMonth() + 1, day: goodFriday.getUTCDate() }), `${year}-05-${lastWeekday(year, 5, 1)}`,
    key(observedFixed(year, 6, 19)), key(observedFixed(year, 7, 4)), `${year}-09-${nthWeekday(year, 9, 1, 1)}`,
    `${year}-11-${nthWeekday(year, 11, 4, 4)}`, key(observedFixed(year, 12, 25)),
  ]);
}

function isTradingDay(day: Day) {
  const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !marketHolidays(day.year).has(key(day));
}

function easternDate(day: Day, hour: number, minute: number) {
  const desired = Date.UTC(day.year, day.month - 1, day.day, hour, minute);
  const guess = new Date(desired);
  const seen = partsAt(guess);
  const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
  return new Date(desired - (seenAsUtc - desired));
}

function nextTradingDay(day: Day) {
  const cursor = new Date(Date.UTC(day.year, day.month - 1, day.day + 1));
  for (let count = 0; count < 10; count += 1) {
    const candidate = { year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1, day: cursor.getUTCDate() };
    if (isTradingDay(candidate)) return candidate;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  throw new Error("Unable to resolve the next US equity session.");
}

export function getUsEquitySession(now = new Date()) {
  const current = partsAt(now);
  const day = { year: current.year, month: current.month, day: current.day };
  const minutes = current.hour * 60 + current.minute;
  const openMinute = 9 * 60 + 30, closeMinute = 16 * 60;
  const tradingDay = isTradingDay(day);
  const isOpen = tradingDay && minutes >= openMinute && minutes < closeMinute;
  const nextDay = tradingDay && minutes < openMinute ? day : nextTradingDay(day);
  const nextOpen = isOpen ? easternDate(day, 9, 30) : easternDate(nextDay, 9, 30);
  return { calendarId: "XNYS", isOpen, opensAt: easternDate(day, 9, 30).toISOString(), closesAt: easternDate(day, 16, 0).toISOString(), nextOpenAt: nextOpen.toISOString() };
}
