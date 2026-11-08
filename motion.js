/* MOTION LAYER — behaviour only. Reveals existing sections as they scroll into view.
   It never creates, moves or restyles anything: it tags existing elements with data-mo
   (see motion.css) and removes the tag again when the transition has finished. */
(function () {
  "use strict";
  if (!("IntersectionObserver" in window)) return;       // old browser: leave everything visible

  // Which existing elements reveal, in what order. [selector, kind, delay ms, per-item stagger ms]
  var GROUPS = [
    { sel: "#about-swap",   items: [[".ab-label", "q", 0], [".ab-title", "h", 120], [".ab-text", "p", 260]] },
    { sel: "#about-swap-2", items: [[".ab-label", "q", 0], [".ab-title", "h", 120], [".ab-text", "p", 260],
                                    [".ab-caps li", "c", 440, 100]] },
    { sel: "#site-footer",  items: [[".ft-intro h2", "h", 0], [".ft-lede", "p", 240],
                                    [".ft-cols .ft-col", "c", 460, 160], [".ft-bottom", "q", 980]] }
  ];

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      reveal(e.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });

  function clean(el) {
    el.removeAttribute("data-mo");
    el.removeAttribute("data-mo-k");
    el.style.removeProperty("--mo-d");
  }

  function reveal(sec) {
    var els = sec.querySelectorAll('[data-mo="pre"]');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {                 // 2 frames: guarantees the hidden state was painted
        els.forEach(function (el) {
          el.setAttribute("data-mo", "in");
          var done = false;
          function fin() { if (done) return; done = true; el.removeEventListener("transitionend", onEnd); clean(el); }
          function onEnd(ev) { if (ev.target === el && ev.propertyName === "opacity") fin(); }
          el.addEventListener("transitionend", onEnd);
          setTimeout(fin, 3200);                         // safety net
        });
      });
    });
  }

  function prep(g) {
    var sec = document.querySelector(g.sel);
    if (!sec || sec.__mo) return;
    sec.__mo = 1;
    if (sec.getBoundingClientRect().bottom < 0) return;   // already scrolled past (e.g. reload mid-page): no replay
    try {
      g.items.forEach(function (it) {
        sec.querySelectorAll(it[0]).forEach(function (el, i) {
          el.setAttribute("data-mo", "pre");
          el.setAttribute("data-mo-k", it[1]);
          el.style.setProperty("--mo-d", (it[2] + (it[3] || 0) * i) + "ms");
        });
      });
      io.observe(sec);
    } catch (err) {                                       // never leave anything hidden if something goes wrong
      sec.querySelectorAll("[data-mo]").forEach(clean);
    }
  }

  function scan() { GROUPS.forEach(prep); }

  // The sections are injected after Framer hydrates, so watch for them (cheap id lookups).
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  scan();
  document.addEventListener("DOMContentLoaded", scan);
  window.addEventListener("load", scan);
})();
