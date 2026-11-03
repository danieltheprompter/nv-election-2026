# Nevada 2026 Election Results (unofficial tracker)

Independent, **unofficial** tracker of Nevada's Nov 3, 2026 general election. Not an official government site.
Numbers are mirrored, unmodified, from the Nevada Secretary of State results feed
(https://silverstateelection.nv.gov/); Washoe County Registrar: https://electionresults.washoecounty.gov/.

- Site: static HTML/JS/CSS on GitHub Pages (`main` branch).
- Data: `results.json` on the `data` branch (served via raw.githubusercontent.com, which updates faster than
  the Pages CDN); `data/results.json` on `main` is a fallback copy. Updated by a script that checks the SOS feed
  every 2 minutes and commits only when the SOS release or Washoe status changes.
- The page re-fetches the data about every 60 seconds and re-renders without reloading.
