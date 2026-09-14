# Validation Report

Validated on 2026-09-13 against the production files in this release.

## Static validation

| Check | Result |
| --- | --- |
| `node --check app.js` | PASS |
| `node --check sw.js` | PASS |
| Duplicate IDs | 0 |
| Missing navigation targets | 0 |
| Missing static DOM references | 0 |
| Broken asset paths | 0 |
| Broken ART_MAP keys | 0 |
| Thai characters in production source | 0 |
| Stale asset paths | 0 |
| TODO / FIXME / debugger / console debug calls | 0 |
| `undefined` / `NaN` source-hygiene matches | 0 |

## Responsive browser matrix

Each width was checked on Dashboard, Monthly Expense, OT, Buy Check, Transactions, Recurring, Goals, Calendar, Monthly Close, Trend, Categories, and Settings.

| Viewport width | Pages passed | Page horizontal overflow |
| ---: | ---: | ---: |
| 320 | 12/12 | 0 |
| 360 | 12/12 | 0 |
| 375 | 12/12 | 0 |
| 390 | 12/12 | 0 |
| 414 | 12/12 | 0 |
| 430 | 12/12 | 0 |
| 768 | 12/12 | 0 |
| 820 | 12/12 | 0 |
| 1024 | 12/12 | 0 |
| 1280 | 12/12 | 0 |
| 1366 | 12/12 | 0 |
| 1440 | 12/12 | 0 |
| 1920 | 12/12 | 0 |

The matrix also verified active-route correctness, bottom-navigation clearance, and visible page buttons at or above a 40px minimum dimension.

## Browser interaction checks

- Schema-10 and schema-11 test data migrated to schema 12 without losing active records; removed Goal Monthly Contribution values remained in the migration archive.
- Base Income changed and persisted after reload.
- Actual OT changed; Monthly Income became Base + Actual OT.
- Category plan changed; Monthly Expense, Plan Free Cash, and Available Free Cash updated immediately.
- Transaction added, edited, deleted, searched, and filtered without changing Monthly Expense.
- Category added and edited.
- Goal added and edited without an unused Monthly Contribution field.
- Goal Funding reduced Available Free Cash and increased the goal balance by the exact ledger allocation.
- Undo Funding restored the goal balance and Available Free Cash, retained the undone audit cycle, and allowed one replacement application.
- Recurring item added and marked paid; exactly one monthly transaction was created and the plan stayed unchanged.
- Buy Check produced different recommendations for Essential / Work and Lifestyle at the same price and priority.
- Monthly Close did not freeze before the review, and an unchecked review could not be submitted.
- Corrected Actual Base and OT values were frozen only after confirmation.
- The snapshot stored Plan Free Cash, Goal Funding, Available Free Cash, Projected Cash Balance, and Salary Day independently.
- After current Settings Salary Day changed, the closed-month Calendar still placed salary on its frozen day.
- Reopen required a reason, retained the prior frozen value set, and reclose created revision 2.
- Opening Balance saved and changed the deterministic Projected Cash Balance.
- Trend used the closed revision rather than current settings and clearly separated Plan and Available Free Cash.
- Every page was navigated in the live browser.
- Full page reload preserved local data.
- Fresh PWA install reached Offline Ready; a complete reload succeeded with browser networking disabled.
- Browser console warnings/errors during the final interaction and offline checks: 0.

## V11.2 hardening checks

- Future-schema JSON rejected with the required user-facing message.
- Full JSON import showed Categories, Transactions, Recurring, Goals, Closed Months, and OT Months before applying.
- A simulated quota failure restored the pre-import state and exposed the persistent Export Backup Now warning.
- Successful JSON import created a separate pre-import backup and committed only after validation.
- CSV preview reported New, Duplicate, and Invalid rows; importing the same file twice added zero duplicates.
- CSV round-trip preserved ID, recurring tag/ID, timestamp, category ID/label, and protected formula-leading cells.
- Imported HTML-like transaction names rendered as literal text without executable DOM.
- Goal Funding basis change showed `PLAN CHANGED` without mutating the original cycle; Undo & Recalculate left one active cycle.
- Repeated decimal apply/undo cycles reconciled to the cent, retained bounds, and showed no balance drift.
- Manual historical backfill started blank, required all fields and confirmation, and created revision 1 with `historical-backfill`.
- Reopen/reclose produced monotonic audit revisions `[1, 1, 2]` while preserving the revision-1 value copy.
- Closed historical Calendar used its frozen salary day and Trend labelled the source `MANUAL`.
- Transaction search/month/category state survived navigation; deleting the selected category fell back to All.
- Leap-day input was accepted; impossible dates were rejected with an associated form error.
- Simulated unavailable localStorage kept the app functional and displayed the persistent warning.
- Duplicate canonical IDs in stored state stopped normal load, preserved the corrupt source, loaded safe defaults, and displayed a clear startup error.

## Large-data stress result

An isolated Chrome profile loaded 5,000 transactions, 100 recurring items, 100 goals, and 100 categories. The Transactions DOM was capped at 300 visible matching cards without removing stored rows. Representative synchronous render times were approximately 89 ms for Transactions, 39 ms for Recurring, 49 ms for Goals, 25 ms for Calendar, and 9 ms for Dashboard on the test host.

The V11.2 regression suite passed 29/29 checks and the V11.2 hardening suite passed 34/34 checks. The responsive route-width matrix passed 156/156 cases with zero page overflow, route failures, undersized page buttons, console errors, page exceptions, or network failures. Browser tests used isolated Chrome profiles; the final in-app visual inspection was read-only and reported zero console warnings/errors.
