/* Manual "Refresh" button shared by index.html and ballots.html. Plain JS, no dependencies.
   It re-fetches what this site has published (data/*.json, plus the raw.githubusercontent.com copy, keeping whichever
   is newer); it does not contact the Secretary of State directly. The page supplies run() and asof(). */
(function () {
  "use strict";
  var COOLDOWN_MS = 3000;
  // Fetch every URL at once (cache-busted, no-store) and return the parsed copies that loaded, in URL order.
  function fetchAll(urls) {
    return Promise.all(urls.map(function (u) {
      var url = u + (u.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now();
      return fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
        .then(function (t) { return { text: t, data: JSON.parse(t), url: u }; }).catch(function () { return null; });
    })).then(function (rs) { return rs.filter(Boolean); });
  }
  // Pick the newest copy by key(data) (string or number); ties go to the earliest URL (the Pages copy).
  function newest(copies, key) {
    var best = null;
    copies.forEach(function (c) { var k = key(c.data); if (k == null) return; if (!best || k > best.k) best = { k: k, c: c }; });
    return best ? best.c : (copies[0] || null);
  }
  function init(opts) {
    var btn = document.getElementById("refreshBtn"), msg = document.getElementById("refreshMsg");
    if (!btn || !msg) return;
    var busy = false, last = 0;
    function say(t, cls) { msg.className = "rmsg" + (cls ? " " + cls : ""); msg.textContent = t; }
    btn.addEventListener("click", function () {
      if (busy || Date.now() - last < COOLDOWN_MS) return; // debounce repeated taps
      busy = true; btn.disabled = true; btn.classList.add("busy"); btn.setAttribute("aria-busy", "true"); say("Refreshing…");
      var t0 = Date.now();
      Promise.resolve().then(opts.run).then(function (changed) {
        var a = opts.asof();
        say((changed ? "Updated just now" : "Already up to date") + (a ? " · data as of " + a : ""), "ok");
      }, function (e) {
        say("Couldn't refresh (" + ((e && e.message) || "network error") + "). Showing the data already loaded.", "err");
      }).then(function () {
        // keep the spinner visible briefly so a fast fetch still registers
        setTimeout(function () { busy = false; last = Date.now(); btn.disabled = false; btn.classList.remove("busy"); btn.removeAttribute("aria-busy"); }, Math.max(0, 400 - (Date.now() - t0)));
        if (opts.reschedule) opts.reschedule();
      });
    });
  }
  window.NVRefresh = { init: init, fetchAll: fetchAll, newest: newest };
})();
