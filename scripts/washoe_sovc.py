"""Parse a Washoe County Registrar 'Statement of Votes Cast' (SOVC) workbook for one contest, by precinct.

Handles both layouts seen in real Washoe files:
  * unofficial (e.g. 2026 primary 6-9-USOVC.xlsx): a precinct label row, then Early Vote / Election Day /
    Mail / Total rows -> the 'Total' row is used;
  * official/final (e.g. WASHOE2026PRIMARYSOVCFINAL.xlsx): one row per precinct, a percent column after
    each candidate.
Fail-safe: any structural surprise raises SovcFormatError; precinct sums must equal the file's own
'County - Total' row (unless privacy-masked cells '****' are present, in which case it is reported).
Numbers are only ever copied from the file, never derived beyond summing for that check."""
import re, datetime

class SovcFormatError(Exception):
    pass

PREC_RE = re.compile(r"^([A-Z][A-Z .\-]*?)\s+(\d{4})$")
CAND_RE = re.compile(r"^(.+?,.+?)\s*\((\w+)\)\s*$", re.S)
MODE_ROWS = {"Early Vote", "Election Day", "Mail", "Total", "Provisional", "Early Voting"}

def _s(v):
    return "" if v is None else str(v).strip()

def _num(v):
    if isinstance(v, bool):
        raise SovcFormatError("boolean cell")
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v.is_integer():
        return int(v)
    t = _s(v)
    if re.fullmatch(r"\*+", t):
        return None  # privacy-masked
    if re.fullmatch(r"\d+", t.replace(",", "")):
        return int(t.replace(",", ""))
    raise SovcFormatError(f"non-numeric vote cell {v!r}")

def parse(path, contest_re=r"^RENO CITY MAYOR\b", require=("Marshall, Kate", "Taylor, Kathleen")):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheets = []
    for name in wb.sheetnames:
        rows = list(wb[name].iter_rows(values_only=True))
        title = next((_s(r[0]) for r in rows[:4] if r and _s(r[0]) and not _s(r[0]).startswith("Page")), "")
        if re.search(contest_re, title, re.I):
            sheets.append((name, title, rows))
    if not sheets:
        raise SovcFormatError("contest sheet not found")
    gen = None
    precincts, county_total, masked = {}, None, False
    cand_names = None
    for name, title, rows in sheets:
        for r in rows[:2]:
            for c in r or ():
                if isinstance(c, datetime.datetime):
                    gen = c.isoformat(timespec="seconds")
        hi = next((i for i, r in enumerate(rows[:15]) if r and _s(r[0]) == "Precinct"), None)
        if hi is None:
            raise SovcFormatError(f"{name}: no 'Precinct' header row")
        hdr = rows[hi]
        cols = {}
        for j, h in enumerate(hdr):
            m = CAND_RE.match(_s(h))
            if m:
                cols[re.sub(r"\s+", " ", m.group(1)).strip()] = j
        if not cols:
            raise SovcFormatError(f"{name}: no candidate columns")
        def col(label):
            j = next((j for j, h in enumerate(hdr) if re.sub(r"\s+", " ", _s(h)) == label), None)
            return j
        jc, jr, jt = col("Times Cast"), col("Registered Voters"), col("Total Votes")
        if jt is None:
            raise SovcFormatError(f"{name}: no 'Total Votes' column")
        if cand_names is None:
            cand_names = list(cols)
        elif list(cols) != cand_names:
            raise SovcFormatError("candidate columns differ between sheets")
        def rec(r):
            nonlocal masked
            vals = {}
            for c, j in cols.items():
                v = _num(r[j] if j < len(r) else None)
                masked |= v is None
                vals[c] = v
            tv = _num(r[jt]); masked |= tv is None
            return {"c": vals, "tv": tv,
                    "cast": _num(r[jc]) if jc is not None and _s(r[jc]) != "" else None,
                    "reg": _num(r[jr]) if jr is not None and _s(r[jr]) != "" else None}
        cur = None
        for r in rows[hi + 1:]:
            if not r or not any(_s(c) for c in r):
                continue
            a = _s(r[0])
            m = PREC_RE.match(a)
            if m:
                pid = m.group(2)
                if pid in precincts:
                    raise SovcFormatError(f"duplicate precinct {pid}")
                cur = pid
                if any(_s(r[j]) != "" for j in cols.values()):  # one-row-per-precinct layout
                    precincts[pid] = rec(r); precincts[pid]["label"] = a; cur = None
                continue
            if a == "Total" and cur is not None:
                precincts[cur] = rec(r); precincts[cur]["label"] = f"precinct {cur}"; cur = None
                continue
            if a == "County - Total":
                county_total = rec(r)
                continue
            if a in MODE_ROWS or a in ("County", "Washoe County", "Washoe County - Total", "Cumulative", "Cumulative - Total") or a.startswith("Page"):
                continue
            raise SovcFormatError(f"{name}: unexpected row label {a!r}")
    for need in require:
        if need not in cand_names:
            raise SovcFormatError(f"candidate {need!r} not in file ({cand_names})")
    if not precincts:
        raise SovcFormatError("no precinct rows")
    if county_total is None:
        raise SovcFormatError("no 'County - Total' row")
    check = "masked cells present; sum check skipped"
    if not masked:
        for c in cand_names + ["tv"]:
            s = sum((p["c"][c] if c != "tv" else p["tv"]) for p in precincts.values())
            t = county_total["c"][c] if c != "tv" else county_total["tv"]
            if s != t:
                raise SovcFormatError(f"precinct sum {s} != county total {t} for {c}")
        check = "precinct sums equal County - Total"
    return {"contest": sheets[0][1].strip(), "generated": gen, "candidates": cand_names,
            "precincts": precincts, "countyTotal": county_total, "masked": masked, "check": check}

if __name__ == "__main__":
    import sys, json
    r = parse(sys.argv[1])
    print(r["contest"], r["generated"], len(r["precincts"]), r["check"])
    print(json.dumps(r["countyTotal"]))
