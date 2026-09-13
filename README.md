# CLEAN // PLANNER V11.1

CLEAN // PLANNER is a local-first monthly financial planning application. V11.1 hardens the canonical V11 architecture with auditable goal funding and monthly-close correction workflows. It is an in-place production upgrade, not a replacement app.

## Run locally

Serve this directory over HTTP. For example:

```text
python -m http.server 8080
```

Then open `http://localhost:8080/`.

Opening `index.html` directly supports the core planner, but PWA installation and offline caching require HTTP, HTTPS, or localhost.

## Deploy to GitHub Pages

1. Extract the release ZIP.
2. Place every extracted file at the root of the Pages publishing source.
3. Commit and push the files.
4. In repository settings, enable GitHub Pages for that branch and root directory.

All links, manifest paths, icons, and service-worker paths are relative, so the app works from a repository subpath.

## Financial source of truth

```text
Monthly Income      = Base Net Income + Actual OT Earned
Monthly Expense     = sum of category Monthly Expense amounts
Plan Free Cash      = Monthly Income - Monthly Expense - Saving Goal - Investment Goal
Available Free Cash = Plan Free Cash - active Goal Funding applied this month
OT Still Needed     = max(0, Monthly OT Target - Actual OT Earned)
```

Plan Free Cash describes the monthly plan. Available Free Cash is what remains after current-month Goal Funding. Projected Cash Balance is a separate dated calendar forecast using Opening Balance, salary, OT, posted transactions, upcoming recurring items, and Goal Funding transfers.

Transactions are history only. Adding, editing, deleting, importing, or creating a transaction from Recurring never changes the Monthly Expense plan.

## Goal Funding

- Allocation rules determine a capped funding pool from Available Free Cash and Actual OT.
- Applying funding records a month-keyed ledger cycle, increases goal balances, and reduces Available Free Cash.
- Only one funding cycle can be active for a month.
- Undo restores the affected goal balances and Available Free Cash, preserves the old cycle as `undone`, and then permits a replacement application.
- Goal balances never exceed their targets and total allocation cannot exceed 100%.
- The unused Goal Monthly Contribution control was removed. V11.0 values are preserved in `meta.migrationArchive.goalMonthlyContributions`.

## Monthly Close

Monthly Close requires a confirmation review. Actual Base Net Income, Actual OT Income, Actual Saving, Actual Investment, Salary Day, and optional Actual Closing Cash Balance can be corrected before freezing.

A closed snapshot stores the plan, applied funding, Available Free Cash, Projected Cash Balance, and Salary Day. Reopening requires a reason, preserves the prior frozen values in the audit trail, and reclosing creates a new revision. Trend uses only closed revisions; a reopened month is excluded until it is reviewed and closed again.

## Data and migration

- Data remains in the existing `clean_planner_dime_style_v1` localStorage key.
- Schema version is `11`.
- V8/V9/V10 and V11.0 records are migrated field by field without clearing storage.
- Actual OT remains normalized into month-keyed records.
- Closed months gain status, revision, audit trail, frozen Salary Day, and distinct cash fields.
- V11.0 Goal Funding records are converted into ledger cycles.
- Removed legacy fields are retained in `meta.migrationArchive` when recovery value remains.
- Corrupt stored JSON is copied to a timestamped backup key before safe defaults are loaded.

Use Settings > Data > Export JSON for a full backup. CSV import and export cover transaction history only.

## PWA

The release includes a manifest, favicon, 192px icon, 512px icon, and service worker. The cache is versioned as `clean-planner-v11.1.0-2026-09-13-r1`. Requests use a network-first strategy with offline-cache fallback so a newly deployed HTML file cannot be paired with stale JavaScript.

## Release documents

- [CHANGELOG.md](CHANGELOG.md)
- [BUGS_FIXED.md](BUGS_FIXED.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [VALIDATION.md](VALIDATION.md)
- [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)
