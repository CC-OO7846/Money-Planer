# Known Limitations

- Data is local to the current browser profile and site origin. There is no cloud sync or account recovery; regular JSON export is recommended.
- Browsers can evict localStorage in private browsing or under storage pressure.
- PWA installation and offline caching require HTTP, HTTPS, or localhost. Direct `file://` use supports the planner but not the service worker.
- Reopening a Monthly Close changes only that historical snapshot. Corrected Actual Base or OT values do not rewrite current Settings or the live OT record.
- A reopened snapshot is intentionally omitted from Trend until the correction is reviewed and frozen as a new revision.
- Category plans do not have due dates, so Calendar shows posted transactions and dated recurring items rather than inventing daily events from the monthly category total.
- Calendar Projected Cash Balance is a dated cash forecast and can differ from Plan Free Cash by design. It uses Opening Balance and cash events rather than the undated category plan total.
- CSV backup covers transactions only. JSON is the full-fidelity backup for settings, categories, OT, recurring, goals, openings, and closed history.
