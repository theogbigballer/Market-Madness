# Market Madness

Market Madness is a local-first, multi-portfolio trading simulator for US equities, equity options, crypto, CME-group futures, and custom forwards. It is designed around an auditable ledger, realistic buying-power checks, exchange calendars, derivative lifecycles, and transparent market-data quality.

## Current state

The repository now includes the product specification, core domain policies, a durable local D1/SQLite ledger, portfolio onboarding, multi-portfolio switching, configurable benchmark and allocation sets, persistent per-portfolio watchlists, cash transfers, flow-adjusted P&L, intraday portfolio/benchmark and instrument charts, CSV reporting, a closed-trades blotter with realized-P&L attribution, portfolio Greeks and shock scenarios, 30-second quotes, and equity, crypto, option, futures, and custom-forward order paths. The dedicated Strategies workspace prices editable verticals, straddles, strangles, and iron condors as atomic two-to-four-leg option market or net-limit orders with combined buying-power checks. Market, limit, stop, and stop-limit single-leg orders use an explicit spread-and-size-impact model; closed-session orders are queued and can be canceled before execution.

The provider router uses Coinbase Exchange's public ticker for supported crypto pairs and optional free Alpaca IEX quotes for equities. When live coverage or credentials are unavailable, it falls back to a deliberately labeled simulated feed. Option prices are labeled indicative and use a zero-rate model consistent with the simulator's no-interest policy.

Futures use an explicit contract catalog with multipliers and initial/maintenance margin. Index futures are derived from labeled live-or-simulated proxy quotes, while commodity curves remain simulated until a suitable free source is configured. Physical contracts are closed before first notice. Custom forwards store their delivery price and date, begin with no premium cash flow, and settle their marked P&L at delivery.

## Local development

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run doctor
npm run dev
```

Open `http://localhost:3000`, create a portfolio, and choose its starting allocation. The local database is created automatically. Optional market-data credentials belong in a local `.env` file based on `.env.example` and must never be committed.

For a brand-new clone, run `npm install` before `npm run doctor`; the doctor intentionally reports a missing `node_modules` directory. No API credential is required. Coinbase public crypto quotes work without a key, and unavailable equity coverage falls back to visibly labeled simulated prices.

## First-run path

1. Create a portfolio with at least $1,000 of starting capital.
2. Use the overview checklist to choose searchable benchmarks and set a 100% allocation target.
3. Place a small test order and inspect its quote quality, buying-power estimate, execution model, and fill provenance.
4. Open Data providers to confirm which feeds are live, cached, indicative, or simulated.
5. Download a portable portfolio package from Settings before upgrades or local-data maintenance.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local simulator at `http://localhost:3000`. |
| `npm run doctor` | Check Node, dependencies, required files, feed configuration, and local database presence. |
| `npm run lint` | Run static code checks. |
| `npm test` | Build the production bundle and run the full automated suite. |
| `npm run db:reset-local` | Dry-run a local database reset; it does not change data. |
| `npm run db:reset-local -- --confirm` | Move local D1 state into a timestamped backup, then allow a fresh database on next start. |
| `npm run db:reset-local -- --list` | List recoverable local D1 backups. |
| `npm run db:reset-local -- --restore BACKUP_NAME` | Restore a listed backup when no current D1 state exists. |

Stop the development server before resetting or restoring data. Portfolio-package exports are the preferred portable backup; `.wrangler/backups` is a machine-local emergency rollback and remains gitignored.

## Troubleshooting

- **The doctor says `node_modules` is missing:** run `npm install`, then repeat `npm run doctor`.
- **Quotes say simulated:** this is expected when a free live source is unavailable. Check Data providers for the exact route and configure optional Alpaca keys for IEX equities.
- **An equity or option order is queued:** regular-session execution is intentional; there is no equity after-hours trading.
- **A port is already in use:** stop the older development process or use the URL printed by the new process.
- **Local data looks wrong after an upgrade:** first download any portfolio that still opens, stop the server, and use the recoverable reset workflow above. Never edit the SQLite files while the app is running.
- **A package will not import:** imports reject malformed, incompatible, oversized, or internally inconsistent data instead of partially writing it.

See [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) before handing a build to another tester.

## Product rules

- Portfolios start today with at least $1,000; $500,000 is suggested.
- USD is the only base currency in the initial release.
- Equities and equity options never execute outside their regular sessions; orders queue for the next open.
- Quotes refresh about every 30 seconds and always expose provider, timestamp, and quality.
- Each portfolio has a searchable 24-symbol watchlist. The Markets workspace records current-session quote samples, displays intraday price movement, and can open a prefilled trade ticket from the selected instrument.
- Orders require sufficient buying power. Maintenance deficiencies trigger forced liquidation to a 110% buffer.
- American and European option exercise styles are supported. Long American contracts can be exercised manually in-session, dividend-driven short-call assignment is deterministic, and contracts at least $0.01 in the money auto-exercise at expiry. Delivered shares net against opposing underlying lots before creating a residual position.
- Physically delivered futures are closed before first notice; futures rolling is manual.
- Cash earns no interest, negative balances accrue no interest, and explicit commissions default to zero.
- FIFO lots, immutable lot-closure records, and immutable cash-ledger events provide the accounting foundation. Partial closes retain entry/exit prices, multipliers, reasons, and closing-fill links. Simulated cash dividends and splits are scheduled in-app and processed idempotently across affected portfolios.
- Allocation targets must total 100% and display drift without automatically trading. Portfolios can be archived or permanently deleted from Settings.
- Deposits, withdrawals, and transfers do not count as investment P&L. Intraday relative returns use a flow-adjusted portfolio index and up to eight user-searched benchmarks sampled every 30 seconds.
- Option margin recognizes covered calls, vertical spreads, and same-expiration iron-condor offsets. The Risk workspace previews near-term exercise and assignment effects and reports accounting reconciliation checks.
- P&L, current positions, closed trades, and the immutable cash ledger can be exported as local CSV files.

See [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) for the complete blueprint.
