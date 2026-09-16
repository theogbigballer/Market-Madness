export type DecimalInput = number | string;

type Decimal = { coefficient: bigint; scale: number };

function expandScientific(value: string) {
  const match = value.trim().toLowerCase().match(/^([+-]?)(\d*\.?\d*)e([+-]?\d+)$/);
  if (!match) return value.trim();
  const sign = match[1], exponent = Number(match[3]);
  const [whole = "0", fraction = ""] = match[2].split(".");
  const digits = `${whole || "0"}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  const decimalIndex = whole.length + exponent;
  if (decimalIndex <= 0) return `${sign}0.${"0".repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function parseDecimal(value: DecimalInput): Decimal {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Money values must be finite.");
  const normalized = expandScientific(String(value));
  const match = normalized.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error(`Invalid decimal value: ${value}`);
  const fraction = match[3] || "";
  const coefficient = BigInt(`${match[1] === "-" ? "-" : ""}${match[2]}${fraction}`);
  return { coefficient, scale: fraction.length };
}

function powerOfTen(power: number) {
  return BigInt(`1${"0".repeat(Math.max(0, power))}`);
}

function roundToScale(decimal: Decimal, scale: number) {
  if (decimal.scale <= scale) return decimal.coefficient * powerOfTen(scale - decimal.scale);
  const divisor = powerOfTen(decimal.scale - scale);
  const absolute = decimal.coefficient < BigInt(0) ? -decimal.coefficient : decimal.coefficient;
  const rounded = (absolute + divisor / BigInt(2)) / divisor;
  return decimal.coefficient < BigInt(0) ? -rounded : rounded;
}

function formatScaled(coefficient: bigint, scale: number) {
  const negative = coefficient < BigInt(0), absolute = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, "0");
  const whole = scale ? absolute.slice(0, -scale) : absolute;
  const fraction = scale ? `.${absolute.slice(-scale)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

export function formatMoney(value: DecimalInput) {
  return formatScaled(roundToScale(parseDecimal(value), 2), 2);
}

export function multiplyMoney(...values: DecimalInput[]) {
  const product = values.reduce<Decimal>((result, value) => {
    const decimal = parseDecimal(value);
    return { coefficient: result.coefficient * decimal.coefficient, scale: result.scale + decimal.scale };
  }, { coefficient: BigInt(1), scale: 0 });
  return formatScaled(roundToScale(product, 2), 2);
}

export function sumMoney(values: DecimalInput[]) {
  const cents = values.reduce((sum, value) => sum + roundToScale(parseDecimal(value), 2), BigInt(0));
  return formatScaled(cents, 2);
}

export function subtractDecimal(left: DecimalInput, right: DecimalInput) {
  const leftDecimal = parseDecimal(left), rightDecimal = parseDecimal(right), scale = Math.max(leftDecimal.scale, rightDecimal.scale);
  const coefficient = leftDecimal.coefficient * powerOfTen(scale - leftDecimal.scale) - rightDecimal.coefficient * powerOfTen(scale - rightDecimal.scale);
  return formatScaled(coefficient, scale);
}

export function moneyToNumber(value: DecimalInput) {
  return Number(formatMoney(value));
}

export function compareMoney(left: DecimalInput, right: DecimalInput) {
  const leftCents = roundToScale(parseDecimal(left), 2), rightCents = roundToScale(parseDecimal(right), 2);
  return leftCents === rightCents ? 0 : leftCents > rightCents ? 1 : -1;
}

export function compareDecimal(left: DecimalInput, right: DecimalInput) {
  const leftDecimal = parseDecimal(left), rightDecimal = parseDecimal(right), scale = Math.max(leftDecimal.scale, rightDecimal.scale);
  const leftValue = leftDecimal.coefficient * powerOfTen(scale - leftDecimal.scale);
  const rightValue = rightDecimal.coefficient * powerOfTen(scale - rightDecimal.scale);
  return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1;
}
