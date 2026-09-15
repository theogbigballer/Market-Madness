# Market Madness product specification

## Mission

Build a rigorous but approachable local portfolio simulator. The product favors visibility and correct accounting over game mechanics. Every balance, fill, margin change, lifecycle event, and P&L figure must be explainable from source quotes and immutable ledger entries.

## Scope

The initial market universe is US-listed equities and equity options, US crypto pairs, CME-group futures, and custom OTC-style forwards. Portfolios begin on the current date and use USD as their base currency. Historical replay and international markets are out of scope.

Users may create multiple isolated portfolios, transfer cash between them, archive them, and permanently delete an archive after confirmation. Position transfers are not supported. The app reopens the last portfolio and offers a consolidated read-only view.

## Portfolio creation and onboarding

Onboarding creates a portfolio and selects starting capital, theme, and optional Advanced Derivatives access. Starting capital must be at least $1,000; the suggested value is $500,000. The first ledger event records that capital and is never edited in place. Benchmark selection happens only after the user enters the app, where each portfolio can maintain a comparison set instead of being forced into one primary benchmark.

The app works immediately with explicit demonstration data. Provider setup explains free Alpaca, public crypto, and delayed fallback coverage without presenting delayed or indicative data as live.

## Trading sessions

Exchange calendars determine holidays, daylight-saving transitions, and early closes. Equity and equity-option orders cannot execute outside regular hours. Eligible orders submitted while closed become scheduled, remain cancelable, and activate at the next open. Market orders use the opening bid or ask plus impact; limit and stop orders begin evaluating in-session. Crypto and futures use their own calendars.

When the app resumes after being offline, it processes only relevant missed events. Historical-bar fills are labeled reconstructed. This catch-up path is idempotent and opens the UI before long work completes.

## Orders and execution

Supported single-leg orders are market, limit, stop, and stop-limit, with Day and GTC duration. Atomic multi-leg option market orders support two to four editable legs, net-debit or net-credit pricing, combined buying-power checks, and closed-session queuing. Small orders fill immediately from bid/ask. Larger single-leg orders receive deterministic spread, size, liquidity, and volatility impact. The preview discloses reference price, estimated price, slippage, cash impact, margin impact, and rejection reason.

States are draft, submitted, scheduled, accepted, partially filled, filled, canceled, expired, or rejected. All explicit commissions and fees default to zero but remain configurable. Spread and market impact always remain active.

## Buying power and liquidation

Every accepted order must pass cash and initial-margin checks. Equity margin begins with a Regulation T-style model. Options recognize covered positions and defined-risk offsets before applying naked requirements. Futures use exchange/provider margin when available and dated configurable fallbacks otherwise.

Maintenance deficiencies immediately cancel reserving orders and initiate forced liquidation. The engine prioritizes margin relief and liquidity until equity reaches 110% of maintenance. Instruments in closed sessions queue mandatory liquidation for their next open. Negative balances are preserved as debt.

## Derivatives

Advanced Derivatives gates naked short options but not ordinary defined-risk positions. Both American and European contracts are supported. American holders may request in-session early exercise; deterministic economic rules will model early assignment in a later lifecycle pass. At expiration, any contract at least $0.01 in the money auto-exercises. Exercise, assignment, resulting underlying positions, and liquidation are distinct ledger events.

Cash-settled derivatives post cash directly. Physically settled options create or remove underlying positions. Physically delivered futures must be closed before first notice; cash-settled futures settle normally. Rolls are manual with alerts and a one-click roll ticket.

Forward creation uses a recognized underlying dropdown and captures direction, quantity/notional, delivery price, dates, settlement type, counterparty label, and notes. Market rates may inform derivative valuation, but portfolio cash and debt accrue no interest.

## Accounting and P&L

The cash ledger and FIFO position lots are authoritative. Daily P&L equals current equity less previous close equity and net external flows. Reports separate realized, unrealized, fees, FX, settlements, exercise, assignment, dividends, and corporate actions. Daily snapshots and transaction history persist indefinitely; intraday quote cache is retained for 30 days.

## Data providers

Provider adapters normalize instrument identity, bid, ask, last, mark, timestamp, and quality. Initial modes are free Alpaca coverage, public crypto feeds, delayed/unofficial fallback sources, and deterministic demonstration data. The UI labels live, delayed, indicative, simulated, and stale quotes. A feed failure never silently reuses an old quote as live.

## Product surfaces

- Overview: equity, cash, buying power, P&L, exposure, allocation drift, multi-benchmark comparisons, expirations, and warnings.
- Trade: instrument search, multi-asset order ticket, estimated fill, and buying-power preview.
- Positions: grouped live marks, lots, cost basis, margin, lifecycle, and Greeks.
- Markets: watchlists, charts, futures curves, options chains, timestamps, and provider status.
- Orders: scheduled, open, partial, filled, rejected, canceled, and reconstructed activity.
- P&L: daily and cumulative attribution by instrument, asset class, and source.
- Risk: leverage, concentration, margin utilization, Greeks, delta-adjusted exposure, and shocks.
- Allocation: targets, ranges, cash reserve, limits, drift, and rebalance analysis.
- Activity: immutable trade, cash, settlement, exercise, assignment, corporate-action, and liquidation ledger.
- Settings: providers, liquidity model, themes, advanced derivatives, archives, and CSV exports.

## Design system

The interface is dense, professional, and desktop-first while remaining responsive. Light and dark themes have equal status. Green and red never carry meaning without signs or labels. Tables use tabular numerals, timestamps are visible, data quality is explicit, and every aggregate exposes its calculation.

## Delivery phases

1. Multiple portfolios, onboarding, ledger, instruments, provider contracts, calendars, and dashboard.
2. Equity and crypto orders, FIFO lots, execution impact, allocation, P&L, and benchmark comparison.
3. Futures lifecycle, margin, settlement, first-notice enforcement, and rolls.
4. Options chains, multi-leg orders, Greeks, margin offsets, exercise, and assignment.
5. Custom forwards, richer risk scenarios, corporate actions, catch-up processing, and CSV exports.

## Definition of done

Critical financial calculations use decimal-safe arithmetic and tested deterministic inputs. Lifecycle processing is idempotent. No equity order fills outside its regular session. Every fill preserves its quote source and execution assumptions. Every cash movement maps to an immutable ledger event. Forced liquidation restores the configured buffer or records unresolved debt. UI figures reconcile to the ledger and disclose stale or non-live data.
