# Release checklist

Use this checklist before sharing Market Madness with another local tester.

## Automated gate

Run these from the repository root:

```bash
npm install
npm run doctor
npm run lint
npm test
```

All commands must finish successfully. `npm test` includes a production build, API/database integration coverage, accounting precision checks, idempotency checks, concurrent-order checks, and backup validation.

## Manual smoke test

- Create two portfolios and switch between them without cross-book data leakage.
- Select searchable benchmarks and save an allocation totaling exactly 100%.
- Place a small equity market order during the regular session, or verify it queues outside the session.
- Submit, replace, cancel, and duplicate an eligible order.
- Place one crypto order and inspect quote provider and quality.
- Price an option, submit a two-leg strategy, and inspect combined buying-power behavior.
- Review positions, P&L, blotter, risk, activity, alerts, and reconciliation.
- Confirm Data providers accurately labels live, cached, indicative, and simulated routes.
- Export CSV reports and a portable portfolio package.
- Import the package and confirm it creates a separate portfolio with remapped IDs.
- Verify light and dark themes at desktop and narrow viewport sizes.

## Data-safety test

1. Stop the development server.
2. Run `npm run db:reset-local` and confirm it only reports a dry run.
3. Export a portable package before any confirmed reset.
4. If a reset is necessary, run `npm run db:reset-local -- --confirm`.
5. Start the app and verify a fresh database is created.
6. Stop the app, move the newly created state aside with the same confirmed backup command, then restore the earlier backup with `npm run db:reset-local -- --restore BACKUP_NAME`.

## Known release boundaries

- This is a simulation and education tool, not a broker or investment-advice product.
- It is designed for one local user per running copy and has no authentication or cloud synchronization.
- Free providers do not guarantee coverage, latency, uptime, or exchange-grade accuracy.
- Equity/options execution is restricted to regular sessions. Crypto, futures, and custom forwards follow their modeled schedules.
- Option and commodity marks may be indicative or simulated and are always labeled.
- USD is the only base currency and interest accrual is intentionally disabled.
