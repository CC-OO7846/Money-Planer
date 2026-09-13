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

- Schema-10 test data migrated to schema 11 without losing any active record; removed Goal Monthly Contribution values were present in the migration archive.
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

The V11.1 feature suite passed 29/29 checks. The responsive route-width matrix passed 156/156 cases with zero page overflow, route failures, undersized page buttons, console errors, page exceptions, or network failures. Browser tests used an isolated Chrome profile; the final visual inspection was read-only and did not modify the existing in-app browser data.
