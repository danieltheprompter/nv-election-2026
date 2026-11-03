#!/usr/bin/env python3
"""Fetch Nevada 2026 General Election results (unofficial) from the NV SOS
election-night site (silverstateelection.nv.gov) and snapshot the Washoe County
Registrar results page. Writes data/latest.json (+ timestamped archive) in a
compact shape the "Nevada 2026 Election Results" Page embeds as DATA.

Usage:  /workspace/nvelection/.venv/bin/python /workspace/nvelection/fetch.py [--if-changed] [--all]
  --if-changed  compare the SOS release (releaseId/sequence/generatedAtUtc) and the Washoe page
                status with data/state.json; if nothing changed, exit 3 without fetching contests
                or rewriting any output. Otherwise do a full run and exit 0.
  --all         also download every contest's county file into data/raw/ (372 contests)
Exit codes: 0 = new data written (edit the Page), 3 = unchanged (skip the Page edit), 1 = error.
Every full run copies the previous data/page_data.min.json to data/page_data.prev.json first.

The SOS site sits behind Imperva/Incapsula (JS challenge), so plain curl/requests
gets an empty challenge page. We open the site once in headless Chrome
(Playwright, system /usr/bin/google-chrome) and reuse that browser context's
cookies for the JSON requests.
"""
import asyncio, json, os, re, sys, datetime as dt
from zoneinfo import ZoneInfo
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
SITE = "https://silverstateelection.nv.gov/"
WASHOE = "https://electionresults.washoecounty.gov/"
PT = ZoneInfo("America/Los_Angeles")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

# contests the Page shows: (section, exact SOS contest name, short key, short label)
WANT = [
    ("statewide", "Governor", "gov", "Governor"),
    ("statewide", "Lieutenant Governor", "ltgov", "Lt. Governor"),
    ("statewide", "Attorney General", "ag", "Attorney General"),
    ("statewide", "Secretary of State", "sos", "Secretary of State"),
    ("statewide", "State Treasurer", "treas", "Treasurer"),
    ("statewide", "State Controller", "ctrl", "Controller"),
    ("house", "Representative In Congress, District 1", "nv1", "NV-1"),
    ("house", "Representative In Congress, District 2", "nv2", "NV-2"),
    ("house", "Representative In Congress, District 3", "nv3", "NV-3"),
    ("house", "Representative In Congress, District 4", "nv4", "NV-4"),
    ("question", "Statewide Ballot Question No. 6", "q6", "Question 6"),
    ("question", "Statewide Ballot Question No. 7", "q7", "Question 7"),
    ("reno", "Mayor, City Of Reno", "renomayor", "Reno Mayor"),
    ("reno", "City of Reno, Councilmember, Ward 2", "renow2", "Council Ward 2"),
    ("reno", "City of Reno, Councilmember, Ward 4", "renow4", "Council Ward 4"),
    ("reno", "City of Reno, Attorney", "renoatty", "City Attorney"),
    ("reno", "City of Reno, Municipal Court Judge, Dept. 1", "renojudge", "Municipal Court Dept. 1"),
    ("sparks", "Mayor, City Of Sparks", "sparksmayor", "Sparks Mayor"),
    ("sparks", "City Of Sparks, Council Member, Ward 2", "sparksw2", "Sparks Council Ward 2"),
]
# Washoe-only county contests are picked up automatically (County Results group, countyCodes == ["16"])


def to_pt(iso):
    if not iso:
        return None
    s = re.sub(r"(\.\d{6})\d+", r"\1", iso.replace("Z", "+00:00"))
    return dt.datetime.fromisoformat(s).astimezone(PT)


STATE = os.path.join(DATA, "state.json")
UNCHANGED = 3


async def washoe_status(ctx):
    washoe = {"url": WASHOE, "status": "unreachable"}
    try:
        r = await ctx.request.get(WASHOE)
        html = await r.text()
        open(os.path.join(DATA, "washoe_results.html"), "w").write(html)
        if "will be displayed here after the election" in html:
            washoe["status"] = "placeholder (no results posted yet)"
        else:
            washoe["status"] = "content changed - inspect data/washoe_results.html"
            washoe["links"] = sorted(set(re.findall(r'href="([^"#][^"]*)"', html)))[:200]
    except Exception as e:  # noqa
        washoe["error"] = str(e)
    return washoe


