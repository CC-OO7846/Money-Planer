# Architecture Cleanup Summary

## Runtime flow

```text
loadState()
  -> migrateState(schema 12)
  -> validateState()
  -> canonical state
  -> calculateFinance()
  -> renderApp()
       -> render active page
       -> update navigation
       -> update runtime status
```

Mutations follow one path:

```text
validated user action -> round at mutation boundary -> update canonical state -> validateState() -> persist() -> render active view
```

No renderer calls `renderApp()`, no renderer wraps another renderer, and event listeners are attached once.

## Dependency map

| Source | Derived or consuming features |
| --- | --- |
| Base Net Income | Monthly Income, Dashboard, Plan Free Cash, Calendar salary, Monthly Close, active Trend |
| Actual OT by month | Monthly Income, OT progress, Dashboard, Plan and Available Free Cash, Goal Funding, Calendar, Monthly Close, active Trend |
| OT Target by month | OT Still Needed, progress, status only |
| Category `monthlyAmount` | Monthly Expense, Dashboard, Plan and Available Free Cash, Financial Health, Goal Funding cap, Monthly Close, active Trend |
| Transactions | Transaction history, search/filter, Calendar posted events; never Monthly Expense |
| Saving and Investment plan | Plan Free Cash, Dashboard, Monthly Close preview |
| Plan Free Cash | Monthly planning result before Goal Funding |
| Goal Funding active cycle | Goal balances, Available Free Cash, Calendar transfer, Monthly Close, Trend |
| Available Free Cash | Dashboard, Buy Check, Financial Health, Smart Insights, Goal Funding cap |
| Recurring items | Upcoming/Due/Paid status, Calendar scheduled events, one posted transaction per month |
| Goals | Progress, validated allocation, capped and reversible monthly funding |
| Opening balance | Deterministic Calendar projected running and closing balances |
| Closed snapshots | Frozen income, plan, funding, salary day, revision audit, Calendar income dates, and closed-month Trend rows |

## State shape

- `settings`: base income, emergency fund, saving goal, investment goal, salary day.
- `categories`: stable IDs, name, icon, planned monthly amount.
- `transactions`: history records with safe category-label preservation.
- `recurring`: bill templates; payment state is derived from month-tagged transactions.
- `goals`: balances, targets, and allocation percentages.
- `otByMonth`: the single OT source of truth.
- `calendarOpeningBalances`: per-month opening values.
- `closedMonths`: revisioned finance snapshots with closed/reopened status, standard/manual type, frozen Salary Day, and a value-preserving audit trail.
- `allocationRules`: validated goal-funding policy.
- `allocationHistory`: month-keyed funding cycles with applied/undone status, reversible before/after goal balances, and a frozen finance/rule basis.
- `meta`: schema timestamps, last full-backup time, and migration archive, including removed V11.0 Monthly Contribution values.

## Cash concepts

```text
Plan Free Cash
  = Monthly Income - Monthly Expense - Saving Goal - Investment Goal

Available Free Cash
  = Plan Free Cash - active Goal Funding

Projected Cash Balance
  = Opening Balance + dated Calendar inflows and outflows
```

The Calendar projection includes a Goal Funding transfer but otherwise uses transaction and recurring dates; it is not a second implementation of the monthly planning formula.

## Audit workflows

Applying Goal Funding records a ledger cycle before persistence. Undo uses its before/after entries to restore goal balances and changes the cycle status rather than deleting it.

Monthly Close creates revision 1 only after a confirmation review. Reopen records the complete frozen revision plus a reason. Reclose creates the next revision and keeps earlier frozen values in `auditTrail`.

Manual historical backfill follows the same review boundary, records `historical-backfill` at revision 1, and never copies live settings unless the user chooses Copy Current Plan.

## Import transaction boundary

```text
parse -> source checks -> migrate/normalize -> validateState -> review counts
      -> pre-import backup -> clone next state -> validateState -> persist
      -> success, or restore prior clone on any commit failure
```

CSV adds stable-ID, recurring-month, and legacy-fingerprint deduplication before the review. The current transaction UI filters are runtime state and survive import/navigation.

## Rendering and error boundaries

Each page has one renderer: Dashboard, Monthly Expense, OT, Transactions, Recurring, Goals, Calendar, Monthly Close, Trend, Categories, and Settings. `renderApp()` selects exactly one renderer. All public actions pass through `safely()`, which displays a readable application error instead of silently swallowing it.
