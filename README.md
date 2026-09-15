# Market Madness

Market Madness is a local-first, multi-portfolio trading simulator for US equities, equity options, crypto, CME-group futures, and custom forwards. It is designed around an auditable ledger, realistic buying-power checks, exchange calendars, derivative lifecycles, and transparent market-data quality.

## Current state

The repository now includes the product specification, core domain policies, a durable local D1/SQLite ledger, portfolio onboarding, multi-portfolio switching, configurable benchmark and allocation sets, cash transfers, daily P&L snapshots, portfolio Greeks and shock scenarios, 30-second quotes, and equity, crypto, option, futures, and custom-forward order paths. The dedicated Strategies workspace prices editable verticals, straddles, strangles, and iron condors as atomic two-to-four-leg option orders with net economics and combined buying-power checks. Market, limit, stop, and stop-limit single-leg orders use an explicit spread-and-size-impact model; closed-session orders are queued and can be canceled before execution.

The provider router uses Coinbase Exchange's public ticker for supported crypto pairs and optional free Alpaca IEX quotes for equities. When live coverage or credentials are unavailable, it falls back to a deliberately labeled simulated feed. Option prices are labeled indicative and use a zero-rate model consistent with the simulator's no-interest policy.

Futures use an explicit contract catalog with multipliers and initial/maintenance margin. Index futures are derived from labeled live-or-simulated proxy quotes, while commodity curves remain simulated until a suitable free source is configured. Physical contracts are closed before first notice. Custom forwards store their delivery price and date, begin with no premium cash flow, and settle their marked P&L at delivery.

## Local development

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, create a portfolio, and choose its starting allocation. The local database is created automatically. Optional market-data credentials belong in a local `.env` file based on `.env.example` and must never be committed.

## Product rules

- Portfolios start today with at least $1,000; $500,000 is suggested.
- USD is the only base currency in the initial release.
- Equities and equity options never execute outside their regular sessions; orders queue for the next open.
- Quotes refresh about every 30 seconds and always expose provider, timestamp, and quality.
- Orders require sufficient buying power. Maintenance deficiencies trigger forced liquidation to a 110% buffer.
- American and European option exercise styles are supported. Long American contracts can be exercised manually in-session; contracts at least $0.01 in the money auto-exercise at expiry.
- Physically delivered futures are closed before first notice; futures rolling is manual.
- Cash earns no interest, negative balances accrue no interest, and explicit commissions default to zero.
- FIFO lots and immutable cash-ledger events provide the accounting foundation; automatic corporate actions remain a later phase.
- Allocation targets must total 100% and display drift without automatically trading. Portfolios can be archived or permanently deleted from Settings.

See [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) for the complete blueprint.