async def main(all_contests=False, if_changed=False):
    os.makedirs(os.path.join(DATA, "archive"), exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
                                    args=["--disable-blink-features=AutomationControlled"])
        ctx = await b.new_context(user_agent=UA)
        pg = await ctx.new_page()
        await pg.goto(SITE, wait_until="networkidle", timeout=90000)

        async def get_json(url):
            for _ in range(3):
                r = await ctx.request.get(url)
                if r.ok:
                    try:
                        return json.loads(await r.text())
                    except json.JSONDecodeError:
                        pass  # challenge page; reload and retry
                await pg.goto(SITE, wait_until="networkidle", timeout=90000)
            raise RuntimeError(f"failed to fetch {url}")

        cfg = await get_json(SITE + "results-config.json")
        man_url = SITE + cfg["manifestUrl"]
        base = man_url.rsplit("/", 1)[0] + "/"
        man = await get_json(man_url)
        washoe = await washoe_status(ctx)
        sig = {"manifestUrl": cfg["manifestUrl"], "releaseId": man.get("releaseId"),
               "sequence": man.get("sequence"), "generatedAtUtc": man.get("generatedAtUtc"),
               "washoe": washoe["status"]}
        old = json.load(open(STATE)) if os.path.exists(STATE) else None
        changed = old is None or any(old.get(k) != v for k, v in sig.items())
        if if_changed and not changed:
            await b.close()
            print(f"UNCHANGED: SOS seq={sig['sequence']} release={sig['releaseId']} washoe={sig['washoe']}; "
                  f"last data write {old.get('writtenAt')}")
            return UNCHANGED
        ov = await get_json(base + man["overview"]["path"])
        turnout = await get_json(base + man["turnout"]["path"])
        paths = {c["contestId"]: c["results"]["path"] for c in man["contests"]}

        groups = {g["id"]: g["label"] for g in ov["groups"]}
        parties = {pp["id"]: pp["abbreviation"] for pp in ov["parties"]}
        cname = {c["code"]: c["name"] for c in ov["counties"]}
        by_name = {c["name"]: c for c in ov["contests"]}

        sel = []
        for sec, name, key, label in WANT:
            if name in by_name:
                sel.append((sec, by_name[name], key, label))
            else:
                print("WARN contest not found:", name, file=sys.stderr)
        for c in ov["contests"]:
            if groups.get(c["groupId"]) == "County Results" and c["scope"]["countyCodes"] == ["16"]:
                key = "w_" + re.sub(r"[^a-z0-9]+", "_", c["name"].lower()).strip("_")
                sel.append(("washoe", c, key, c["name"]))

        races = []
        posted = False
        for sec, c, key, label in sel:
            t = c["totals"]
            tv = {x["choiceId"]: x["votes"] for x in t["choices"]}
            total = t.get("totalVotes")
            choices = []
            for ch in sorted(c["choices"], key=lambda x: x["ballotOrder"]):
                v = tv.get(ch["id"])
                party = parties.get((ch.get("candidate") or {}).get("partyId"), "")
                choices.append({"id": ch["id"], "label": ch["label"], "party": party,
                                "inc": bool((ch.get("candidate") or {}).get("incumbent")),
                                "votes": v,
                                "pct": round(100 * v / total, 2) if (v is not None and total) else None})
                if v:
                    posted = True
            race = {"key": key, "section": sec, "label": label, "name": c["name"], "kind": c["kind"],
                    "scope": c["scope"]["label"], "voteFor": c["voteFor"],
                    "question": (c.get("question") or {}).get("summary"),
                    "counties": c["scope"]["countyCodes"],
                    "expected": t["expectedCountyCount"], "received": t["receivedCountyCount"],
                    "complete": t["completeCountyCount"], "total": total,
                    "lead": t.get("lead", {}).get("status"), "choices": choices}
            # county breakdown for multi-county races
            if sec in ("statewide", "house", "question"):
                cr = await get_json(base + paths[c["id"]])
                if all_contests is False:
                    pass
                order = [ch["id"] for ch in choices]
                rows = []
                for cc in cr["counties"]:
                    vm = {x["choiceId"]: x["votes"] for x in cc["choices"]}
                    vals = [vm.get(i) for i in order]
                    rows.append({"code": cc["countyCode"], "county": cname.get(cc["countyCode"]),
                                 "votes": vals,
                                 "total": sum(v for v in vals if v) if any(v is not None for v in vals) else None,
                                 "lead": (cc.get("lead") or {}).get("status")})
                race["byCounty"] = rows
            races.append(race)

        if all_contests:
            rawdir = os.path.join(DATA, "raw"); os.makedirs(rawdir, exist_ok=True)
            for c in ov["contests"]:
                j = await get_json(base + paths[c["id"]])
                json.dump(j, open(os.path.join(rawdir, c["id"] + ".json"), "w"))
            json.dump(ov, open(os.path.join(rawdir, "overview.json"), "w"))

        await b.close()

    now = dt.datetime.now(PT)
    gen = to_pt(man.get("generatedAtUtc"))
    out = {
        "fetchedAt": now.strftime("%Y-%m-%d %H:%M PT"),
        "fetchedAtShort": now.strftime("%-I:%M %p PT, %b %-d"),
        "sosGeneratedAt": gen.strftime("%Y-%m-%d %H:%M PT") if gen else None,
        "sosGeneratedShort": gen.strftime("%-I:%M %p PT, %b %-d") if gen else None,
        "sosSequence": man.get("sequence"), "resultsStatus": ov["election"]["resultsStatus"],
        "resultsPosted": posted,
        "counties": [{"code": c["countyCode"], "county": cname.get(c["countyCode"]),
                      "registered": c.get("activeRegisteredVoters"), "turnout": c.get("totalTurnout"),
                      "methods": c.get("methods")} for c in turnout["counties"]],
        "races": races,
        "washoe": washoe,
        "sources": {"sos": SITE, "manifest": man_url, "washoe": WASHOE},
    }
    p = os.path.join(DATA, "latest.json")
    json.dump(out, open(p, "w"), indent=1)
    json.dump(out, open(os.path.join(DATA, "archive", now.strftime("%Y%m%dT%H%M") + ".json"), "w"))
    slim = page_data(out)
    pd = os.path.join(DATA, "page_data.min.json")
    if os.path.exists(pd):
        os.replace(pd, os.path.join(DATA, "page_data.prev.json"))
    open(os.path.join(DATA, "page_data.min.json"), "w").write(json.dumps(slim, separators=(",", ":"), ensure_ascii=False))
    print(f"wrote {p}: {len(races)} races, resultsPosted={posted}, SOS seq={man.get('sequence')} "
          f"generated {out['sosGeneratedAt']}, washoe={washoe['status']}")
    sig["writtenAt"] = out["fetchedAt"]
    json.dump(sig, open(STATE, "w"), indent=1)
    print("CHANGED" if changed else "SAME RELEASE (full run forced)", "- edit the Page with data/page_data.min.json")
    return 0


