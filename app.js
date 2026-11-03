/* Nevada 2026 Election Results (unofficial tracker). Plain JS, no dependencies.
   Renders only what the data file (a mirror of the NV SOS feed) contains; never estimates. */
(function () {
  "use strict";
  // Data sources, tried in order. Measured 2026-11-03: the GitHub Pages copy is live ~30-90 s after a push
  // (each Pages deploy purges its CDN); raw.githubusercontent.com ignores query strings and lagged ~3-5 min,
  // so it is only a fallback.
  var DATA_URLS = (window.NV_DATA_URLS || [
    "data/results.json",
    "https://raw.githubusercontent.com/danieltheprompter/nv-election-2026/main/data/results.json"
  ]);
  var POLL_MS = 60000;
  var PT = "America/Los_Angeles";
  // Color-blind-friendly (Okabe-Ito based). Candidates are never identified by color alone: names are always shown.
  var PALETTE = ["#e69f00", "#009e73", "#cc79a7", "#56b4e9", "#8c6d1f", "#5d5d5d", "#d55e00", "#0072b2"];
  var PARTY = { DEM: "#1f5fa8", REP: "#c8372d" };
  var PARTY_NAME = { DEM: "Democratic", REP: "Republican", IAP: "Independent American", LPN: "Libertarian", NPP: "No political party", NP: "Nonpartisan" };
  var YES = "#5e3c99", NO = "#e08214", NONE_OF = "#9a9a9a";
  var GROUPS = [["statewide", "Statewide offices"], ["house", "U.S. House"], ["question", "Questions 6 & 7"]];
  // Short plain-language descriptions of offices/districts (no numbers). Ballot questions use the official text from the feed.
  var DESC = {
    gov: "Leads the state's executive branch", ltgov: "Presides over the state Senate; next in line after the governor",
    ag: "The state's top lawyer and law-enforcement officer", sos: "Oversees elections and business filings",
    treas: "Manages the state's money and investments", ctrl: "The state's chief accountant; pays the bills",
    nv1: "Central Las Vegas area", nv2: "Northern Nevada, including Reno and Sparks", nv3: "Southern Las Vegas Valley, including Henderson",
    nv4: "North Las Vegas and central Nevada"
  };
  var WARD_RACE = { "2": "renow2", "4": "renow4" };
  var SMALL = { "01": 1, "04": 1, "15": 1 };

  var P_URLS = (window.NV_PRECINCT_URLS || [
    "data/reno_precincts.json",
    "https://raw.githubusercontent.com/danieltheprompter/nv-election-2026/main/data/reno_precincts.json"
  ]);
  var D = null, GEO = null, lastText = null, lastOkTs = null, lastErr = null, P = null, lastPText = null;
  var ui = { group: "statewide", race: "gov", county: "16" };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(v) { return v == null ? "—" : Number(v).toLocaleString("en-US"); }
  function pct(v, t) { return (v == null || !t) ? "—" : (100 * v / t).toFixed(1) + "%"; }
  function person(l) {
    if (l === "None of These Candidates") return "None of these candidates";
    var p = l.split(", "); if (p.length < 2) return l;
    return p[p.length - 1] + " " + p[0] + (p.length > 2 ? " " + p.slice(1, -1).join(" ") : "");
  }
  function partyName(p) { return p ? (PARTY_NAME[p] || p) : ""; }
  function shortQ(q) { q = String(q || ""); return q.length > 90 ? q.slice(0, q.lastIndexOf(" ", 86)) + "…" : q; }
  function qBlock(r) { return r.q ? "<div class=q><strong>Official ballot question:</strong> " + esc(r.q) + "</div>" : ""; }
  function nowPT() { return new Date().toLocaleTimeString("en-US", { timeZone: PT, hour: "numeric", minute: "2-digit", second: "2-digit" }) + " PT"; }
  function hasVotes(r) { return !!r.t && r.t > 0; }
  function countyName(code) { for (var i = 0; i < D.counties.length; i++) if (D.counties[i][0] === code) return D.counties[i][1]; return code; }

  // colour for choice i of race r
  function colors(r) {
    var out = [], k = 0;
    r.c.forEach(function (c) {
      var lab = c[0], party = c[1];
      if (lab === "Yes") out.push(YES);
      else if (lab === "No") out.push(NO);
      else if (lab === "None of These Candidates") out.push(NONE_OF);
      else if (PARTY[party]) out.push(PARTY[party]);
      else out.push(PALETTE[k++ % PALETTE.length]);
    });
    return out;
  }
  function leadOf(v) {
    if (!v) return null;
    var tot = 0, a = -1, b = -1;
    v.forEach(function (x, i) { x = x || 0; tot += x; if (a < 0 || x > (v[a] || 0)) { b = a; a = i; } else if (b < 0 || x > (v[b] || 0)) b = i; });
    if (!tot) return null;
    var tie = b >= 0 && (v[a] || 0) === (v[b] || 0);
    return { i: a, tie: tie, total: tot, margin: b < 0 ? 100 : 100 * ((v[a] || 0) - (v[b] || 0)) / tot };
  }
  function opacity(m) { return 0.35 + 0.65 * Math.min(m / 30, 1); }

  // ---------- rendering ----------
  function reportingText(r) { return r.rc + " of " + r.ex + (r.ex === 1 ? " county" : " counties") + " reporting · " + r.cp + " complete"; }

  function raceTable(r, opts) {
    opts = opts || {};
    var col = colors(r), votes = hasVotes(r);
    var idx = r.c.map(function (_, i) { return i; });
    if (votes) idx.sort(function (a, b) { return (r.c[b][2] || 0) - (r.c[a][2] || 0); });
    var showParty = r.c.some(function (c) { return c[1]; });
    var lead = votes ? leadOf(r.c.map(function (c) { return c[2]; })) : null;
    var h = "<table><caption class=sr>" + esc(r.n || r.l) + "</caption><thead><tr><th scope=col>" + (r.s === "question" || /Question/.test(r.l) ? "Choice" : "Candidate") + "</th>";
    if (votes) h += "<th class=num>Votes</th><th class=num>Share</th>";
    h += "</tr></thead><tbody>";
    idx.forEach(function (i, rank) {
      var c = r.c[i];
      var isLead = lead && !lead.tie && i === lead.i && r.vf === 1;
      h += "<tr" + (isLead ? " class=lead" : "") + "><td><span class=sw aria-hidden=true style='background:" + col[i] + "'></span>" + esc(person(c[0])) + (isLead ? " <span class=pill>Leading</span>" : "");
      if (showParty && c[1]) h += "<span class=party>" + esc(partyName(c[1])) + "</span>";
      if (votes) h += "<div class=bar aria-hidden=true><i style='width:" + (r.t ? (100 * (c[2] || 0) / r.t) : 0).toFixed(2) + "%;background:" + col[i] + "'></i></div>";
      h += "</td>";
      if (votes) h += "<td class=num>" + num(c[2]) + "</td><td class=num>" + pct(c[2], r.t) + "</td>";
      h += "</tr>";
    });
    h += "</tbody>";
    if (votes) h += "<tfoot><tr><td>Total votes</td><td class=num>" + num(r.t) + "</td><td></td></tr></tfoot>";
    h += "</table>";
    var meta = votes ? reportingText(r) + (lead && lead.tie ? " · tied" : "")
      : (D.posted ? "No votes reported in this race yet · " + reportingText(r) : "No results yet — votes will appear after polls close at 7 PM PT");
    if (r.vf > 1) meta += " · vote for " + r.vf;
    return (opts.noMeta ? "" : "<p class=meta>" + esc(meta) + "</p>") + h;
  }

  function raceCard(r, cls) {
    var name = r.n && r.n !== r.l ? "<span class=pill>" + esc(r.n) + "</span>" : "";
    return "<div class='card " + (cls || "") + "'><h3>" + esc(r.l) + name + "</h3>" + qBlock(r) + raceTable(r) + "</div>";
  }

  function agoText() {
    if (!lastOkTs) return "";
    var sec = Math.max(0, Math.round((Date.now() - lastOkTs) / 1000));
    return sec < 60 ? sec + " sec ago" : Math.floor(sec / 60) + " min ago";
  }
  function renderStatus() {
    var el = $("status");
    if (!D) { el.className = "status err"; el.innerHTML = "<span class=dot aria-hidden=true></span>Could not load the results yet" + (lastErr ? " (" + esc(lastErr) + ")" : "") + ". Trying again every minute."; return; }
    var s = "<span class=dot aria-hidden=true></span><strong>Unofficial.</strong> Last updated " + esc(D.u) + ", SOS release #" + esc(D.seq) + ". " +
      "<span class=ago>Last checked <span id=ago>" + esc(agoText()) + "</span>" + (lastErr ? " (latest check failed; retrying)" : "") + ".</span>";
    el.className = "status " + (lastErr ? "err" : "ok"); el.innerHTML = s;
  }
  function tickAgo() { var a = $("ago"); if (a) a.textContent = agoText(); }

  function countiesReporting() {
    var g = D.races.filter(function (r) { return r.k === "gov"; })[0] || D.races.filter(function (r) { return r.ex === 17; })[0];
    return g ? { rc: g.rc, cp: g.cp, ex: g.ex } : null;
  }
  function renderBanner() {
    var b = $("banner");
    if (!D.posted) {
      b.innerHTML = "<div class='banner pre'><span class=big>Polls close at 7 PM PT.</span>Results will appear here automatically — no need to refresh." +
        "<p class=meta style='margin:8px 0 0'>The Nevada Secretary of State has not posted any vote counts yet (latest feed: release #" + esc(D.seq) + ", published " + esc(D.g || "—") + "). Candidates are listed below.</p></div>";
    } else {
      var c = countiesReporting();
      var w = c && c.ex ? (100 * c.rc / c.ex).toFixed(1) : 0;
      b.innerHTML = "<div class='banner live'><span class=big>" + (c ? esc(c.rc) + " of " + esc(c.ex) + " counties reporting" : "Counting in progress") + "</span>" +
        (c ? "<div class=progress role=img aria-label='" + esc(c.rc) + " of " + esc(c.ex) + " counties reporting'><i style='width:" + w + "%'></i></div>" : "") +
        "Unofficial results — counts change as counties count more ballots. This page updates by itself; no need to refresh." +
        (c && c.cp ? " " + esc(c.cp) + " of " + esc(c.ex) + " counties marked complete." : "") + "</div>";
    }
  }

  function raceStatusLine(r) {
    if (!hasVotes(r)) return D.posted ? "No votes reported yet" : "Awaiting results";
    var L = leadOf(r.c.map(function (c) { return c[2]; }));
    if (!L) return "Awaiting results";
    return (L.tie ? "Tied" : person(r.c[L.i][0]) + " leads, " + pct(r.c[L.i][2], r.t)) + " · " + r.rc + "/" + r.ex + " counties";
  }
  function renderTabs() {
    var g = $("groupTabs");
    g.innerHTML = GROUPS.map(function (x) { return "<button type=button data-g='" + x[0] + "' aria-pressed=" + (ui.group === x[0]) + ">" + x[1] + "</button>"; }).join("");
    var races = D.races.filter(function (r) { return r.s === ui.group; });
    if (!races.some(function (r) { return r.k === ui.race; }) && races.length) ui.race = races[0].k;
    $("raceTabs").innerHTML = races.map(function (r) {
      var d = r.q ? shortQ(r.q) : (DESC[r.k] || r.n || "");
      var t = r.s === "house" ? "U.S. House " + r.l.replace("NV-", "District ") : (r.n && r.s === "statewide" ? r.n : r.l);
      return "<button type=button data-r='" + r.k + "' aria-pressed=" + (ui.race === r.k) + "><span class=t>" + esc(t) + "</span>" +
        (d ? "<span class=d>" + esc(d) + "</span>" : "") + "<span class=s>" + esc(raceStatusLine(r)) + "</span></button>";
    }).join("");
  }

  function currentRace() { for (var i = 0; i < D.races.length; i++) if (D.races[i].k === ui.race) return D.races[i]; return null; }

  function renderRace() {
    var r = currentRace(); if (!r) return;
    var title = r.s === "house" ? "U.S. House, " + r.l.replace("NV-", "District ") : (r.n || r.l);
    $("raceHead").innerHTML = "<h3>" + esc(title) + "</h3>" + (DESC[r.k] ? "<p class=meta>" + esc(DESC[r.k]) + "</p>" : "") + qBlock(r);
    $("raceTotals").innerHTML = "<h4>" + (r.ex === 17 ? "Statewide totals" : "District totals (" + r.ex + (r.ex === 1 ? " county" : " counties") + ")") + "</h4>" + raceTable(r);
    var col = colors(r);
    $("legend").innerHTML = legendHTML(r.c.map(function (c, i) { return [col[i], person(c[0])]; }), "Not in this contest");
    renderMap(r, col);
    renderCountyTable(r);
  }

  function legendHTML(items, outsideLabel) {
    return items.map(function (x) { return "<span><span class=sw aria-hidden=true style='background:" + x[0] + "'></span>" + esc(x[1]) + "</span>"; }).join("") +
      "<span><span class=sw aria-hidden=true style='background:var(--nores);border:1px solid var(--line)'></span>Awaiting results</span>" +
      "<span><span class=sw aria-hidden=true style='background:var(--bg);border:1px dashed var(--mut)'></span>" + esc(outsideLabel) + "</span>" +
      (D.posted ? "<span class=note>Lighter shade = closer race</span>" : "");
  }
  function renderMap(r, col) {
    var bc = {}; (r.bc || []).forEach(function (row) { bc[row[0]] = row; });
    var h = "<svg viewBox='-4 -4 308 461' role=img aria-label='Map of Nevada counties colored by leader in " + esc(r.l) + "'>";
    Object.keys(GEO.counties).forEach(function (code) {
      var g = GEO.counties[code], row = bc[code], fill = "var(--bg)", op = 1, title = countyName(code) + ": not in this contest";
      if (row) {
        var L = leadOf(row[1]);
        if (L && !L.tie) { fill = col[L.i]; op = opacity(L.margin); title = countyName(code) + ": " + person(r.c[L.i][0]) + " leads (" + pct(row[1][L.i], L.total) + ")"; }
        else if (L && L.tie) { fill = "#718096"; title = countyName(code) + ": tied"; }
        else { fill = "var(--nores)"; title = countyName(code) + ": " + (row[2] === "M" ? "masked by SOS" : "awaiting results"); }
      }
      h += "<path data-c='" + code + "' d='" + g.d + "' fill='" + fill + "' fill-opacity='" + op.toFixed(2) + "' stroke='var(--card)' stroke-width='1' stroke-linejoin='round'" +
        (ui.county === code ? " class=sel" : "") + "><title>" + esc(title) + "</title></path>";
    });
    Object.keys(GEO.counties).forEach(function (code) {
      if (SMALL[code]) return; var g = GEO.counties[code];
      h += "<text class=maplabel x='" + g.x + "' y='" + g.y + "' text-anchor=middle>" + esc(countyName(code)) + "</text>";
    });
    h += "</svg>";
    $("map").innerHTML = h;
    var sel = bc[ui.county];
    var note;
    if (!sel) note = "Tap a county to see its numbers. " + esc(countyName(ui.county)) + " is not part of this contest.";
    else {
      var L = leadOf(sel[1]);
      note = "<strong>" + esc(countyName(ui.county)) + ":</strong> " + (L ? (L.tie ? "tied" : esc(person(r.c[L.i][0])) + " leads with " + pct(sel[1][L.i], L.total) + " of " + num(L.total) + " votes")
        : (sel[2] === "M" ? "results masked by SOS" : "awaiting results")) + ". Tap another county to switch.";
    }
    $("mapNote").innerHTML = note;
  }

  function renderCountyTable(r) {
    $("countyHead").textContent = "Show results by county (" + (r.bc || []).length + (r.bc && r.bc.length === 1 ? " county" : " counties") + ")";
    var rows = r.bc || [], col = colors(r), anyVotes = rows.some(function (x) { return x[1] && x[1].some(function (v) { return v; }); });
    var h = "<table><thead><tr><th>County</th>";
    if (anyVotes) r.c.forEach(function (c, i) { h += "<th class=num><span class=sw style='background:" + col[i] + "'></span>" + esc(person(c[0])) + "</th>"; });
    h += (anyVotes ? "<th class=num>Total</th><th>Leader</th>" : "") + "<th>Status</th></tr></thead><tbody>";
    rows.forEach(function (row) {
      var v = row[1], L = leadOf(v);
      h += "<tr" + (row[0] === ui.county ? " class=lead" : "") + "><td>" + esc(countyName(row[0])) + "</td>";
      if (anyVotes) {
        r.c.forEach(function (_, i) { h += "<td class=num>" + (v && v[i] != null ? num(v[i]) + "<br><span class=note>" + pct(v[i], L ? L.total : 0) + "</span>" : "—") + "</td>"; });
        h += "<td class=num>" + (L ? num(L.total) : "—") + "</td><td>" + (L ? (L.tie ? "Tied" : esc(person(r.c[L.i][0]))) : "—") + "</td>";
      }
      var st = row[2] === "N" ? "Awaiting results" : row[2] === "M" ? "Masked by SOS" : (L ? "Reporting" : (row[2] || "—"));
      h += "<td>" + esc(st) + "</td></tr>";
    });
    h += "</tbody></table>";
    if (!anyVotes) h = "<p class=meta>" + (D.posted ? "No county has reported votes in this contest yet." : "No results posted yet; county numbers will appear after polls close at 7 PM PT.") + " Counties in this contest: " + rows.length + ".</p>" + h;
    $("countyTable").innerHTML = h;
  }

  function renderGlance() {
    var rs = D.races.filter(function (r) { return r.s === "statewide" || r.s === "house" || r.s === "question"; });
    var h = "<table><thead><tr><th scope=col>Race</th>" + (D.posted ? "<th scope=col>Leader</th><th scope=col class=num>Share</th><th scope=col class=num>Votes</th><th scope=col>Reporting</th>" : "<th scope=col>On the ballot</th>") + "</tr></thead><tbody>";
    rs.forEach(function (r) {
      h += "<tr><td><a href='#statewide' data-jump='" + r.k + "'>" + esc(r.l) + "</a></td>";
      if (!D.posted) h += "<td>" + esc(r.c.filter(function (c) { return c[0] !== "None of These Candidates"; }).map(function (c) { return person(c[0]) + (c[1] ? " (" + partyName(c[1]) + ")" : ""); }).join(", ")) + "</td>";
      else {
        var L = hasVotes(r) ? leadOf(r.c.map(function (c) { return c[2]; })) : null;
        h += "<td>" + (L ? (L.tie ? "Tied" : esc(person(r.c[L.i][0]))) : "—") + "</td><td class=num>" + (L && !L.tie ? pct(r.c[L.i][2], r.t) : "—") + "</td><td class=num>" + num(r.t) + "</td><td>" + r.rc + "/" + r.ex + " counties</td>";
      }
      h += "</tr>";
    });
    $("glanceTable").innerHTML = h + "</tbody></table>";
  }

  function renderReno() {
    var reno = D.races.filter(function (r) { return r.s === "reno"; });
    var mayor = reno.filter(function (r) { return r.k === "renomayor"; })[0];
    $("renoMayor").innerHTML = mayor ? "<h3>Reno Mayor <span class=pill>Citywide</span></h3><p class=meta>Nonpartisan race; every Reno voter can vote.</p>" + raceTable(mayor) : "<p class=meta>Reno mayor's race not found in the SOS feed.</p>";
    $("renoOther").innerHTML = reno.filter(function (r) { return r.k !== "renomayor"; }).map(function (r) { return raceCard(r); }).join("");
    // ward map
    var h = "<svg viewBox='-4 -4 308 437' role=img aria-label='Map of Reno city council wards; Wards 2 and 4 have races in 2026'>", items = [];
    Object.keys(WARD_RACE).forEach(function (w) {
      var r = D.races.filter(function (x) { return x.k === WARD_RACE[w]; })[0]; if (!r) return;
      var col = colors(r); r.c.forEach(function (c, i) { items.push([col[i], "Ward " + w + ": " + person(c[0])]); });
    });
    $("wardLegend").innerHTML = legendHTML(items, "No council race this year");
    Object.keys(GEO.wards).forEach(function (w) {
      var g = GEO.wards[w], rk = WARD_RACE[w], fill = "var(--bg)", op = 1, title = "Ward " + w + ": no council race this year";
      if (rk) {
        var r = D.races.filter(function (x) { return x.k === rk; })[0];
        var L = r ? leadOf(r.c.map(function (c) { return c[2]; })) : null;
        if (L && !L.tie) { fill = colors(r)[L.i]; op = opacity(L.margin); title = "Ward " + w + ": " + person(r.c[L.i][0]) + " leads (" + pct(r.c[L.i][2], L.total) + ")"; }
        else { fill = "var(--nores)"; title = "Ward " + w + ": " + (L ? "tied" : "awaiting results"); }
      }
      h += "<path d='" + g.d + "' fill='" + fill + "' fill-opacity='" + op.toFixed(2) + "' stroke='" + (rk ? "var(--ink)" : "var(--mut)") + "' stroke-width='" + (rk ? 1.5 : 0.8) + "'" + (rk ? "" : " stroke-dasharray='3 2'") + "><title>" + esc(title) + "</title></path>";
    });
    Object.keys(GEO.wards).forEach(function (w) { var g = GEO.wards[w]; h += "<text class=maplabel style='font-size:12px" + (WARD_RACE[w] ? ";font-weight:700" : "") + "' x='" + g.x + "' y='" + g.y + "' text-anchor=middle>Ward " + w + "</text>"; });
    $("wardMap").innerHTML = h + "</svg>";
  }

  // ---------- Reno mayor by precinct (Washoe Registrar SOVC; see scripts/reno_precincts.py) ----------
  function genText(g) { // SOVC timestamps are Washoe local time (PT), e.g. 2026-11-04T00:45:04
    var m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(g || ""); if (!m) return esc(g || "unknown time");
    var mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m[2] - 1], h = +m[4];
    return mon + " " + (+m[3]) + ", " + ((h % 12) || 12) + ":" + m[5] + " " + (h < 12 ? "AM" : "PM") + " PT";
  }
  function renderPrecincts() {
    if (!GEO || !GEO.precincts || !$("precinctMap")) return;
    var mayor = D ? D.races.filter(function (r) { return r.k === "renomayor"; })[0] : null;
    var names = ["Marshall, Kate", "Taylor, Kathleen"], col = ["#e69f00", "#009e73"];
    if (mayor) { var mc = colors(mayor); names.forEach(function (n, i) { mayor.c.forEach(function (c, j) { if (c[0] === n) col[i] = mc[j]; }); }); }
    var ok = P && P.status === "ok" && P.p && P.cands && P.cands[0] === names[0] && P.cands[1] === names[1];
    var st;
    if (ok) st = "From the Washoe County Registrar's " + (P.official ? "<strong>official</strong>" : "<strong>unofficial</strong>") + " Statement of Votes Cast, generated " + genText(P.gen) +
      ". These are the spreadsheet's counts, which can trail the city-wide totals above." + (P.masked ? " Some cells are masked by the Registrar to protect voter privacy." : "");
    else st = "<strong>Awaiting precinct results.</strong> " + esc(P && P.note ? P.note : "The Washoe County Registrar has not posted precinct-level results for this election yet.");
    $("precinctStatus").innerHTML = st;
    $("precinctSrc").innerHTML = ok ? "<a href='" + esc(P.src) + "'>" + esc(P.src.split("/").pop()) + "</a> (generated " + genText(P.gen) + ")" : "not posted yet";
    var nz = ok ? Object.keys(GEO.precincts).filter(function (id) { var v = P.p[id]; return v && v[0] != null && v[1] != null && !v[2]; }).length : 0;
    var items = names.map(function (n, i) { return [col[i], person(n) + " leads"]; });
    $("precinctLegend").innerHTML = items.map(function (x) { return "<span><span class=sw aria-hidden=true style='background:" + x[0] + "'></span>" + esc(x[1]) + "</span>"; }).join("") +
      "<span><span class=sw aria-hidden=true style='background:#718096'></span>Tied</span>" +
      "<span><span class=sw aria-hidden=true style='background:var(--nores);border:1px solid var(--line)'></span>" + (ok ? "No votes cast" + (nz ? " (" + nz + " precincts)" : "") + (P.masked ? " / masked" : "") : "Awaiting precinct results") + "</span>" +
      (ok ? "<span class=note>Lighter shade = closer race</span>" : "");
    var h = "<svg viewBox='-4 -4 308 437' role=img aria-label='Map of Reno voting precincts" + (ok ? " colored by leader in the mayor race" : "; precinct results not yet available") + "'>";
    var rows = [];
    Object.keys(GEO.precincts).forEach(function (id) {
      var g = GEO.precincts[id], fill = "var(--nores)", op = 1, title = "Precinct " + id + " (Ward " + g.w + "): awaiting precinct results";
      if (ok) {
        var v = P.p[id];
        if (!v) title = "Precinct " + id + " (Ward " + g.w + "): not in the Registrar's file";
        else if (v[0] == null || v[1] == null) title = "Precinct " + id + " (Ward " + g.w + "): masked by the Registrar for privacy";
        else if (!v[2]) title = "Precinct " + id + " (Ward " + g.w + "): no votes cast" + (v[4] != null ? " (" + num(v[4]) + " registered)" : "");
        else {
          var a = v[0], b = v[1], t = v[2];
          if (a === b) { fill = "#718096"; }
          else { var i = a > b ? 0 : 1; fill = col[i]; op = opacity(100 * Math.abs(a - b) / t); }
          title = "Precinct " + id + " (Ward " + g.w + "): " + person(names[0]) + " " + num(a) + " (" + pct(a, t) + "), " + person(names[1]) + " " + num(b) + " (" + pct(b, t) + ")";
        }
        rows.push([id, g.w, v]);
      }
      h += "<path class=pc d='" + g.d + "' fill='" + fill + "' fill-opacity='" + op.toFixed(2) + "' stroke='var(--card)' stroke-width='0.5' stroke-linejoin='round'><title>" + esc(title) + "</title></path>";
    });
    Object.keys(GEO.wards).forEach(function (w) { h += "<path d='" + GEO.wards[w].d + "' fill='none' stroke='var(--ink)' stroke-width='1.3' stroke-opacity='0.75' pointer-events='none'/>"; });
    Object.keys(GEO.wards).forEach(function (w) { var g = GEO.wards[w]; h += "<text class=maplabel style='font-size:11px;font-weight:700' x='" + g.x + "' y='" + g.y + "' text-anchor=middle>Ward " + w + "</text>"; });
    $("precinctMap").innerHTML = h + "</svg>";
    if (!ok) { $("precinctTable").innerHTML = "<p class=meta>No precinct results yet.</p>"; return; }
    rows.sort(function (x, y) { return x[0] < y[0] ? -1 : 1; });
    var tb = "<table><thead><tr><th scope=col>Precinct</th><th scope=col>Ward</th><th scope=col class=num>" + esc(person(names[0])) + "</th><th scope=col class=num>" + esc(person(names[1])) + "</th><th scope=col class=num>Total votes</th><th scope=col>Leader</th></tr></thead><tbody>";
    rows.forEach(function (r) {
      var v = r[2] || [null, null, null], L = (v[0] != null && v[1] != null && v[2]) ? (v[0] === v[1] ? "Tied" : person(names[v[0] > v[1] ? 0 : 1])) : "—";
      tb += "<tr><td>" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td><td class=num>" + num(v[0]) + "</td><td class=num>" + num(v[1]) + "</td><td class=num>" + num(v[2]) + "</td><td>" + esc(L) + "</td></tr>";
    });
    if (P.tot) tb += "</tbody><tfoot><tr><td colspan=2>Registrar's file total</td><td class=num>" + num(P.tot[0]) + "</td><td class=num>" + num(P.tot[1]) + "</td><td class=num>" + num(P.tot[2]) + "</td><td></td></tr></tfoot>";
    $("precinctTable").innerHTML = tb + "</table>";
  }
  function fetchFrom(urls, i) {
    if (i >= urls.length) return Promise.reject(new Error("all sources failed"));
    var u = urls[i]; u += (u.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now();
    return fetch(u, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (t) { JSON.parse(t); return t; }).catch(function () { return fetchFrom(urls, i + 1); });
  }
  function pollPrecincts() {
    return fetchFrom(P_URLS, 0).then(function (t) {
      if (t === lastPText) return;
      var np = JSON.parse(t);
      // never replace valid precinct data with an older or 'awaiting' copy (e.g. a stale cache)
      if (P && P.status === "ok" && (np.status !== "ok" || (np.gen || "") < (P.gen || ""))) return;
      lastPText = t; P = np; renderPrecincts();
    }).catch(function () { if (!P) renderPrecincts(); });
  }

  function renderLocal() {
    var rs = D.races.filter(function (r) { return r.s === "sparks"; }).concat(D.races.filter(function (r) { return r.s === "washoe"; }));
    $("localRaces").innerHTML = rs.map(function (r) { return raceCard(r); }).join("");
  }

  function renderTurnout() {
    var rows = D.counties.slice().sort(function (a, b) { return (b[2] || 0) - (a[2] || 0); });
    var reg = 0, to = 0, anyTo = false;
    var h = "<table><thead><tr><th scope=col>County</th><th scope=col class=num>Active registered voters</th><th scope=col class=num>Ballots cast</th><th scope=col class=num>Turnout</th></tr></thead><tbody>";
    rows.forEach(function (c) {
      reg += c[2] || 0; if (c[3] != null) { to += c[3]; anyTo = true; }
      h += "<tr" + (c[0] === "16" ? " class=lead" : "") + "><td>" + esc(c[1]) + "</td><td class=num>" + num(c[2]) + "</td><td class=num>" + (c[3] == null ? "Not reported" : num(c[3])) + "</td><td class=num>" + (c[3] != null && c[2] ? pct(c[3], c[2]) : "—") + "</td></tr>";
    });
    h += "</tbody><tfoot><tr><td>Nevada (sum of counties)</td><td class=num>" + num(reg) + "</td><td class=num>" + (anyTo ? num(to) : "Not reported") + "</td><td class=num>" + (anyTo && rows.every(function (c) { return c[3] != null; }) ? pct(to, reg) : "—") + "</td></tr></tfoot></table>";
    $("turnoutTable").innerHTML = "<p class=meta>From the Secretary of State turnout file, largest counties first (Washoe highlighted). Ballots cast appear only once the SOS reports them.</p>" + h;
  }

  function renderAll() {
    renderStatus(); renderBanner(); renderTabs(); renderRace(); renderGlance(); renderReno(); renderPrecincts(); renderLocal(); renderTurnout();
    $("washoeStatus").textContent = D.washoe || "—";
  }

  // ---------- events ----------
  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("[data-g],[data-r],[data-c],[data-jump]") : null;
    if (!t || !D) return;
    if (t.dataset.g) { ui.group = t.dataset.g; ui.race = null; renderTabs(); renderRace(); }
    else if (t.dataset.r) { ui.race = t.dataset.r; renderTabs(); renderRace(); }
    else if (t.dataset.c) { ui.county = t.dataset.c; renderRace(); }
    else if (t.dataset.jump) { var r = D.races.filter(function (x) { return x.k === t.dataset.jump; })[0]; if (r) { ui.group = r.s; ui.race = r.k; renderTabs(); renderRace(); } }
    if (t.dataset.c || t.dataset.r || t.dataset.g) { var b = document.querySelector("[data-" + (t.dataset.g ? "g='" + t.dataset.g : t.dataset.r ? "r='" + t.dataset.r : "c='" + t.dataset.c) + "']"); if (b && b.focus && !t.dataset.c) b.focus(); }
  });

  // ---------- polling ----------
  function fetchText(i) {
    if (i >= DATA_URLS.length) return Promise.reject(new Error("all data sources failed"));
    var u = DATA_URLS[i]; u += (u.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now();
    return fetch(u, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    }).then(function (txt) { JSON.parse(txt); return txt; }).catch(function () { return fetchText(i + 1); });
  }
  function poll() {
    return fetchText(0).then(function (txt) {
      lastErr = null; lastOkTs = Date.now();
      if (txt !== lastText) {
        var nd = JSON.parse(txt);
        // never go backwards to an older SOS release (e.g. a stale cached copy)
        if (D && nd.seq != null && D.seq != null && nd.seq < D.seq) { renderStatus(); return; }
        lastText = txt; D = nd; renderAll();
      } else renderStatus();
    }).catch(function (e) { lastErr = e.message; renderStatus(); });
  }
  fetch("geo.json").then(function (r) { return r.json(); }).then(function (g) {
    GEO = g; poll(); pollPrecincts(); setInterval(poll, POLL_MS); setInterval(pollPrecincts, POLL_MS); setInterval(tickAgo, 1000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) { poll(); pollPrecincts(); } });
  }).catch(function (e) { lastErr = "map geometry: " + e.message; renderStatus(); });
  window.__nvPoll = poll; window.__nvPollPrecincts = pollPrecincts; // for testing
})();
