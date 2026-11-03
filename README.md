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