def page_data(out):
    """Compact shape embedded in the Page as `const DATA = ...` (see README).
    race: k key, s section, l label, n official name, ex/rc/cp expected/received/complete counties,
          t total votes, vf vote-for, c [[candidate, party, votes]], q question text,
          bc by-county [[countyCode, votes-array-or-null, leadStatus]] (N = NoResults, M = Masked)."""
    short = {"NoResults": "N", "Masked": "M"}
    races = []
    for r in out["races"]:
        d = {"k": r["key"], "s": r["section"], "l": r["label"], "ex": r["expected"],
             "rc": r["received"], "cp": r["complete"], "t": r["total"], "vf": r["voteFor"],
             "c": [[c["label"], c["party"], c["votes"]] for c in r["choices"]]}
        if r["name"] != r["label"]:
            d["n"] = r["name"]
        if r["section"] == "question" and r.get("question"):
            d["q"] = r["question"]
        if r.get("byCounty"):
            d["bc"] = [[x["code"], x["votes"] if any(v is not None for v in x["votes"]) else None,
                        short.get(x["lead"], x["lead"])] for x in r["byCounty"]]
        races.append(d)
    return {"u": out["fetchedAtShort"], "g": out["sosGeneratedShort"], "seq": out["sosSequence"],
            "posted": out["resultsPosted"], "washoe": out["washoe"]["status"],
            "counties": [[c["code"], c["county"], c["registered"], c["turnout"]] for c in out["counties"]],
            "races": races}


if __name__ == "__main__":
    try:
        rc = asyncio.run(main("--all" in sys.argv, "--if-changed" in sys.argv))
    except Exception as e:  # noqa
        print("ERROR:", e, file=sys.stderr)
        rc = 1
    sys.exit(rc)
