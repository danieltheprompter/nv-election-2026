# Nevada 2026 Election Results (unofficial tracker)

Independent, **unofficial** tracker of Nevada's Nov 3, 2026 general election. Not an official government site.
Numbers are mirrored, unmodified, from the Nevada Secretary of State results feed
(https://silverstateelection.nv.gov/); Washoe County Registrar: https://electionresults.washoecounty.gov/.

- Site: static HTML/JS/CSS on GitHub Pages (`main` branch).
- Data: `data/results.json` on `main`, served by Pages (live ~30-90 s after a push; each Pages deploy purges
  the CDN). `results.json` on the `data` branch (raw.githubusercontent.com, ~3-5 min cache) is a fallback. Updated by a script that checks the SOS feed
  every 2 minutes and commits only when the SOS release or Washoe status changes.
- The page re-fetches the data about every 60 seconds and re-renders without reloading.
