const portfolioQueues = new Map<string, Promise<void>>();

export async function withPortfolioMutation<T>(portfolioId: string, operation: () => Promise<T>): Promise<T> {
  const previous = portfolioQueues.get(portfolioId) || Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  portfolioQueues.set(portfolioId, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (portfolioQueues.get(portfolioId) === tail) portfolioQueues.delete(portfolioId);
  }
}

export function normalizeRequestId(value: string | null | undefined) {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(normalized)) throw new Error("Idempotency-Key must be 8–128 letters, numbers, dots, colons, underscores, or dashes.");
  return normalized;
}
