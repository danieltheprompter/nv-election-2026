/* Nevada 2026 Election Results (unofficial tracker). Plain JS, no dependencies.
   Renders only what the data file (a mirror of the NV SOS feed) contains; never estimates. */
(function () {
  "use strict";
  // Data sources, tried in order. Measured 2026-11-03: the GitHub Pages copy is live ~30-90 s after a push
  // (each Pages deploy purges its CDN); raw.githubusercontent.com ignores query strings and lagged ~3-5 min,
  // so it is only a fallback.
  var DATA_URLS = (window.NV_DATA_URLS || [
    "data/results.json",
    "https://raw.githubusercontent.com/danieltheprompter/nv-election-2026/data/results.json"
  ]);
  var POLL_MS = 60000;
  var PT = "America/Los_Angeles";
  var PALETTE = ["#805ad5", "#d69e2e", "#319795", "#d53f8c", "#4a5568", "#dd6b20", "#38a169", "#3182ce"];
  var PARTY = { DEM: "#2b6cb0", REP: "#c53030" };
  var GROUPS = [["statewide", "Statewide offices"], ["house", "U.S. House"], ["question", "Ballot questions"]];
  var WARD_RACE = { "2": "renow2", "4": "renow4" };
  var SMALL = { "01": 1, "04": 1, "15": 1 };

  var D = null, GEO = null, lastText = null, lastOkAt = null, lastErr = null;
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
  function nowPT() { return new Date().toLocaleTimeString("en-US", { timeZone: PT, hour: "numeric", minute: "2-digit", second: "2-digit" }) + " PT"; }
  function hasVotes(r) { return !!r.t && r.t > 0; }
  function countyName(code) { for (var i = 0; i < D.counties.length; i++) if (D.counties[i][0] === code) return D.counties[i][1]; return code; }

  // colour for choice i of race r
  function colors(r) {
    var out = [], k = 0;
    r.c.forEach(function (c) {
      var lab = c[0], party = c[1];
      if (lab === "Yes") out.push("#2f855a");
      else if (lab === "No") out.push("#c05621");
      else if (lab === "None of These Candidates") out.push("#a0aec0");
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
    var h = "<table><thead><tr><th>" + (r.s === "question" || /Question/.test(r.l) ? "Choice" : "Candidate") + "</th>" + (showParty ? "<th>Party</th>" : "");
    if (votes) h += "<th class=num>Votes</th><th class=num>Share</th>";
    h += "</tr></thead><tbody>";
    idx.forEach(function (i, rank) {
      var c = r.c[i];
      var isLead = lead && !lead.tie && i === lead.i && r.vf === 1;
      h += "<tr" + (isLead ? " class=lead" : "") + "><td><span class=sw style='background:" + col[i] + "'></span>" + esc(person(c[0]));
      if (votes) h += "<div class=bar><i style='width:" + (r.t ? (100 * (c[2] || 0) / r.t) : 0).toFixed(2) + "%;background:" + col[i] + "'></i></div>";
      h += "</td>" + (showParty ? "<td>" + esc(c[1] || "") + "</td>" : "");
      if (votes) h += "<td class=num>" + num(c[2]) + "</td><td class=num>" + pct(c[2], r.t) + "</td>";
      h += "</tr>";
    });
    h += "</tbody>";
    if (votes) h += "<tfoot><tr><td colspan=" + (showParty ? 2 : 1) + ">Total votes</td><td class=num>" + num(r.t) + "</td><td></td></tr></tfoot>";
    h += "</table>";
    var meta = votes ? reportingText(r) + (lead && lead.tie ? " · tied" : "")
      : (D.posted ? "No votes reported in this race yet · " + reportingText(r) : "Awaiting results");
    if (r.vf > 1) meta += " · vote for " + r.vf;
    return (opts.noMeta ? "" : "<p class=meta>" + esc(meta) + "</p>") + h;
  }

  function raceCard(r, cls) {
    var name = r.n && r.n !== r.l ? "<span class=pill>" + esc(r.n) + "</span>" : "";
    return "<div class='card " + (cls || "") + "'><h3>" + esc(r.l) + name + "</h3>" + (r.q ? "<p class=q>" + esc(r.q) + "</p>" : "") + raceTable(r) + "</div>";
  }

  function renderStatus() {
    var el = $("status");
    if (!D) { el.className = "status err"; el.innerHTML = "<span class=dot></span>Could not load the results data yet" + (lastErr ? " (" + esc(lastErr) + ")" : "") + ". Retrying every 60 s."; return; }
    var s = "<span class=dot></span>Unofficial results; last updated " + esc(D.u) + ", SOS release #" + esc(D.seq);
    if (D.g) s += " (SOS published " + esc(D.g) + ")";
    s += ". <span style='font-weight:400'>Page checked for new data at " + esc(lastOkAt || "—") + (lastErr ? "; last check failed, retrying" : "") + ".</span>";
    el.className = "status " + (lastErr ? "err" : "ok"); el.innerHTML = s;
  }

  function renderBanner() {
    var b = $("banner");
    if (!D.posted) {
      b.innerHTML = "<div class='banner pre'><strong>No results posted yet; polls close 7 PM PT.</strong><br>" +
        "The Nevada Secretary of State has not published any vote counts (latest feed: release #" + esc(D.seq) + ", published " + esc(D.g || "—") +
        "). Candidates are listed below; vote totals will appear here automatically once the SOS posts them, usually after all Nevada polling places close. No need to reload.</div>";
    } else {
      b.innerHTML = "<div class='banner live'><strong>Unofficial results — counting in progress.</strong><br>Counts change as counties report more ballots. " +
        "Results are unofficial until canvass (Washoe: Nov 13, 2026).</div>";
    }
  }

  function renderTabs() {
    var g = $("groupTabs");
    g.innerHTML = GROUPS.map(function (x) { return "<button role=tab data-g='" + x[0] + "' aria-selected=" + (ui.group === x[0]) + ">" + x[1] + "</button>"; }).join("");
    var races = D.races.filter(function (r) { return r.s === ui.group; });
    if (!races.some(function (r) { return r.k === ui.race; }) && races.length) ui.race = races[0].k;
    $("raceTabs").innerHTML = races.map(function (r) { return "<button role=tab data-r='" + r.k + "' aria-selected=" + (ui.race === r.k) + ">" + esc(r.l) + "</button>"; }).join("");
  }

  function currentRace() { for (var i = 0; i < D.races.length; i++) if (D.races[i].k === ui.race) return D.races[i]; return null; }

  function renderRace() {
    var r = currentRace(); if (!r) return;
    $("raceHead").innerHTML = "<h3>" + esc(r.n || r.l) + "</h3>" + (r.q ? "<p class=q>" + esc(r.q) + "</p>" : "");
    $("raceTotals").innerHTML = "<h3>Statewide / district totals</h3>" + raceTable(r);
    var col = colors(r);
    $("legend").innerHTML = r.c.map(function (c, i) { return "<span><span class=sw style='background:" + col[i] + "'></span>" + esc(person(c[0])) + "</span>"; }).join("") +
      "<span><span class=sw style='background:var(--nores);border:1px solid var(--line)'></span>Awaiting results</span><span><span class=sw style='background:var(--bg);border:1px dashed var(--line)'></span>Not in this contest</span>";
    renderMap(r, col);
    renderCountyTable(r);
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
    $("mapNote").innerHTML = note + (D.posted ? " Shade intensity reflects margin." : "");
  }

  function renderCountyTable(r) {
    $("countyHead").textContent = (r.n || r.l) + " — results by county";
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
    var h = "<table><thead><tr><th>Race</th>" + (D.posted ? "<th>Leader</th><th class=num>Share</th><th class=num>Votes</th><th>Reporting</th>" : "<th>On the ballot</th>") + "</tr></thead><tbody>";
    rs.forEach(function (r) {
      h += "<tr><td><a href='#statewide' data-jump='" + r.k + "'>" + esc(r.l) + "</a></td>";
      if (!D.posted) h += "<td>" + esc(r.c.filter(function (c) { return c[0] !== "None of These Candidates"; }).map(function (c) { return person(c[0]) + (c[1] ? " (" + c[1] + ")" : ""); }).join(", ")) + "</td>";
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
    $("renoMayor").innerHTML = mayor ? "<h3>Reno Mayor <span class=pill>Citywide</span></h3>" + raceTable(mayor) : "<p class=meta>Reno mayor's race not found in the SOS feed.</p>";
    $("renoOther").innerHTML = reno.filter(function (r) { return r.k !== "renomayor"; }).map(function (r) { return raceCard(r); }).join("");
    // ward map
    var h = "<svg viewBox='-4 -4 308 437' role=img aria-label='Map of Reno city council wards'>";
    Object.keys(GEO.wards).forEach(function (w) {
      var g = GEO.wards[w], rk = WARD_RACE[w], fill = "var(--bg)", op = 1, title = "Ward " + w + ": no council race in 2026";
      if (rk) {
        var r = D.races.filter(function (x) { return x.k === rk; })[0];
        var L = r ? leadOf(r.c.map(function (c) { return c[2]; })) : null;
        if (L && !L.tie) { fill = colors(r)[L.i]; op = opacity(L.margin); title = "Ward " + w + ": " + person(r.c[L.i][0]) + " leads (" + pct(r.c[L.i][2], L.total) + ")"; }
        else { fill = "var(--nores)"; title = "Ward " + w + ": " + (L ? "tied" : "awaiting results"); }
      }
      h += "<path d='" + g.d + "' fill='" + fill + "' fill-opacity='" + op.toFixed(2) + "' stroke='" + (rk ? "var(--acc)" : "var(--line)") + "' stroke-width='" + (rk ? 1.5 : 1) + "'><title>" + esc(title) + "</title></path>";
    });
    Object.keys(GEO.wards).forEach(function (w) { var g = GEO.wards[w]; h += "<text class=maplabel style='font-size:11px' x='" + g.x + "' y='" + g.y + "' text-anchor=middle>Ward " + w + "</text>"; });
    $("wardMap").innerHTML = h + "</svg>";
  }

  function renderLocal() {
    var rs = D.races.filter(function (r) { return r.s === "sparks"; }).concat(D.races.filter(function (r) { return r.s === "washoe"; }));
    $("localRaces").innerHTML = rs.map(function (r) { return raceCard(r); }).join("");
  }

  function renderTurnout() {
    var rows = D.counties.slice().sort(function (a, b) { return (b[2] || 0) - (a[2] || 0); });
    var reg = 0, to = 0, anyTo = false;
    var h = "<table><thead><tr><th>County</th><th class=num>Active registered voters</th><th class=num>Ballots cast</th><th class=num>Turnout</th></tr></thead><tbody>";
    rows.forEach(function (c) {
      reg += c[2] || 0; if (c[3] != null) { to += c[3]; anyTo = true; }
      h += "<tr" + (c[0] === "16" ? " class=lead" : "") + "><td>" + esc(c[1]) + "</td><td class=num>" + num(c[2]) + "</td><td class=num>" + (c[3] == null ? "Not reported" : num(c[3])) + "</td><td class=num>" + (c[3] != null && c[2] ? pct(c[3], c[2]) : "—") + "</td></tr>";
    });
    h += "</tbody><tfoot><tr><td>Nevada (sum of counties)</td><td class=num>" + num(reg) + "</td><td class=num>" + (anyTo ? num(to) : "Not reported") + "</td><td class=num>" + (anyTo && rows.every(function (c) { return c[3] != null; }) ? pct(to, reg) : "—") + "</td></tr></tfoot></table>";
    $("turnoutTable").innerHTML = "<p class=meta>From the SOS turnout file. Ballots cast are shown only once the SOS reports them.</p>" + h;
  }

  function renderAll() {
    renderStatus(); renderBanner(); renderTabs(); renderRace(); renderGlance(); renderReno(); renderLocal(); renderTurnout();
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
      lastErr = null; lastOkAt = nowPT();
      if (txt !== lastText) {
        var nd = JSON.parse(txt);
        // never go backwards to an older SOS release (e.g. a stale cached copy)
        if (D && nd.seq != null && D.seq != null && nd.seq < D.seq) { renderStatus(); return; }
        lastText = txt; D = nd; renderAll();
      } else renderStatus();
    }).catch(function (e) { lastErr = e.message; renderStatus(); });
  }
  fetch("geo.json").then(function (r) { return r.json(); }).then(function (g) {
    GEO = g; poll(); setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });
  }).catch(function (e) { lastErr = "map geometry: " + e.message; renderStatus(); });
  window.__nvPoll = poll; // for testing
})();
