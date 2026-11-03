/* Zoom & pan for the site's SVG maps. Plain JS, no dependencies.
   Desktop: Ctrl/Cmd + scroll (or trackpad pinch) zooms at the cursor; after clicking a map, plain scroll zooms it too
   until the pointer leaves. Drag to pan when zoomed. Double-click zooms in. Buttons: + / - / reset.
   Keyboard (map focused): + / - zoom, arrows pan, 0 resets, Esc leaves scroll-zoom mode.
   Touch: two fingers pinch-zoom and pan; one finger scrolls the page at 1x and pans the map once zoomed in.
   Strokes stay a constant width (vector-effect) and labels keep their on-screen size. */
(function () {
  "use strict";
  var MAPS = [["map", "Nevada county map", 6], ["wardMap", "Reno ward map", 8], ["precinctMap", "Reno precinct map", 12]];
  var ST = {};
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function setup(id, label, maxZ) {
    var el = document.getElementById(id);
    if (!el || el.parentNode.classList.contains("zwrap")) return;
    var w = document.createElement("div");
    w.className = "zwrap zwrap-" + id;
    el.parentNode.insertBefore(w, el); w.appendChild(el);
    w.setAttribute("tabindex", "0"); w.setAttribute("role", "group");
    w.setAttribute("aria-label", label + ". Zoom with the buttons, Ctrl or Command plus scroll, pinch, or the + and - keys; pan with the arrow keys or by dragging.");
    var ctl = document.createElement("div"); ctl.className = "zctl";
    ctl.innerHTML = "<button type=button class=zin aria-label='Zoom in' title='Zoom in'>+</button>" +
      "<button type=button class=zout aria-label='Zoom out' title='Zoom out'>\u2212</button>" +
      "<button type=button class=zreset aria-label='Reset zoom' title='Reset zoom'>\u27F2</button>";
    w.appendChild(ctl);
    var hint = document.createElement("div"); hint.className = "zhint"; hint.setAttribute("aria-hidden", "true"); w.appendChild(hint);
    var info = document.createElement("p"); info.className = "zinfo note"; info.setAttribute("aria-live", "polite");
    if (id !== "map") w.parentNode.insertBefore(info, w.nextSibling);
    var s = ST[id] = { s: 1, tx: 0, ty: 0, max: maxZ, el: el, w: w, ctl: ctl, hint: hint, info: info, active: false, moved: false };

    function svg() { return el.querySelector("svg"); }
    function vb() { var v = svg().viewBox.baseVal; return [v.x, v.y, v.width, v.height]; }
    function toSvg(cx, cy) {
      var sv = svg(), m = sv.getScreenCTM(); if (!m) return null;
      var p = sv.createSVGPoint(); p.x = cx; p.y = cy; return p.matrixTransform(m.inverse());
    }
    function unitsPerPx() { var sv = svg(), m = sv && sv.getScreenCTM(); return m && m.a ? 1 / m.a : 1; }
    function zoomAt(nz, px, py) {
      if (!svg()) return;
      hint.classList.remove("on");
      var v = vb(); nz = clamp(nz, 1, s.max);
      if (px == null) { px = v[0] + v[2] / 2; py = v[1] + v[3] / 2; }
      s.tx = px - (px - s.tx) * (nz / s.s); s.ty = py - (py - s.ty) * (nz / s.s); s.s = nz; apply();
    }
    function panBy(dx, dy) { s.tx += dx; s.ty += dy; apply(); }
    s.reset = function () { s.s = 1; s.tx = 0; s.ty = 0; apply(); };
    // hide context labels that would overlap a higher-priority label (ward labels > places > roads > parks > precinct numbers)
    function declutter(g) {
      if (!g.querySelector("text[data-p]")) return;
      var items = [];
      g.querySelectorAll("text").forEach(function (t) { if (t.style.display !== "none") items.push([+(t.dataset.p || 0), t]); });
      items.sort(function (a, b) { return a[0] - b[0]; });
      var rects = items.map(function (it) { return it[1].getBoundingClientRect(); }), kept = [];
      items.forEach(function (it, i) {
        var r = rects[i], pad = 1.5, hit = false;
        if (it[0] > 0) for (var j = 0; j < kept.length && !hit; j++) {
          var q = kept[j]; hit = r.left - pad < q.right && r.right + pad > q.left && r.top - pad < q.bottom && r.bottom + pad > q.top;
        }
        if (hit) it[1].style.display = "none"; else kept.push(r);
      });
    }
    function apply() {
      var sv = svg(); if (!sv) return;
      var g = sv.querySelector("g.zg");
      if (!g) {
        g = document.createElementNS("http://www.w3.org/2000/svg", "g"); g.setAttribute("class", "zg");
        while (sv.firstChild) g.appendChild(sv.firstChild);
        sv.appendChild(g);
        g.querySelectorAll("text").forEach(function (t) {
          var cs = getComputedStyle(t); t.dataset.fs = parseFloat(cs.fontSize) || 8; t.dataset.sw = parseFloat(cs.strokeWidth) || 0;
        });
      }
      var v = vb(), z = s.s;
      // keep the map covering its frame: no panning past the edges
      s.tx = clamp(s.tx, v[0] + v[2] - z * (v[0] + v[2]), v[0] - z * v[0]);
      s.ty = clamp(s.ty, v[1] + v[3] - z * (v[1] + v[3]), v[1] - z * v[1]);
      if (z === 1) { s.tx = 0; s.ty = 0; }
      g.setAttribute("transform", "translate(" + s.tx.toFixed(3) + " " + s.ty.toFixed(3) + ") scale(" + z.toFixed(4) + ")");
      var ppu = (sv.getBoundingClientRect().width || 300) / v[2] * z;   // screen px per map unit at this zoom
      g.querySelectorAll("text").forEach(function (t) {
        t.style.fontSize = (t.dataset.fs / z) + "px";
        if (+t.dataset.sw) t.style.strokeWidth = (t.dataset.sw / z) + "px";
        // declutter: context labels appear only when zoomed in enough (data-minz), precinct numbers only when they fit (data-r)
        var show = true;
        if (t.dataset.minz) show = z >= +t.dataset.minz - 1e-6;
        if (t.dataset.r) show = +t.dataset.r * ppu >= 3 + 2.6 * t.textContent.length;
        t.style.display = show ? "" : "none";
      });
      declutter(g);
      w.classList.toggle("zoomed", z > 1);
      ctl.querySelector(".zin").disabled = z >= s.max - 1e-6;
      ctl.querySelector(".zout").disabled = z <= 1;
      ctl.querySelector(".zreset").disabled = z <= 1;
    }
    s.apply = apply;
    var hintT;
    function showHint(txt) {
      hint.textContent = txt; hint.classList.add("on");
      clearTimeout(hintT); hintT = setTimeout(function () { hint.classList.remove("on"); }, 1600);
    }
    var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

    ctl.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      e.stopPropagation();
      if (b.classList.contains("zin")) zoomAt(s.s * 1.6);
      else if (b.classList.contains("zout")) zoomAt(s.s / 1.6);
      else s.reset();
    });
    // wheel: only with Ctrl/Cmd (trackpad pinch sends ctrlKey), or after the user clicked into this map
    w.addEventListener("wheel", function (e) {
      if (e.target.closest(".zctl")) return;
      if (!(e.ctrlKey || e.metaKey || s.active)) {
        showHint((mac ? "\u2318" : "Ctrl") + " + scroll to zoom, or click the map first");
        return;
      }
      e.preventDefault();
      var p = toSvg(e.clientX, e.clientY); if (!p) return;
      var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      // mouse-wheel notches (large deltas) step by 1.25x; trackpad pinch/scroll (small deltas) zooms smoothly
      var f = Math.abs(dy) >= 40 ? Math.pow(1.25, dy > 0 ? -1 : 1) : Math.exp(-dy * 0.01);
      zoomAt(s.s * f, p.x, p.y);
    }, { passive: false });
    w.addEventListener("mouseleave", function () { s.active = false; w.classList.remove("zactive"); });
    // Safari desktop trackpad pinch
    var gz = 1;
    w.addEventListener("gesturestart", function (e) { e.preventDefault(); gz = s.s; });
    w.addEventListener("gesturechange", function (e) {
      e.preventDefault(); var p = toSvg(e.clientX, e.clientY);
      zoomAt(gz * e.scale, p && p.x, p && p.y);
    });
    // mouse drag to pan
    var drag = null;
    w.addEventListener("mousedown", function (e) {
      if (e.button !== 0 || e.target.closest(".zctl")) return;
      s.active = true; w.classList.add("zactive");
      drag = { x: e.clientX, y: e.clientY, tx: s.tx, ty: s.ty, u: unitsPerPx() }; s.moved = false;
    });
    window.addEventListener("mousemove", function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!s.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      if (s.s <= 1) return;
      s.moved = true; w.classList.add("dragging");
      s.tx = drag.tx + dx * drag.u; s.ty = drag.ty + dy * drag.u; apply(); e.preventDefault();
    });
    window.addEventListener("mouseup", function () { drag = null; w.classList.remove("dragging"); });
    w.addEventListener("dblclick", function (e) {
      if (e.target.closest(".zctl")) return;
      var p = toSvg(e.clientX, e.clientY); if (p) zoomAt(s.s * (e.shiftKey ? 1 / 2 : 2), p.x, p.y);
    });
    // a drag or pinch must not count as a click on a county/precinct
    w.addEventListener("click", function (e) {
      if (s.moved) { e.stopPropagation(); e.preventDefault(); s.moved = false; return; }
      // tap/click details for shapes that only have a <title> (wards, precincts)
      var path = e.target.closest && e.target.closest("path");
      if (path && id !== "map") { var t = path.querySelector("title"); if (t) info.textContent = t.textContent; }
    }, true);
    // touch: 2 fingers = pinch/pan; 1 finger pans only when zoomed in (otherwise the page scrolls)
    var tch = null;
    function tinfo(ts) {
      if (ts.length >= 2) {
        var a = ts[0], b = ts[1];
        return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2, d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), n: 2 };
      }
      return { x: ts[0].clientX, y: ts[0].clientY, d: 0, n: 1 };
    }
    w.addEventListener("touchstart", function (e) {
      if (e.target.closest(".zctl")) return;
      var t = tinfo(e.touches); tch = { start: t, last: t, z: s.s, u: unitsPerPx() }; s.moved = false;
    }, { passive: true });
    w.addEventListener("touchmove", function (e) {
      if (!tch) return;
      var t = tinfo(e.touches);
      if (t.n !== tch.last.n) { tch = { start: t, last: t, z: s.s, u: unitsPerPx() }; }
      if (t.n === 1 && s.s <= 1) return; // let the page scroll
      if (e.cancelable) e.preventDefault(); else return;
      if (t.n === 2 && tch.start.d > 0) {
        var p = toSvg(t.x, t.y);
        var nz = clamp(tch.z * t.d / tch.start.d, 1, s.max);
        if (p) zoomAt(nz, p.x, p.y);
      }
      var u = unitsPerPx();
      panBy((t.x - tch.last.x) * u, (t.y - tch.last.y) * u);
      if (Math.abs(t.x - tch.start.x) + Math.abs(t.y - tch.start.y) > 8 || t.n === 2) s.moved = true;
      tch.last = t;
    }, { passive: false });
    w.addEventListener("touchend", function (e) {
      if (!e.touches.length) { tch = null; setTimeout(function () { s.moved = false; }, 400); }
      else { var t = tinfo(e.touches); tch = { start: t, last: t, z: s.s, u: unitsPerPx() }; }
    });
    // keyboard
    w.addEventListener("keydown", function (e) {
      if (e.target !== w) return;
      var k = e.key, step = 30 * unitsPerPx();
      if (k === "+" || k === "=") zoomAt(s.s * 1.6);
      else if (k === "-" || k === "_") zoomAt(s.s / 1.6);
      else if (k === "0") s.reset();
      else if (k === "Escape") { s.active = false; w.classList.remove("zactive"); return; }
      else if (s.s > 1 && k === "ArrowLeft") panBy(step, 0);
      else if (s.s > 1 && k === "ArrowRight") panBy(-step, 0);
      else if (s.s > 1 && k === "ArrowUp") panBy(0, step);
      else if (s.s > 1 && k === "ArrowDown") panBy(0, -step);
      else return;
      e.preventDefault();
    });
    // the app re-renders the map's SVG on each data refresh: re-apply the current zoom to the new SVG
    new MutationObserver(function () { apply(); }).observe(el, { childList: true });
    window.addEventListener("resize", function () { apply(); });
    apply();
  }
  function init() { MAPS.forEach(function (m) { setup(m[0], m[1], m[2]); }); }
  window.NVZoom = { state: ST, init: init };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
