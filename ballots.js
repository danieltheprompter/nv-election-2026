/* Nevada 2026 ballots received (unofficial tracker). Plain JS, no dependencies.
   Shows only numbers in data/ballots.json (copied from the NV SOS VIVID dashboard files) and data/registration.json
   (SOS "Active Voters by County & Party"); the only arithmetic is sums and percentages of those numbers. */
(function () {
  "use strict";
  var URLS = (window.NV_BALLOT_URLS || ["data/ballots.json",
    "https://raw.githubusercontent.com/danieltheprompter/nv-election-2026/main/data/ballots.json"]);
  var POLL_MS = 300000, PT = "America/Los_Angeles";
  var PC = ["#1f5fa8", "#c8372d", "#8a8a8a"], PN = ["Democratic", "Republican", "Other"];
  var SMALL = { "01": 1, "04": 1, "15": 1 };
  var B = null, GEO = null, lastText = null, lastOk = null, lastErr = null;
  var ui = { county: "16", sort: "reg", dir: -1, mode: "party" };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(v) { return v == null ? "—" : Number(v).toLocaleString("en-US"); }
  function pct(v, t) { return (v == null || !t) ? "—" : (100 * v / t).toFixed(1) + "%"; }
  function s3(a) { return a[0] + a[1] + a[2]; }
  function add(a, b) { return a.map(function (x, i) { return x + b[i]; }); }
  function sumF(f) { return B.counties.reduce(function (acc, c) { return add(acc, c.m[f].slice(0, 3)); }, [0, 0, 0]); }
  function sumK(k) { return B.counties.reduce(function (acc, c) { return add(acc, c[k].slice(0, 3)); }, [0, 0, 0]); }
  function byCode(code) { for (var i = 0; i < B.counties.length; i++) if (B.counties[i].c === code) return B.counties[i]; return null; }
  // per-county derived figures (sums of the official counts only)
  function cfig(c) {
    var ret = s3(c.m.received), ev = c.ev[3], ed = c.ed[3], tot = ret + ev + ed;
    return { reg: c.reg[3], sent: s3(c.m.sent), ret: ret, ev: ev, ed: ed, tot: tot, p: c.reg[3] ? tot / c.reg[3] : null,
      party: add(add(c.m.received, c.ev.slice(0, 3)), c.ed.slice(0, 3)) };
  }
  function dayLabel(d) { var p = d.split("-"); var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)); return dt.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }); }

  function agoText() {
    if (!lastOk) return "";
    var s = Math.round((Date.now() - lastOk) / 1000);
    return s < 60 ? "checked just now" : "checked " + Math.round(s / 60) + " min ago";
  }
  function renderStatus() {
    var el = $("status");
    if (!B) { el.className = "status" + (lastErr ? " err" : ""); el.innerHTML = "<span class=dot></span>" + (lastErr ? "Couldn't load ballot numbers (" + esc(lastErr) + "). Retrying." : "Loading ballot numbers…"); return; }
    el.className = "status " + (lastErr ? "err" : "ok");
    el.innerHTML = "<span class=dot></span>Mail ballots as of <strong>" + esc(B.mail.asof) + "</strong> · in-person as of <strong>" + esc(B.inperson.asof) +
      "</strong> <span class=ago id=ago>· " + esc(agoText()) + "</span>" + (lastErr ? " · last check failed, retrying" : "");
  }
  function stat(k, v, x, cls) { return "<div class='stat" + (cls ? " " + cls : "") + "'><span class=k>" + k + "</span><span class=v>" + v + "</span>" + (x ? "<span class=x>" + x + "</span>" : "") + "</div>"; }

  // one calm headline block: total received, party split + lead, then % of active voters and the method split
  // "D +5,123 (+3.1 pts)" from official per-party counts
  function leadCount(party) {
    var t = s3(party); if (!t) return "no data"; var d = party[0] - party[1], m = d / t * 100;
    if (d === 0) return "even";
    return (d > 0 ? "D +" : "R +") + num(Math.abs(d)) + " (+" + Math.abs(m).toFixed(1) + " pts)";
  }
  function hero(tot, party, reg, ret, ev, ed, big) {
    var t = s3(party), m = t ? (party[0] - party[1]) / t * 100 : null;
    return "<div class='hero" + (big ? " big" : "") + "'><p class=hv><strong>" + num(tot) + "</strong> ballots received</p>" +
      "<ul class=hp>" + PN.map(function (n, i) { return "<li><span class=sw style='background:" + PC[i] + "'></span><span class=pn>" + n + "</span><strong>" + num(party[i]) + "</strong><span class=pp>" + pct(party[i], t) + "</span></li>"; }).join("") +
      "</ul><p class=hl>Lead: <strong>" + leadCount(party) + "</strong></p>" +
      "<p class=hx>" + [pct(tot, reg) + " of active voters", "Mail " + num(ret), "Early " + num(ev), "Election Day " + num(ed)].map(function (x) { return "<span>" + x + "</span>"; }).join(" · ") + "</p></div>";
  }
  function renderSummary() {
    var sent = s3(sumF("sent")), und = s3(sumF("undeliverable")), rec = s3(sumF("received")), acc = s3(sumF("accepted")),
      cure = s3(sumF("signatureCure")), cured = s3(sumF("successfullyCured")), canc = s3(sumF("canceled")), rej = s3(sumF("rejected"));
    var out = sent - und - rec - canc;
    var ev = s3(sumK("ev")), ed = s3(sumK("ed")), reg = B.counties.reduce(function (a, c) { return a + c.reg[3]; }, 0);
    var tot = rec + ev + ed;
    var party = add(add(sumF("received"), sumK("ev")), sumK("ed"));
    $("sumCards").innerHTML = hero(tot, party, reg, rec, ev, ed, true);
    $("mailCard").innerHTML = "<h3>Mail ballots</h3><p class=meta>As shown on the VIVID dashboard (as of " + esc(B.mail.asof) + ").</p>" +
      "<table class=kv><tbody>" +
      "<tr><td>Mailed out</td><td class=num>" + num(sent) + "</td><td class=num></td></tr>" +
      "<tr><td>Returned</td><td class=num>" + num(rec) + "</td><td class=num>" + pct(rec, sent) + " of mailed out</td></tr>" +
      "<tr><td>Accepted</td><td class=num>" + num(acc) + "</td><td class=num>" + pct(acc, rec) + " of returned</td></tr>" +
      "<tr><td>Needs signature cure</td><td class=num>" + num(cure) + "</td><td class=num>" + pct(cure, rec) + " of returned</td></tr>" +
      "<tr><td>Successfully cured</td><td class=num>" + num(cured) + "</td><td class=num>" + pct(cured, rec) + " of returned</td></tr>" +
      "<tr><td>Rejected</td><td class=num>" + num(rej) + "</td><td class=num></td></tr>" +
      "<tr><td>Outstanding</td><td class=num>" + num(out) + "</td><td class=num>" + pct(out, sent) + " of mailed out</td></tr>" +
      "<tr class=sub><td>Undeliverable</td><td class=num>" + num(und) + "</td><td></td></tr>" +
      "<tr class=sub><td>Canceled (includes mail ballots of people who voted in person)</td><td class=num>" + num(canc) + "</td><td></td></tr>" +
      "</tbody></table><p class=note>“Outstanding” is calculated the way VIVID does: mailed out − undeliverable − returned − canceled.</p>";
    var days = B.days, evd = days.filter(function (d) { return !d.ed; });
    $("inpCard").innerHTML = "<h3>In-person voting</h3><p class=meta>Check-ins at polling places (as of " + esc(B.inperson.asof) + ").</p>" +
      "<table class=kv><tbody>" +
      "<tr><td>Early voting (" + (evd.length ? esc(dayLabel(evd[0].d)) + " – " + esc(dayLabel(evd[evd.length - 1].d)) : "—") + ")</td><td class=num>" + num(ev) + "</td></tr>" +
      "<tr><td>Election Day (Nov 3), so far</td><td class=num>" + num(ed) + "</td></tr>" +
      "<tr><td><strong>All in person</strong></td><td class=num>" + num(ev + ed) + "</td></tr>" +
      "</tbody></table><p class=note>“Ballots received so far” above is the sum of mail ballots returned, early in-person and Election Day in-person — three separate official counts. Voters who vote in person have their mail ballot canceled, so no one is in more than one of them.</p>";
  }

  function renderParty() {
    var rec = sumF("received"), ev = sumK("ev"), ed = sumK("ed"), reg = B.counties.reduce(function (a, c) { return add(a, c.reg.slice(0, 3)); }, [0, 0, 0]);
    var tot = add(add(rec, ev), ed), T = s3(tot), R = s3(reg);
    function bar(v, label) {
      var t = s3(v);
      return "<p class=pbrow><strong>" + label + "</strong></p><div class=pbar role=img aria-label='" + esc(label + ": " + PN.map(function (n, i) { return n + " " + pct(v[i], t); }).join(", ")) + "'>" +
        v.map(function (x, i) { return "<i style='width:" + (t ? 100 * x / t : 0).toFixed(2) + "%;background:" + PC[i] + "' title='" + PN[i] + " " + pct(x, t) + "'></i>"; }).join("") + "</div>";
    }
    $("partyBars").innerHTML = "<div class=legend>" + PN.map(function (n, i) { return "<span><span class=sw style='background:" + PC[i] + "'></span>" + n + "</span>"; }).join("") + "</div>" +
      bar(tot, "Ballots received so far") + bar(reg, "Active registered voters");
    var h = "<table><thead><tr><th>Party registration</th><th class=num>Active registered</th><th class=num>Mail returned</th><th class=num>Early in person</th><th class=num>Election Day in person</th><th class=num>Total received</th><th class=num>% of registered</th><th class=num>Share of all received</th></tr></thead><tbody>";
    PN.forEach(function (n, i) {
      h += "<tr><td><span class=sw style='background:" + PC[i] + "'></span>" + n + "</td><td class=num>" + num(reg[i]) + "</td><td class=num>" + num(rec[i]) + "</td><td class=num>" + num(ev[i]) + "</td><td class=num>" + num(ed[i]) +
        "</td><td class=num>" + num(tot[i]) + "</td><td class=num>" + pct(tot[i], reg[i]) + "</td><td class=num>" + pct(tot[i], T) + "</td></tr>";
    });
    h += "</tbody><tfoot><tr><td>All voters</td><td class=num>" + num(R) + "</td><td class=num>" + num(s3(rec)) + "</td><td class=num>" + num(s3(ev)) + "</td><td class=num>" + num(s3(ed)) + "</td><td class=num>" + num(T) + "</td><td class=num>" + pct(T, R) + "</td><td class=num>100%</td></tr></tfoot></table>";
    $("partyTable").innerHTML = h + "<p class=note>“Other” = registered nonpartisan, Independent American, Libertarian or another party. Registration is the Secretary of State's active voter count as of " + esc(B.reg.asof) + ".</p>";
  }

  // map: fixed 5-point bins of "% of active registered voters with a ballot received" (ColorBrewer Purples)
  var BINS = [0, 25, 30, 35, 40, 45, 50, 55, 60];
  var RAMP = ["#fcfbfd", "#efedf5", "#dadaeb", "#bcbddc", "#9e9ac8", "#807dba", "#6a51a3", "#54278f", "#3f007d"];
  function binOf(p) { var b = 0; for (var i = 0; i < BINS.length; i++) if (p * 100 >= BINS[i]) b = i; return b; }
  function binLabel(i) { return i === BINS.length - 1 ? BINS[i] + "% or more" : i === 0 ? "under " + BINS[1] + "%" : BINS[i] + "–" + BINS[i + 1] + "%"; }
  // party mode: diverging bins of the D-minus-R margin, in points, among all ballots received (Other counts in the base, not the color)
  var MB = [0, 5, 10, 20, 30];
  var BLUES = ["#c6dbef", "#9ecae1", "#6baed6", "#3182bd", "#08519c"], REDS = ["#fcbba1", "#fc9272", "#fb6a4a", "#de2d26", "#a50f15"];
  function margin(f) { var t = s3(f.party); return t ? (f.party[0] - f.party[1]) / t * 100 : null; }
  function mbin(m) { var a = Math.abs(m), b = 0; for (var i = 0; i < MB.length; i++) if (a >= MB[i]) b = i; return b; }
  function mcolor(m) { return m == null ? "var(--bg)" : (m >= 0 ? BLUES : REDS)[mbin(m)]; }
  function mlabel(i) { return i === MB.length - 1 ? MB[i] + "+ pts" : MB[i] + "–" + MB[i + 1] + " pts"; }
  function leadText(m) { return m == null ? "no data" : Math.abs(m) < 0.05 ? "even" : (m > 0 ? "D +" : "R +") + Math.abs(m).toFixed(1) + " pts"; }
  function shareText(f) { var t = s3(f.party); return t ? PN.map(function (n, i) { return n.slice(0, 3) + " " + (f.party[i] / t * 100).toFixed(1) + "%"; }).join(" · ") : ""; }
  function renderMap() {
    var party = ui.mode === "party";
    $("mapMode").innerHTML = [["party", "Party lead"], ["ret", "% received"]].map(function (x) {
      return "<button type=button data-mode='" + x[0] + "' aria-pressed=" + (ui.mode === x[0]) + ">" + x[1] + "</button>"; }).join("");
    $("mapTitle").textContent = party ? "Party lead among ballots received (Democratic vs. Republican share)" : "Share of active registered voters whose ballot has been received";
    var used = {};
    B.counties.forEach(function (c) { var f = cfig(c);
      if (party) { var m = margin(f); if (m != null) used[(m >= 0 ? "d" : "r") + mbin(m)] = 1; } else if (f.p != null) used[binOf(f.p)] = 1; });
    var sw = function (col, l) { return "<span><span class=sw style='background:" + col + ";border:1px solid var(--line)'></span>" + l + "</span>"; };
    $("legend").innerHTML = party ?
      MB.map(function (b, i) { return used["d" + i] ? sw(BLUES[i], "D " + mlabel(i)) : ""; }).reverse().join("") +
      MB.map(function (b, i) { return used["r" + i] ? sw(REDS[i], "R " + mlabel(i)) : ""; }).join("")
      : BINS.map(function (b, i) { return used[i] ? sw(RAMP[i], binLabel(i)) : ""; }).join("");
    var h = "<svg viewBox='-4 -4 308 461' role=img aria-label='" + (party ? "Map of Nevada counties shaded by the Democratic or Republican lead in share of ballots received" : "Map of Nevada counties shaded by the share of active registered voters whose ballot has been received") + "'>";
    Object.keys(GEO.counties).forEach(function (code) {
      var g = GEO.counties[code], c = byCode(code), f = c ? cfig(c) : null;
      var fill = !f ? "var(--bg)" : party ? mcolor(margin(f)) : (f.p != null ? RAMP[binOf(f.p)] : "var(--bg)");
      h += "<path data-c='" + code + "' d='" + g.d + "' fill='" + fill + "' stroke='var(--card)' stroke-width='1' stroke-linejoin='round'" +
        (ui.county === code ? " class=sel" : "") + "><title>" + esc((c ? c.n : code) + ": " + (f ? leadText(margin(f)) + " (" + shareText(f) + "); " + pct(f.tot, f.reg) + " of active registered voters (" + num(f.tot) + " of " + num(f.reg) + ")" : "no data")) + "</title></path>";
    });
    Object.keys(GEO.counties).forEach(function (code) {
      if (SMALL[code]) return; var g = GEO.counties[code], c = byCode(code);
      h += "<text class=maplabel x='" + g.x + "' y='" + g.y + "' text-anchor=middle>" + esc(c ? c.n : code) + "</text>";
    });
    $("map").innerHTML = h + "</svg>";
    var c = byCode(ui.county), f = c && cfig(c);
    $("mapNote").innerHTML = c ? "<strong>" + esc(c.n) + ":</strong> " + num(f.tot) + " ballots received · " + leadCount(f.party) + ". Tap another county to switch." : "";
    renderCountyDetail();
  }
  function renderCountyDetail() {
    var c = byCode(ui.county); if (!c) { $("countyDetail").innerHTML = ""; return; }
    var f = cfig(c), m = c.m, out = [0, 1, 2].map(function (i) { return m.sent[i] - m.undeliverable[i] - m.received[i] - m.canceled[i]; });
    function row(l, a) { return "<tr><td>" + l + "</td>" + a.map(function (x) { return "<td class=num>" + num(x) + "</td>"; }).join("") + "<td class=num>" + num(s3(a)) + "</td></tr>"; }
    function prow(l, a, base) { return "<tr><td>" + l + "</td>" + a.map(function (x, i) { return "<td class=num>" + pct(x, base[i]) + "</td>"; }).join("") + "<td class=num>" + pct(s3(a), s3(base)) + "</td></tr>"; }
    var all = [f.tot, f.tot, f.tot];
    $("countyDetail").innerHTML = "<h3>" + esc(c.n) + " County</h3>" + hero(f.tot, f.party, f.reg, f.ret, f.ev, f.ed) +
      "<details class=more><summary>More details</summary><p class=meta>By party registration. Mail data updated by the county " + esc(c.lu) + ".</p>" +
      "<div class=scroll><table><thead><tr><th></th>" + PN.map(function (n, i) { return "<th class=num><span class=sw style='background:" + PC[i] + "'></span>" + n + "</th>"; }).join("") + "<th class=num>Total</th></tr></thead><tbody>" +
      row("<strong>Total received</strong>", f.party) + prow("Share of received", f.party, all) +
      row("Mail returned", m.received) + row("Early in person", c.ev.slice(0, 3)) + row("Election Day in person", c.ed.slice(0, 3)) +
      row("Mail ballots sent", m.sent) + row("Mail accepted", m.accepted) + row("Needs signature cure", m.signatureCure) + row("Successfully cured", m.successfullyCured) +
      row("Rejected", m.rejected) + row("Outstanding", out) + row("Undeliverable", m.undeliverable) + row("Canceled", m.canceled) +
      row("Active registered", c.reg.slice(0, 3)) + prow("% of registered", f.party, c.reg.slice(0, 3)) +
      "</tbody></table></div><p class=note>Outstanding = sent − undeliverable − returned − canceled (VIVID's formula). Canceled includes mail ballots of people who voted in person.</p></details>";
  }

  var COLS = [["n", "County", 0], ["reg", "Active registered", 1], ["sent", "Mail sent", 1], ["ret", "Mail returned", 1], ["ev", "Early in person", 1], ["ed", "Election Day in person", 1], ["tot", "Total received", 1], ["p", "% of registered", 1], ["dem", "Democratic received", 1], ["rep", "Republican received", 1], ["oth", "Other received", 1], ["lead", "Lead (D − R)", 1]];
  function renderCountyTable() {
    var rows = B.counties.map(function (c) {
      var f = cfig(c); f.n = c.n; f.c = c.c; var t = s3(f.party);
      f.dem = f.party[0]; f.rep = f.party[1]; f.oth = f.party[2]; f.lead = f.party[0] - f.party[1]; return f;
    });
    rows.sort(function (a, b) {
      var x = a[ui.sort], y = b[ui.sort];
      if (typeof x === "string") return ui.dir * x.localeCompare(y);
      return ui.dir * ((x == null ? -1 : x) - (y == null ? -1 : y));
    });
    var h = "<table><thead><tr>" + COLS.map(function (c) {
      return "<th class='sortable" + (c[2] ? " num" : "") + "' aria-sort=" + (ui.sort === c[0] ? (ui.dir > 0 ? "ascending" : "descending") : "none") + "><button type=button data-sort='" + c[0] + "'>" + c[1] + "</button></th>";
    }).join("") + "</tr></thead><tbody>";
    rows.forEach(function (f) {
      h += "<tr" + (f.c === ui.county ? " class=sel" : "") + "><td><button type=button class=cty data-c='" + f.c + "'>" + esc(f.n) + "</button></td><td class=num>" + num(f.reg) + "</td><td class=num>" + num(f.sent) + "</td><td class=num>" + num(f.ret) +
        "</td><td class=num>" + num(f.ev) + "</td><td class=num>" + num(f.ed) + "</td><td class=num><strong>" + num(f.tot) + "</strong></td><td class=num>" + pct(f.tot, f.reg) +
        "</td>" + [0, 1, 2].map(function (i) { return "<td class=num>" + num(f.party[i]) + "<span class=cp>" + pct(f.party[i], s3(f.party)) + "</span></td>"; }).join("") + "<td class=num>" + leadCount(f.party).replace(" (", "<span class=cp>(") + "</span></td></tr>";
    });
    var T = rows.reduce(function (a, f) { return { reg: a.reg + f.reg, sent: a.sent + f.sent, ret: a.ret + f.ret, ev: a.ev + f.ev, ed: a.ed + f.ed, tot: a.tot + f.tot, party: add(a.party, f.party) }; }, { reg: 0, sent: 0, ret: 0, ev: 0, ed: 0, tot: 0, party: [0, 0, 0] });
    h += "</tbody><tfoot><tr><td>Nevada</td><td class=num>" + num(T.reg) + "</td><td class=num>" + num(T.sent) + "</td><td class=num>" + num(T.ret) + "</td><td class=num>" + num(T.ev) + "</td><td class=num>" + num(T.ed) +
      "</td><td class=num>" + num(T.tot) + "</td><td class=num>" + pct(T.tot, T.reg) + "</td>" + [0, 1, 2].map(function (i) { return "<td class=num>" + num(T.party[i]) + "<span class=cp>" + pct(T.party[i], T.tot) + "</span></td>"; }).join("") + "<td class=num>" + leadCount(T.party).replace(" (", "<span class=cp>(") + "</span></td></tr></tfoot></table>";
    $("countyTable").innerHTML = h + "<p class=note>Party shares are of ballots received in that county, by the voter's party registration.</p>";
  }

  function renderDaily() {
    var tots = B.days.map(function (d) { var v = [0, 0, 0, 0]; Object.keys(d.c).forEach(function (k) { v = add(v, d.c[k]); }); return v; });
    var mx = Math.max.apply(null, tots.map(function (v) { return v[3]; }).concat([1]));
    var h = "<div class=legend>" + PN.map(function (n, i) { return "<span><span class=sw style='background:" + PC[i] + "'></span>" + n + "</span>"; }).join("") + "</div><div class=days>";
    B.days.forEach(function (d, j) {
      var v = tots[j];
      h += "<span class='lab" + (d.ed ? " ed" : "") + "'>" + esc(dayLabel(d.d)) + (d.ed ? " · Election Day" : "") + "</span><div class=pbar style='width:" + (100 * v[3] / mx).toFixed(1) + "%' role=img aria-label='" + esc(dayLabel(d.d) + ": " + num(v[3]) + " voted in person") + "'>" +
        [0, 1, 2].map(function (i) { return "<i style='width:" + (v[3] ? 100 * v[i] / v[3] : 0).toFixed(2) + "%;background:" + PC[i] + "'></i>"; }).join("") + "</div><span class=tot>" + num(v[3]) + "</span>";
    });
    $("dailyChart").innerHTML = h + "</div><p class=note>Weekend early voting was open only in some counties (" + B.days.filter(function (d) { return Object.keys(d.c).length < 17; }).map(function (d) { return esc(dayLabel(d.d)) + ": " + Object.keys(d.c).length; }).join(", ") + " counties).</p>";
    var t = "<table><thead><tr><th>Day</th><th class=num>Democratic</th><th class=num>Republican</th><th class=num>Other</th><th class=num>Total</th><th class=num>Counties</th></tr></thead><tbody>";
    B.days.forEach(function (d, j) { var v = tots[j]; t += "<tr><td>" + esc(dayLabel(d.d)) + (d.ed ? " (Election Day, so far)" : "") + "</td><td class=num>" + num(v[0]) + "</td><td class=num>" + num(v[1]) + "</td><td class=num>" + num(v[2]) + "</td><td class=num>" + num(v[3]) + "</td><td class=num>" + Object.keys(d.c).length + "</td></tr>"; });
    $("dailyTable").innerHTML = t + "</tbody></table>";
  }

  function renderSources() {
    $("srcList").innerHTML =
      "<li>Mail ballots by county and party: <a href='" + esc(B.dash) + "'>Nevada Secretary of State – VIVID dashboard</a> (data file <a href='" + esc(B.mail.url) + "'>ballot-seed.json</a>, " + esc(B.mail.file || "") + "; newest county update " + esc(B.mail.asof) + ").</li>" +
      "<li>In-person voting by county, party and day: same dashboard (data file <a href='" + esc(B.inperson.url) + "'>turnout-seed.json</a>, " + esc(B.inperson.file || "") + "; generated " + esc(B.inperson.asof) + ").</li>" +
      "<li>Active registered voters by county and party: Secretary of State, <a href='" + esc(B.reg.src) + "'>" + esc(B.reg.title) + "</a> (" + esc(B.reg.asof) + "), from <a href='" + esc(B.reg.page) + "'>2026 voter registration statistics</a>.</li>" +
      "<li>County outlines: U.S. Census Bureau cartographic boundaries (us-atlas).</li>" +
      "<li>Last copied by this tracker: " + esc(B.u) + ".</li>";
  }

  function renderAll() { renderStatus(); renderSummary(); renderParty(); renderMap(); renderCountyTable(); renderDaily(); renderSources(); }

  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("[data-c],[data-sort],[data-mode]") : null; if (!t || !B) return;
    if (t.dataset.mode) { ui.mode = t.dataset.mode; renderMap(); }
    else if (t.dataset.sort) {
      var k = t.dataset.sort; if (ui.sort === k) ui.dir = -ui.dir; else { ui.sort = k; ui.dir = k === "n" ? 1 : -1; }
      renderCountyTable(); var b = document.querySelector("[data-sort='" + k + "']"); if (b) b.focus();
    } else if (t.dataset.c) {
      ui.county = t.dataset.c; renderMap(); renderCountyTable();
      if (t.classList.contains("cty")) { var m = $("map"); if (m && m.scrollIntoView) m.scrollIntoView({ block: "center", behavior: "smooth" }); }
    }
  });

  function fetchText(i) {
    if (i >= URLS.length) return Promise.reject(new Error("all data sources failed"));
    var u = URLS[i] + (URLS[i].indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now();
    return fetch(u, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (t) { JSON.parse(t); return t; }).catch(function () { return fetchText(i + 1); });
  }
  function bkey(d) { return d && d.mail ? [d.mail.gen || "", (d.inperson && d.inperson.gen) || ""].sort().pop() : null; }
  function applyBallots(txt) { // returns true if the page now shows different data
    lastErr = null; lastOk = Date.now();
    if (txt === lastText) { renderStatus(); return false; }
    var nd = JSON.parse(txt);
    if (B && nd.mail && B.mail && (nd.mail.gen || "") < (B.mail.gen || "")) { renderStatus(); return false; } // never go back to an older file
    lastText = txt; B = nd; renderAll(); return true;
  }
  function poll() {
    return fetchText(0).then(applyBallots).catch(function (e) { lastErr = e.message; renderStatus(); });
  }
  // Manual refresh: fetch the Pages and raw copies at once and keep whichever has the newer VIVID files.
  function manualRefresh() {
    return window.NVRefresh.fetchAll(URLS).then(function (got) {
      var c = window.NVRefresh.newest(got, bkey);
      if (!c) { lastErr = "all data sources failed"; renderStatus(); throw new Error("couldn't reach the data file"); }
      return applyBallots(c.text);
    });
  }
  var timer = null;
  function schedule() { clearInterval(timer); timer = setInterval(poll, POLL_MS); }
  fetch("geo.json").then(function (r) { return r.json(); }).then(function (g) {
    GEO = g; poll(); schedule();
    setInterval(function () { var a = $("ago"); if (a) a.textContent = "· " + agoText(); }, 15000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });
  }).catch(function (e) { lastErr = "map geometry: " + e.message; renderStatus(); });
  if (window.NVRefresh) window.NVRefresh.init({ run: manualRefresh, reschedule: schedule, asof: function () { return B && B.mail ? "mail " + B.mail.asof + ", in-person " + B.inperson.asof : ""; } });
  window.__nvBallotsPoll = poll;
})();
