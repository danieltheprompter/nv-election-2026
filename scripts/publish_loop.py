#!/usr/bin/env python3
"""GitHub Actions data updater for the unofficial NV 2026 results tracker.

Loops for --iterations cycles, one every --interval seconds: runs the vendored scripts/fetch.py (unmodified copy of
the box's fetch.py) in an isolated work dir, then compares its page_data.min.json with the published
data/results.json on origin/main, ignoring the "u" fetch timestamp. Commits + pushes only if the content differs
AND the SOS release sequence is not older than the published one (so a lagging fetcher can never roll the site
back). Stops doing work after 2026-11-13 23:59 PT. Only numbers present in the SOS feed are ever written.
"""
import argparse, datetime as dt, json, os, shutil, subprocess, sys, time
from zoneinfo import ZoneInfo

PT = ZoneInfo("America/Los_Angeles")
STOP_AT = dt.datetime(2026, 11, 13, 23, 59, 59, tzinfo=PT)
DATA_PATH = "data/results.json"


def log(msg):
    print(f"{dt.datetime.now(PT):%Y-%m-%d %H:%M:%S} PT  {msg}", flush=True)


def git(*args, check=False):
    r = subprocess.run(["git", *args], capture_output=True, text=True)
    if check and r.returncode:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip()}")
    return r.returncode, (r.stdout + r.stderr).strip()


def norm(d):
    d = dict(d); d.pop("u", None)
    return json.dumps(d, sort_keys=True, ensure_ascii=False)


def should_publish(new, pub):
    if pub is None:
        return True, "no published copy"
    if norm(new) == norm(pub):
        return False, "identical to published copy (ignoring fetch time)"
    ns, ps = new.get("seq"), pub.get("seq")
    if ns is not None and ps is not None and ns < ps:
        return False, f"fetched SOS release #{ns} is older than published #{ps}; not rolling back"
    return True, f"content differs (published #{ps}, fetched #{ns})"


def try_publish(new_text, new, branch):
    git("fetch", "-q", "origin", branch, check=True)
    git("reset", "-q", "--hard", f"origin/{branch}", check=True)
    try:
        pub = json.load(open(DATA_PATH))
    except Exception:
        pub = None
    ok, why = should_publish(new, pub)
    if not ok:
        log(f"no push: {why}")
        return
    open(DATA_PATH, "w").write(new_text)
    msg = (f"Data: SOS release #{new.get('seq')} ({'results posted' if new.get('posted') else 'no results yet'}; "
           f"fetched {new.get('u')}; Washoe: {new.get('washoe')}) [actions]")
    git("add", DATA_PATH, check=True)
    git("commit", "-q", "-m", msg, check=True)
    rc, out = git("push", "-q", "origin", f"HEAD:{branch}")
    log(("pushed: " if rc == 0 else f"push FAILED (will re-evaluate next cycle): {out[-300:]} :: ") + msg + f" [{why}]")
    if rc == 0 and os.environ.get("GITHUB_REPOSITORY"):
        # pushes made with GITHUB_TOKEN may not start a Pages build by themselves; request one explicitly
        r = subprocess.run(["gh", "api", "-X", "POST", f"repos/{os.environ['GITHUB_REPOSITORY']}/pages/builds"],
                           capture_output=True, text=True)
        log("requested Pages build: " + ("ok" if r.returncode == 0 else (r.stdout + r.stderr).strip()[-200:]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--iterations", type=int, default=26)
    ap.add_argument("--interval", type=int, default=120)
    ap.add_argument("--branch", default="main")
    ap.add_argument("--work", default=os.path.join(os.environ.get("RUNNER_TEMP", "/tmp"), "nvwork"))
    ap.add_argument("--fetch-timeout", type=int, default=300)
    a = ap.parse_args()
    here = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(os.path.join(a.work, "data", "archive"), exist_ok=True)
    shutil.copy(os.path.join(here, "fetch.py"), os.path.join(a.work, "fetch.py"))
    fails = 0
    for i in range(a.iterations):
        if dt.datetime.now(PT) > STOP_AT:
            log("past 2026-11-13 23:59 PT; stopping"); break
        start = time.time()
        args = [sys.executable, os.path.join(a.work, "fetch.py")] + (["--if-changed"] if i % 5 else [])
        try:
            r = subprocess.run(args, cwd=a.work, capture_output=True, text=True, timeout=a.fetch_timeout)
            rc, out = r.returncode, (r.stdout + r.stderr).strip()
        except subprocess.TimeoutExpired:
            rc, out = 124, "fetch timed out"
        log(f"cycle {i + 1}/{a.iterations} fetch rc={rc}: {' | '.join(out.splitlines()[-3:])[-600:]}")
        pd = os.path.join(a.work, "data", "page_data.min.json")
        if rc in (0, 3) and os.path.exists(pd):
            fails = 0
            try:
                txt = open(pd).read()
                try_publish(txt, json.loads(txt), a.branch)
            except Exception as e:
                log(f"publish error: {e!r}")
        else:
            fails += 1
        if i < a.iterations - 1:
            time.sleep(max(5, a.interval - (time.time() - start)))
    if fails and fails == a.iterations:
        log("every fetch in this run failed"); sys.exit(1)


if __name__ == "__main__":
    main()
