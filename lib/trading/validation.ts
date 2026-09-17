export function requiredString(value: unknown, label: string, maximumLength = 120) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > maximumLength) throw new Error(`${label} must be ${maximumLength} characters or fewer.`);
  return normalized;
}

export function enumValue<const T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  return value as T;
}

export function positiveNumber(value: unknown, label: string, options: { integer?: boolean; maximum?: number } = {}) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be greater than zero.`);
  if (options.integer && !Number.isInteger(parsed)) throw new Error(`${label} must be a positive whole number.`);
  if (options.maximum !== undefined && parsed > options.maximum) throw new Error(`${label} cannot exceed ${options.maximum.toLocaleString("en-US")}.`);
  return parsed;
}

export function optionalPositiveNumber(value: unknown, label: string, maximum = 1_000_000_000) {
  return value === undefined || value === null || value === "" ? undefined : positiveNumber(value, label, { maximum });
}

export function optionalBoolean(value: unknown, label: string, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw new Error(`${label} must be true or false.`);
  return value;
}

export function portfolioId(value: unknown) {
  return requiredString(value, "portfolioId", 128);
}
