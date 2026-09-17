export function apiErrorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const normalized = message.toLowerCase();
  const notFound = normalized.includes("not found");
  const conflict = normalized.includes("already") || normalized.includes("conflict") || normalized.includes("unique constraint") || normalized.includes("only active");
  const constrained = normalized.includes("insufficient buying power") || normalized.includes("would violate") || normalized.includes("advanced derivatives");
  const internal = !(error instanceof Error) || normalized.includes("database is unavailable");
  const status = internal ? 500 : notFound ? 404 : conflict ? 409 : constrained ? 422 : 400;
  const code = internal ? "INTERNAL_ERROR" : notFound ? "NOT_FOUND" : conflict ? "CONFLICT" : constrained ? "ACCOUNT_CONSTRAINT" : error instanceof SyntaxError ? "INVALID_JSON" : "VALIDATION_ERROR";
  return Response.json({ error: internal ? fallback : message, code }, { status });
}
