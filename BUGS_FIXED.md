# Bugs Fixed in V11.2

## V11.2 production hardening

- JSON import no longer replaces live state before validation and confirmation. Future schemas are rejected, current data is backed up first, and commit failure rolls back automatically.
- Re-importing the same CSV no longer creates duplicate transaction history. Stable IDs, recurring-month identity, and a legacy fingerprint make imports idempotent.
- CSV export no longer drops recurring IDs, timestamps, or category identity, and formula-like cells are protected for spreadsheet use.
- Active Goal Funding no longer appears current after its calculation inputs change. The original basis is frozen and shown as `PLAN CHANGED` until safely undone or recalculated.
- Repeated apply/undo/recalculate cycles no longer accumulate floating-point drift; mutation boundaries use cent-stable rounding.
- Negative daily allowance no longer looks like live spending capacity; it is labelled Plan shortfall and explained as planning data.
- Calendar now states that undated category plans are excluded and separately reports Opening Balance, posted expenses, and upcoming recurring totals.
- Past unclosed months no longer require invented current values. Manual historical backfill starts blank and creates a labelled, revisioned audit snapshot only after review.
- localStorage denial and quota failures no longer imply a successful save. State remains usable in memory and a persistent backup warning is shown.
- Destructive actions no longer use inaccessible browser confirmation prompts; app dialogs explain consequences, support Escape/focus return, and prevent repeated taps.
- Transaction filters no longer reset during navigation, and deleting the selected category falls back to All.
- A waiting service worker no longer activates invisibly; Update Now activates it and reloads once.
- Large transaction histories no longer create thousands of live record cards at once.

## V11.1 confirmed issues

- Goal Funding no longer leaves the same cash spendable twice; an active funding cycle is deducted from Available Free Cash everywhere.
- Goal Funding can be undone safely in the current month. The app restores affected goal balances, marks the ledger cycle undone, restores Available Free Cash, and only then permits reapplication.
- Goal Monthly Contribution is no longer an inert field. It was removed from the active form/state, while existing values are retained in the migration archive.
- Buy Check Category now selects a category-specific caution threshold and guidance, so identical purchases can receive different risk recommendations.
- Monthly Close no longer freezes immediately. A full review and explicit checkbox confirmation are required.
- Closed snapshots can now be reopened with a required reason, corrected, reviewed, and frozen as a new revision without discarding prior frozen values.
- Actual Base Net Income and Actual OT Income can be corrected in the close draft before review.
- Closed-month Calendar salary and historical OT use the snapshot's frozen Salary Day, not the current Settings value.
- Plan Free Cash, Available Free Cash, Projected Cash Balance, and optional Actual Closing Cash Balance are now distinct labels and values.
- Component display styles can no longer override the `hidden` attribute on state-dependent controls.

## V11 foundation retained

## Financial consistency

- Removed competing definitions of income, expense, OT, and free cash.
- Stopped OT Target and legacy OT projections from entering income calculations.
- Stopped transaction CRUD and recurring payments from rewriting category plans.
- Stopped goal funding from exceeding available Free Cash or a goal target.
- Stopped closed-month history from changing when current settings change.
- Removed calendar salary/OT duplication and made event ordering deterministic.
- Added an explicit Opening Balance save action so input commit behavior is unambiguous.

## State and lifecycle

- Removed nested render wrappers, execution-order patches, and circular render risks.
- Removed duplicate listeners and stale render aliases.
- Added guards for missing DOM nodes, invalid dates, non-finite/negative values, missing categories, and duplicate recurring posts.
- Added structured feedback for invalid JSON/CSV instead of silent failure.
- Preserved deleted-category transaction labels while moving their live category reference to Other.

## UI and responsive behavior

- Removed hard-coded dashboard grid-row placement and gave Smart Insights its own row.
- Contained the Financial Health ring within its card.
- Fixed mobile/tablet/desktop card flow, long THB values, filter controls, record actions, modal sizing, calendar cells, and navigation clearance.
- Removed broken image dependencies and replaced the stale illustration map with code-native UI and validated local PWA assets.
- Removed Thai-language remnants and stale V8/V9/V10 production labels.

## PWA and accessibility

- Added missing manifest, favicon, Apple touch icon, 192px icon, and 512px icon.
- Fixed update version skew where new HTML could temporarily load old cached JavaScript.
- Fixed offline readiness reporting so a failed update check does not invalidate an already active offline cache.
- Restored browser zoom, added button names and form labels, improved focus visibility, and kept touch controls at accessible sizes.
