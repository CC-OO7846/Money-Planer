# Changelog

## 11.1.0 - 2026-09-13

### Financial model

- Split monthly planning into Plan Free Cash and Available Free Cash after active Goal Funding.
- Added a month-keyed Goal Funding ledger; an applied cycle now reduces available cash and records before/after goal balances.
- Added current-month Undo Funding, which reverses goal allocations, restores available cash, preserves an audit entry, and enables a replacement application.
- Removed the unused Goal Monthly Contribution field from the active model and archived existing values during schema migration.
- Made Buy Check category materially affect its caution threshold and recommendation.

### Monthly close and calendar

- Added a mandatory close-review dialog before any snapshot can be frozen.
- Made Actual Base Net Income and Actual OT Income editable during close review.
- Added reason-required reopen and revisioned reclose workflows while retaining each prior frozen value set in the audit trail.
- Froze Salary Day in each snapshot and made closed-month Calendar events use that value instead of current Settings.
- Added Goal Funding transfers to Projected Cash Balance without conflating the calendar forecast with Plan Free Cash.
- Excluded reopened snapshots from historical Trend until they are reviewed and closed again.

### Interface, migration, and release

- Clarified Plan Free Cash, Available Free Cash, Projected Cash Balance, and Actual Closing Cash Balance labels throughout the app.
- Added funding and monthly-close audit panels with safe control states.
- Added schema-11 migration for V11.0 funding records, closed snapshots, and removed monthly-contribution data.
- Added an explicit global `[hidden]` rule so state-dependent action buttons cannot be exposed by component display styles.
- Bumped the document title, UI version, schema, export filenames, service-worker cache, and release documentation to V11.1.

## 11.0.0 - 2026-09-12

### Architecture

- Replaced the historical override stack with a single canonical state model and one `renderApp()` entry point.
- Added centralized `calculateFinance()` and month-keyed OT state.
- Added schema-10 migration with legacy-data archival and corrupt-storage recovery.
- Replaced duplicate direct listeners with delegated document-level handlers.

### Finance and data

- Enforced Base + Actual OT as Monthly Income; OT Target is never treated as income.
- Enforced category planning totals as Monthly Expense; transactions no longer mutate planning values.
- Enforced the same Free Cash calculation across Dashboard, OT, Buy Check, Goals, Monthly Close, and Trend.
- Added immutable monthly snapshots and snapshot-first historical trends.
- Added deterministic calendar balances with a saved opening balance and no duplicate salary, OT, or recurring entry.

### Features

- Simplified OT Planner to Target, Actual Earned, Still Needed, progress, and status.
- Added complete transaction create/edit/delete/search/filter workflow.
- Added recurring create/edit/delete/status/Mark Paid workflow with monthly duplicate protection.
- Added goal create/edit/delete/funding with allocation validation and target caps.
- Added category create/edit/delete with a permanent Other fallback and history preservation.
- Organized Settings into Income, Planning, Payday, Goal Funding, Data, and App.

### Interface, accessibility, and PWA

- Rebuilt responsive grids, card flow, calendar, wide-value wrapping, mobile navigation, and desktop sidebar.
- Added visible focus styles, native accessible dialogs, Escape close support, labeled controls, and minimum touch targets.
- Added complete PWA assets and a network-first update strategy with offline fallback.
- Updated title, UI version, cache, documentation, and release metadata to CLEAN // PLANNER V11.0.
