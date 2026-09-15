# Market Madness

Market Madness is a local-first, multi-portfolio trading simulator for US equities, equity options, crypto, CME-group futures, and custom forwards. It is designed around an auditable ledger, realistic buying-power checks, exchange calendars, derivative lifecycles, and transparent market-data quality.

## Current state

The repository now includes the product specification, core domain policies, a durable local D1/SQLite ledger, portfolio onboarding, multi-portfolio switching, account calculations, 30-second quotes, and an initial equity/crypto order path. Market and marketable limit orders fill against an explicit spread-and-size-impact model; US equity orders submitted outside the regular session are queued for the next open.

The included quote adapter is deliberately labeled as simulated. It keeps the app usable without credentials while free live-data provider adapters are added next; it must not be mistaken for exchange data.

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
- American and European option exercise styles are supported. Contracts at least $0.01 in the money auto-exercise.
- Physically delivered futures are closed before first notice; futures rolling is manual.
- Cash earns no interest, negative balances accrue no interest, and explicit commissions default to zero.
- FIFO lots, automatic corporate actions, and immutable cash-ledger events provide the accounting foundation.

See [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) for the complete blueprint.
