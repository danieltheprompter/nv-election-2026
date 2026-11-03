#!/usr/bin/env python3
"""Ballots-received fetcher for the NV 2026 tracker (ballots.html).

Reads the two JSON files behind the Nevada Secretary of State's VIVID dashboard (https://www.nvsos.gov/vivid/):
  data/ballot-seed.json   mail ballots by county and party: sent, undeliverable, received, accepted, rejected,
                          signature cure, cured, canceled
  data/turnout-seed.json  in-person turnout by county, party and day (early voting days + Election Day)
nvsos.gov sits behind a bot wall, so the files are fetched from inside a real Chrome page (Playwright, system
/usr/bin/google-chrome), as scripts/fetch.py does. Active registration by county & party comes from
data/registration.json (built from the SOS monthly "Active Voters by County & Party" report; see that file's "src").

Writes --out only if every check passes; never estimates anything. Exit codes: 0 written, 2 fetch/validation failed.
"""
import argparse, asyncio, datetime as dt, json, os, sys
from zoneinfo import ZoneInfo

PT = ZoneInfo("America/Los_Angeles")
BASE = "https://www.nvsos.gov/vivid/"
FILES = {"mail": "data/ballot-seed.json", "inperson": "data/turnout-seed.json"}
COUNTIES = ["Carson City", "Churchill", "Clark", "Douglas", "Elko", "Esmeralda", "Eureka", "Humboldt", "Lander",
            "Lincoln", "Lyon", "Mineral", "Nye", "Pershing", "Storey", "Washoe", "White Pine"]  # SOS codes 01..17
CODE = {n: f"{i + 1:02d}" for i, n in enumerate(COUNTIES)}
FIELDS = ["sent", "undeliverable", "received", "accepted", "rejected", "signatureCure", "successfullyCured",
          "canceled", "canceledSurr"]
ELECTION_DAYS = {"2026-11-03"}  # VIVID treats these dates as Election Day; all other turnout days are early voting
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"


async def fetch_all(timeout_ms):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
                                    args=["--disable-blink-features=AutomationControlled"])
        try:
            ctx = await b.new_context(user_agent=UA)
            pg = await ctx.new_page()
            await pg.goto(BASE, wait_until="networkidle", timeout=timeout_ms)
            out = {}
            for k, path in FILES.items():
                res = await pg.evaluate("""async (u) => { const r = await fetch(u, {cache: 'no-store'});
                    return [r.status, r.headers.get('last-modified'), await r.text()]; }""", BASE + path + "?t=" + str(int(dt.datetime.now().timestamp())))
                if res[0] != 200:
                    raise RuntimeError(f"{path}: HTTP {res[0]}")
                out[k] = (json.loads(res[2]), res[1])
            return out
        finally:
            await b.close()


def ints(d, where):
    out = [d.get(p, 0) for p in ("DEM", "REP", "OTH")]
    extra = set(d) - {"DEM", "REP", "OTH"}
    if extra:
        raise ValueError(f"{where}: unexpected party codes {sorted(extra)}")
    if not all(isinstance(x, int) and x >= 0 for x in out):
        raise ValueError(f"{where}: non-integer value {d}")
    return out


def pt_from_vivid(s):
    # "11/3/2026 12:17:28 PM -08:00"
    t = dt.datetime.strptime(s, "%m/%d/%Y %I:%M:%S %p %z").astimezone(PT)
    return t


def build(raw, reg):
    mail, mail_lm = raw["mail"]
    inp, inp_lm = raw["inperson"]
    if mail.get("schema") != "prd2-seed" or not isinstance(mail.get("rows"), list):
        raise ValueError("ballot-seed: unexpected schema")
    rows = {r["county"]: r for r in mail["rows"]}
    if sorted(rows) != sorted(COUNTIES):
        raise ValueError(f"ballot-seed: counties {sorted(rows)}")
    days = []
    for d in inp.get("days") or []:
        c = {}
        for r in d["rows"]:
            if r["county"] not in CODE:
                raise ValueError(f"turnout-seed: county {r['county']}")
            v = [r["dem"], r["rep"], r["other"], r["total"]]
            if not all(isinstance(x, int) and x >= 0 for x in v) or v[0] + v[1] + v[2] != v[3]:
                raise ValueError(f"turnout-seed: bad row {r}")
            c[CODE[r["county"]]] = v
        days.append({"d": d["date"], "ed": d["date"] in ELECTION_DAYS, "c": c})
    if not days:
        raise ValueError("turnout-seed: no days")
    lus = []
    counties = []
    for n in COUNTIES:
        r = rows[n]
        m = {f: ints(r["rawByPartyCode"].get(f) or {}, f"{n}.{f}") for f in FIELDS}
        lus.append(pt_from_vivid(r["lastUpdated"]))
        ev = [sum(day["c"].get(CODE[n], [0, 0, 0, 0])[i] for day in days if not day["ed"]) for i in range(4)]
        ed = [sum(day["c"].get(CODE[n], [0, 0, 0, 0])[i] for day in days if day["ed"]) for i in range(4)]
        rg = reg["counties"][n]  # Democratic, Republican, IAP, Libertarian, Non-partisan, Other, Total
        counties.append({"c": CODE[n], "n": n, "fips": r["countyFips"], "lu": f"{lus[-1]:%b %-d, %-I:%M %p} PT",
                         "m": m, "ev": ev, "ed": ed, "reg": [rg[0], rg[1], rg[6] - rg[0] - rg[1], rg[6]]})
    sent = sum(sum(c["m"]["sent"]) for c in counties)
    if sent <= 0:
        raise ValueError("ballot-seed: zero ballots sent")
    newest = max(lus)
    gen_i = dt.datetime.fromisoformat(inp["generatedAt"].replace("Z", "+00:00")).astimezone(PT)
    return {
        "mail": {"asof": f"{newest:%b %-d, %-I:%M %p} PT", "asof_iso": newest.isoformat(), "gen": mail.get("generatedAt"),
                 "file": mail.get("sourceName"), "lm": mail_lm, "url": BASE + FILES["mail"]},
        "inperson": {"asof": f"{gen_i:%b %-d, %-I:%M %p} PT", "gen": inp.get("generatedAt"), "file": inp.get("sourceName"),
                     "lm": inp_lm, "url": BASE + FILES["inperson"]},
        "reg": {"asof": reg["asof"], "month": reg["month"], "title": reg["title"], "src": reg["src"], "page": reg["page"]},
        "dash": BASE, "fields": FIELDS, "counties": counties, "days": days,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--reg", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "registration.json"))
    ap.add_argument("--timeout", type=int, default=90)
    a = ap.parse_args()
    try:
        reg = json.load(open(a.reg))
        raw = asyncio.run(fetch_all(a.timeout * 1000))
        d = build(raw, reg)
    except Exception as e:
        print(f"ballots: FAILED {e!r}"[:600]); sys.exit(2)
    now = dt.datetime.now(PT)
    d = {"u": f"{now:%-I:%M %p} PT, {now:%b %-d}", **d}
    tmp = a.out + ".tmp"
    open(tmp, "w").write(json.dumps(d, separators=(",", ":"), ensure_ascii=False))
    os.replace(tmp, a.out)
    t = [sum(sum(c["m"][f]) for c in d["counties"]) for f in ("sent", "received", "accepted")]
    print(f"ballots: ok mail as of {d['mail']['asof']} sent={t[0]} received={t[1]} accepted={t[2]}; "
          f"in-person as of {d['inperson']['asof']} days={len(d['days'])}")


if __name__ == "__main__":
    main()
