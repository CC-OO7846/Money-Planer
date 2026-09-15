# Changelog

## 11.2.0 - 2026-09-13

### Import, validation, and storage safety

- Added full-state validation after migration and every JSON/CSV import.
- Added explicit future-schema rejection, six-count JSON review, automatic pre-import backup, transactional commit, and rollback on persistence failure.
- Expanded CSV round-trip identity to include transaction ID, category ID/label, recurring ID/tag, and creation timestamp.
- Added stable-ID and legacy-fingerprint deduplication with a New / Duplicate / Invalid preview; repeated imports are idempotent.
- Added a persistent memory-only warning with Export Backup Now when localStorage is blocked or a quota write fails.
- Added Last full backup metadata and Settings status.

### Financial and historical integrity

- Added canonical two-decimal `roundMoney()` handling at financial mutation boundaries.
- Goal Funding cycles now freeze their financial basis and complete allocation rules.
- Added derived `PLAN CHANGED` detection plus an atomic Undo & Recalculate workflow without silent balance mutation.
- Added blank-by-default, explicitly reviewed historical snapshot backfill with a dedicated `historical-backfill` audit event.
- Strengthened close/reopen/reclose validation for monotonic revisions, deep-copied values, and Trend exclusion while reopened.
- Clarified negative daily allowance as Plan shortfall and clarified Calendar inclusion/exclusion with separate totals.

### UX, accessibility, performance, and PWA

- Replaced native confirm prompts with consistent accessible dialogs that explain each destructive result, restore focus, support Escape, and guard repeated taps.
- Added associated inline form errors while retaining the global error boundary.
- Preserved transaction search, month, and category filters; deleting the active category now falls back to All.
- Bounded transaction DOM rendering to 300 visible records while preserving and filtering the full dataset.
- Added safe waiting-service-worker update UI with one reload after activation.
- Bumped the app, UI, schema, cache, exports, documentation, and validation suites to V11.2.

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


## V11.2.1 — Icon / PWA metadata fix
- Added PNG favicon fallbacks at 16x16 and 32x32.
- Added the correct 180x180 Apple touch icon.
- Split regular and maskable manifest icons.
- Added a dedicated 512x512 maskable icon.
- Bumped service-worker cache so installed clients fetch the new icon metadata.


## V11.2.2 — Money App Icon
- Replaced the app/PWA icon set with the new wallet + money artwork.
- Removed old SVG favicon precedence so the new PNG favicon is used.
- Updated Apple touch icon, Android/Chrome PWA icons, and maskable icon.
- Added cache-busting query strings to icon metadata.
- Bumped the service-worker cache so clients fetch the new icon set.


## V11.2.4 — App icon only
- Removed the temporary money icon from the in-app CLEAN // PLANNER header.
- Restored the original // brand mark.
- Money artwork remains only as the installed PWA / Home Screen app icon.
- Bumped manifest identity and service-worker cache.


## V11.2.5 — Mobile Home Screen icon compatibility
- Moved canonical iOS and PWA icons to the repository root.
- Added conventional `/apple-touch-icon.png` fallback.
- Added iPhone/iPad touch icon sizes 120, 152, 167 and 180.
- Removed query strings from Apple touch icon URLs.
- Reset manifest id/start_url/scope to stable relative root values.
- Added separate PWA `any` and `maskable` icons with versioned filenames.
- Added favicon.ico fallback.
- Added `icon-check.html` to verify that GitHub Pages serves the icon file directly.
- Bumped service-worker cache.
