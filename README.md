# Nevada 2026 Election Results (unofficial tracker)

Independent, **unofficial** tracker of Nevada's Nov 3, 2026 general election. Not an official government site.
Numbers are mirrored, unmodified, from the Nevada Secretary of State results feed
(https://silverstateelection.nv.gov/); Washoe County Registrar: https://electionresults.washoecounty.gov/.

- Site: static HTML/JS/CSS on GitHub Pages (`main` branch).
- Data: `data/results.json` on `main`, served by Pages (live ~30-90 s after a push; each Pages deploy purges
  the CDN); `raw.githubusercontent.com/.../main/data/results.json` (~5 min cache) is the page's fallback.
  The page re-fetches the data about every 60 seconds and re-renders without reloading.
- Updaters (two, coordinated): both run the same vendored `scripts/fetch.py` and publish with the same rule — hard-reset
  to `origin/main`, then commit `data/results.json` only if its content (ignoring the `u` fetch time) differs **and**
  its SOS release `seq` is not older than the published one. Whichever sees new data first pushes it; the other then
  finds it identical, and a lagging fetcher can never roll the site back. A rejected push is re-evaluated next cycle.
  1. GitHub Actions: `.github/workflows/update-data.yml` -> `scripts/publish_loop.py`. Cron every 5 min; each run
     loops ~52 min (26 fetches, 2 min apart; job timeout 58 min); `concurrency: update-data` (no overlap, one queued);
     `GITHUB_TOKEN` with `contents: write` (+ `pages: write` to request a Pages build after each data push);
     `workflow_dispatch` (input `iterations`). Does nothing after Nov 13, 2026 11:59 PM PT.
  2. Backup on the maintainer's always-on box (`site_updater.py`, every 2 min, same rule, dedicated clone).
- Only numbers present in the SOS feed are ever published; nothing is estimated or projected.

## Reno mayor by precinct (`data/reno_precincts.json`)

- The SOS election-night feed has city-wide totals only. Precinct counts come solely from the Washoe County
  Registrar's **Statement of Votes Cast** spreadsheet (.xlsx), linked from
  https://www.washoecounty.gov/voters/results/2026data.php. In the June 2026 primary the unofficial one
  (`6-9-USOVC.xlsx`) was generated 12:45 AM PT the night of the election and online by noon the next day; the official
  one followed at the canvass.
- `scripts/reno_precincts.py` (finds the link) + `scripts/washoe_sovc.py` (parses it) run every cycle in both updaters.
  Fail-safe: the file is published only if the RENO CITY MAYOR contest is found, the candidates are exactly Marshall and
  Taylor, the file is dated on/after Nov 3, 2026, every row is understood, and precinct sums equal the file's county total
  (skipped only where the county masks small precincts with `****`). Anything else -> `"status":"awaiting"` (map stays gray).
  Published `ok` data is never replaced by `awaiting` or by an older spreadsheet. Validated against both real June 2026 primary files.
- Boundaries: Washoe County GIS OpenData FeatureServer layer 7 (Voter Precincts), 161 precincts with a Reno ward
  (RWARDS 1-6), simplified into `geo.json` -> `precincts`; this matches the 161 precincts in the county's RENO CITY MAYOR contest.
