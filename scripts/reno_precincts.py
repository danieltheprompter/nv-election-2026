#!/usr/bin/env python3
"""Reno mayor results by precinct, from the Washoe County Registrar's Statement of Votes Cast (SOVC) workbook.

Official source: https://www.washoecounty.gov/voters/results/2026data.php ("2026 Election Data"). In the June 2026
primary the Registrar linked an *Unofficial* SOVC xlsx there (datafiles/6-9-USOVC.xlsx, generated 12:45 AM the
night after election day) and later the *Official* SOVC at canvass. Election-night totals on the SOS feed are not
broken down by precinct, so the precinct map stays in 'awaiting' until such a file appears.

build(state_dir, washoe_snapshot=None) -> dict written to data/reno_precincts.json. Fail-safe rules:
  * only .xlsx links on the 2026 data page (or the results dashboard snapshot) whose file name or link text
    names a Statement of Votes Cast are considered; primary-election files are excluded;
  * the workbook must parse cleanly (washoe_sovc.parse): a 'RENO CITY MAYOR' contest whose candidate columns
    are exactly Marshall, Kate and Taylor, Kathleen, precinct sums equal to the file's own County - Total row,
    and a generation timestamp on/after 2026-11-03;
  * otherwise status stays 'awaiting' (with a note if a file was found but rejected). Numbers are copied from
    the file only.
"""
import datetime as dt, hashlib, html, json, os, re, sys, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import washoe_sovc

DATA_PAGE = "https://www.washoecounty.gov/voters/results/2026data.php"
DASH = "https://electionresults.washoecounty.gov/"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
WANT = ["Marshall, Kate", "Taylor, Kathleen"]
NOT_BEFORE = "2026-11-03"
PRIMARY_FILES = {"6-9-USOVC.xlsx", "WASHOE2026PRIMARYSOVCFINAL.xlsx"}


def _get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), dict(r.headers)


def find_links(page_html, base):
    out = []
    for m in re.finditer(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', page_html, re.S | re.I):
        href, text = m.group(1), re.sub(r"<[^>]+>|\s+", " ", html.unescape(m.group(2))).strip()
        url = urllib.parse.urljoin(base, href.strip())
        fname = urllib.parse.unquote(url.rsplit("/", 1)[-1])
        if not fname.lower().endswith(".xlsx"):
            continue
        if not (re.search(r"sovc", fname, re.I) or re.search(r"statement of votes", text, re.I)):
            continue
        if fname in PRIMARY_FILES or re.search(r"primary", fname + " " + text, re.I):
            continue
        out.append({"url": url, "file": fname, "text": text})
    seen, uniq = set(), []
    for l in out:
        if l["url"] not in seen:
            seen.add(l["url"]); uniq.append(l)
    return uniq


def awaiting(note):
    return {"status": "awaiting", "note": note, "src": DATA_PAGE}


def build(state_dir, washoe_snapshot=None, log=print):
    os.makedirs(state_dir, exist_ok=True)
    links = []
    try:
        body, _ = _get(DATA_PAGE)
        links += find_links(body.decode("utf-8", "replace"), DATA_PAGE)
    except Exception as e:
        log(f"precincts: could not read {DATA_PAGE}: {e!r}")
        return None  # unknown -> caller keeps whatever is published
    if washoe_snapshot and os.path.exists(washoe_snapshot):
        links += [l for l in find_links(open(washoe_snapshot, errors="replace").read(), DASH)
                  if l["url"] not in {x["url"] for x in links}]
    if not links:
        return awaiting("The Washoe County Registrar has not posted a precinct-level Statement of Votes Cast "
                        "for this election yet.")
    best, rejected = None, []
    for l in links:
        path = os.path.join(state_dir, hashlib.sha1(l["url"].encode()).hexdigest()[:12] + ".xlsx")
        try:
            body, hdr = _get(l["url"], timeout=120)
            open(path, "wb").write(body)
            r = washoe_sovc.parse(path, require=WANT)
            if sorted(r["candidates"]) != sorted(WANT):
                raise washoe_sovc.SovcFormatError(f"candidate set {r['candidates']} is not exactly {WANT}")
            if not r["generated"] or r["generated"][:10] < NOT_BEFORE:
                raise washoe_sovc.SovcFormatError(f"file generated {r['generated']}, before {NOT_BEFORE}")
            r["link"] = l
            if best is None or r["generated"] > best["generated"]:
                best = r
        except Exception as e:
            rejected.append(f"{l['file']}: {e}")
            log(f"precincts: rejected {l['url']}: {e!r}")
    if best is None:
        return awaiting("A Statement of Votes Cast file was posted but could not be read with confidence, so no "
                        "precinct results are shown. (" + "; ".join(rejected)[:300] + ")")
    def row(p):
        return [p["c"][WANT[0]], p["c"][WANT[1]], p["tv"], p.get("cast"), p.get("reg")]
    official = bool(re.search(r"\bofficial\b", best["link"]["text"], re.I)) and not re.search(
        r"unofficial", best["link"]["text"] + best["link"]["file"], re.I) and not re.search(r"USOVC", best["link"]["file"])
    return {"status": "ok", "src": best["link"]["url"], "label": best["link"]["text"], "gen": best["generated"],
            "official": official, "contest": best["contest"], "cands": WANT,
            "p": {k: row(v) for k, v in sorted(best["precincts"].items())}, "tot": row(best["countyTotal"]),
            "masked": best["masked"], "check": best["check"]}


def should_publish(new, pub):
    """Same spirit as results.json: ignore 'u', never replace real data with 'awaiting' or with an older file."""
    if new is None:
        return False, "data page unreachable; keeping published copy"
    n = lambda d: json.dumps({k: v for k, v in d.items() if k != "u"}, sort_keys=True)
    if pub is not None and n(new) == n(pub):
        return False, "identical to published precinct file"
    if pub is not None and pub.get("status") == "ok":
        if new.get("status") != "ok":
            return False, "published precinct data is valid; not replacing it with " + new.get("status", "?")
        if new.get("gen", "") < pub.get("gen", ""):
            return False, f"fetched SOVC generated {new.get('gen')} is older than published {pub.get('gen')}"
    return True, "precinct file changed"


if __name__ == "__main__":
    r = build(sys.argv[1] if len(sys.argv) > 1 else "/tmp/precinct_state",
              sys.argv[2] if len(sys.argv) > 2 else None)
    print(json.dumps(r)[:600])
