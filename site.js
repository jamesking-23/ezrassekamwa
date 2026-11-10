/* Public-site renderer for everything the Site editor controls.
   Site.apply(content) is idempotent: call it as often as you like (cached copy first, then fresh data,
   then live previews from the editor). It only builds DOM nodes with textContent / setAttribute, never innerHTML
   from user text, and it only accepts safe link and image addresses. */
(function () {
  "use strict";
  var D = document, NS = "http://www.w3.org/2000/svg";
  var Site = window.Site = { preview: /[?&]preview=1\b/.test(location.search), latest: null };

  /* ---------- tiny helpers ---------- */
  function q(s, r) { return (r || D).querySelector(s); }
  function qa(s, r) { return [].slice.call((r || D).querySelectorAll(s)); }
  function mk(tag, attrs, kids) {
    var e = D.createElement(tag);
    for (var k in attrs || {}) { var v = attrs[k]; if (v != null && v !== false) e.setAttribute(k, v === true ? "" : v); }
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === "string" ? D.createTextNode(c) : c); });
    return e;
  }
  function str(v) { return typeof v === "string" ? v : ""; }
  function hex(v) { return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : null; }
  function href(u) {
    if (typeof u !== "string") return null; u = u.trim();
    if (/^(https?:\/\/|mailto:|tel:)/i.test(u)) return u;
    if (/^#[\w-]+$/.test(u) || /^[\w\-.\/]+\.html(#[\w-]+)?$/.test(u)) return u;
    return null;
  }
  function img(u) { return window.CMS && CMS.safeImg ? CMS.safeImg(u) : null; }
  function external(u) { try { return /^https?:/i.test(u) && new URL(u, location.href).host !== location.host; } catch (e) { return false; } }
  function rel(a, u, forceNew) {
    if (forceNew === true || (forceNew !== false && external(u))) { a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener"); }
  }

  /* ---------- safe mini-formatting: **bold**, *italic*, [text](link), line breaks ---------- */
  function inline(parent, text) {
    var re = /\*\*([^*]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\(([^)\s]+)\)|\n/g, i = 0, m;
    function t(s) { if (s) parent.appendChild(D.createTextNode(s)); }
    while ((m = re.exec(text))) {
      t(text.slice(i, m.index)); i = re.lastIndex;
      if (m[1] != null) parent.appendChild(mk("strong", {}, [m[1]]));
      else if (m[2] != null) parent.appendChild(mk("em", {}, [m[2]]));
      else if (m[3] != null) {
        var u = href(m[4]);
        if (u) { var a = mk("a", { href: u }, [m[3]]); rel(a, u); parent.appendChild(a); } else t(m[3]);
      } else parent.appendChild(D.createElement("br"));
    }
    t(text.slice(i));
  }
  function fillInline(el, text) { el.textContent = ""; inline(el, str(text)); }
  function fillRich(el, text) {             /* paragraphs on blank lines */
    el.textContent = "";
    str(text).split(/\n{2,}/).forEach(function (p) { if (p.trim()) { var n = mk("p"); inline(n, p.trim()); el.appendChild(n); } });
  }
  Site.rich = { inline: fillInline, block: fillRich };

  /* ---------- 1. built-in text (data-c="a.title" etc.) ---------- */
  var RICH = { "a.text": 1, "c.text": 1, "f.lede": 1 };
  var STRIP = /\s*I treat code the way I treat concrete and steel[\u2014-]as a material to shape, test, and build with\./;   /* sentence the owner removed */
  function applyTexts(c) {
    var m = { a: c.about || {}, c: c.code || {}, f: c.footer || {} };
    qa("[data-c]").forEach(function (el) {
      var key = el.getAttribute("data-c"), p = key.split("."), v = m[p[0]] && m[p[0]][p[1]];
      if (typeof v !== "string") { el.removeAttribute("data-empty"); return; }     /* never set -> keep the page's default */
      v = v.replace(STRIP, "");
      if (el.__v !== v) { el.__v = v; if (RICH[key]) fillInline(el, v); else el.textContent = v; }
      if (v.trim() === "") el.setAttribute("data-empty", ""); else el.removeAttribute("data-empty");
    });
    /* legacy footer links (used when no custom columns are defined) */
    var f = m.f;
    qa("[data-h]").forEach(function (a) {
      var k = a.getAttribute("data-h"), v = f[k], u = null;
      if (typeof v !== "string" || !v.trim()) return;
      if (k === "linkedin") u = /^https?:\/\//i.test(v.trim()) ? v.trim() : null;
      else if (k === "email") u = /^[^\s@<>"]+@[^\s@<>"]+$/.test(v.trim()) ? "mailto:" + v.trim() : null;
      else if (k === "whatsapp") { var d = v.replace(/\D/g, ""); u = d.length >= 7 ? "https://wa.me/" + d : null; }
      if (u) a.setAttribute("href", u);
    });
  }

  /* ---------- 2. footer columns ---------- */
  function arrow(kind) {
    var s = D.createElementNS(NS, "svg");
    s.setAttribute("class", "ft-" + kind); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2.6"); s.setAttribute("stroke-linecap", "square"); s.setAttribute("aria-hidden", "true");
    var p = D.createElementNS(NS, "path"); p.setAttribute("d", kind === "up" ? "M12 20V4M5 11l7-7 7 7" : "M6 18 18 6M8 6h10v10"); s.appendChild(p);
    return s;
  }
  function footerLink(l) {
    if (!l || !str(l.label).trim()) return null;
    var raw = str(l.url).trim(), top = raw === "#top", u = top ? "#top" : href(raw);
    if (!u) return null;
    var a = mk("a", { class: "ft-link" + (top ? " ft-top" : ""), href: u }, [l.label.trim()]);
    if (top) a.setAttribute("data-top", "");
    rel(a, u, l.ext === true ? true : (l.ext === false ? false : undefined));
    if (l.arrow !== false && (top || /^(https?:|mailto:|tel:)/i.test(u))) { a.appendChild(D.createTextNode(" ")); a.appendChild(arrow(top ? "up" : "arr")); }
    return a;
  }
  function applyFooter(c) {
    var f = c.footer || {}, foot = q("#site-footer"), host = foot && q(".ft-cols", foot);
    if (!host) return;
    if (host.__def == null) host.__def = host.innerHTML;
    var cols = Array.isArray(f.cols) && f.cols.length ? f.cols.slice(0, 4) : null, sig = JSON.stringify(cols);
    if (host.__sig !== sig) {
      host.__sig = sig;
      if (!cols) { if (host.__custom) { host.innerHTML = host.__def; host.__custom = false; host.style.removeProperty("--ft-tpl"); } }
      else {
        host.__custom = true; host.textContent = "";
        cols.forEach(function (col, i) {
          var box = mk(i === 0 && /nav/i.test(str(col.title)) ? "nav" : "div", { class: "ft-col" });
          if (str(col.title).trim()) box.appendChild(mk("h3", {}, [col.title.trim()]));
          (Array.isArray(col.links) ? col.links : []).forEach(function (l) { var a = footerLink(l); if (a) box.appendChild(a); });
          host.appendChild(box);
        });
        host.style.setProperty("--ft-tpl", cols.length === 1 ? "1fr" : "2fr" + " repeat(" + (cols.length - 1) + ",1fr)");
      }
    }
    foot.hidden = f.show === false;
  }

  /* ---------- 3. extra sections ("blocks") ---------- */
  var ID_OK = /^[a-z0-9_-]{1,40}$/, ANCHOR_OK = /^[a-z][a-z0-9-]{0,30}$/, RESERVED = /^(about-swap|about-swap-2|site-footer|top|portfolio|main|root)$/;
  function shell(it, extra) {
    var theme = /^(dark|light|cream)$/.test(it.theme) ? it.theme : "dark";
    var s = mk("section", { class: "cb cb--" + theme + " cbt-" + it.type + (extra ? " " + extra : ""), "data-bid": it.id });
    if (typeof it.anchor === "string" && ANCHOR_OK.test(it.anchor) && !RESERVED.test(it.anchor)) s.id = it.anchor;
    if (hex(it.bg)) s.style.setProperty("--cb-bg", it.bg);
    if (hex(it.fg)) s.style.setProperty("--cb-fg", it.fg);
    if (it.show === false) s.hidden = true;
    var inner = mk("div", { class: "cb-inner" }); s.appendChild(inner);
    return [s, inner];
  }
  function label(p, it) { if (str(it.label).trim()) p.appendChild(mk("p", { class: "cb-label" }, [it.label.trim()])); }
  function title(p, it) { if (str(it.title).trim()) p.appendChild(mk("h2", { class: "cb-title" }, [it.title.trim()])); }
  function buttons(p, list) {
    var box = mk("div", { class: "cb-btns" });
    (Array.isArray(list) ? list : []).slice(0, 4).forEach(function (b) {
      var u = href(b && b.url); if (!u || !str(b.label).trim()) return;
      var a = mk("a", { class: "cb-btn", href: u }, [b.label.trim()]); rel(a, u); box.appendChild(a);
    });
    if (box.children.length) p.appendChild(box);
  }
  function block(it) {
    var r, s, inner, n;
    switch (it.type) {
      case "text": {
        r = shell(it, it.layout === "stack" ? "cb-stack" : ""); s = r[0]; inner = r[1]; label(inner, it);
        if (it.layout === "stack") { title(inner, it); }
        else { var g = mk("div", { class: "cb-grid" }); title(g, it); inner.appendChild(g); inner = g; }
        var body = mk("div", { class: "cb-text" }); fillRich(body, it.text);
        if (it.layout === "stack") inner.appendChild(body);
        else { var col = mk("div"); col.appendChild(body); buttons(col, it.buttons); inner.appendChild(col); return s; }
        buttons(inner, it.buttons); return s;
      }
      case "split": {
        r = shell(it); s = r[0]; inner = r[1];
        var wrap = mk("div", { class: "cb-split" + (it.side === "right" ? " is-right" : "") }), im = img(it.image);
        if (im) wrap.appendChild(mk("div", { class: "cb-media" }, [mk("img", { src: im, alt: str(it.image_alt), loading: "lazy", decoding: "async" })]));
        var txt = mk("div"); label(txt, it); title(txt, it);
        if (str(it.text).trim()) { var b2 = mk("div", { class: "cb-text" }); fillRich(b2, it.text); txt.appendChild(b2); }
        buttons(txt, it.buttons); wrap.appendChild(txt); inner.appendChild(wrap); return s;
      }
      case "cards": {
        r = shell(it); s = r[0]; inner = r[1]; label(inner, it); title(inner, it);
        if (str(it.intro).trim()) { var intro = mk("div", { class: "cb-text cb-intro" }); fillRich(intro, it.intro); inner.appendChild(intro); }
        var cols = Math.min(4, Math.max(1, +it.cols || 3)), grid = mk("div", { class: "cb-cards" }); grid.style.setProperty("--cols", cols);
        (Array.isArray(it.cards) ? it.cards : []).slice(0, 24).forEach(function (c) {
          var card = mk("div", { class: "cb-card" }), ci = img(c.image);
          if (ci) card.appendChild(mk("img", { src: ci, alt: "", loading: "lazy", decoding: "async" }));
          if (str(c.title).trim()) card.appendChild(mk("h3", {}, [c.title.trim()]));
          if (str(c.text).trim()) card.appendChild(mk("p", {}, [c.text.trim()]));
          var lu = href(c.url); if (lu) { var a = mk("a", { href: lu }, [str(c.link_label).trim() || "Learn more"]); rel(a, lu); card.appendChild(a); }
          grid.appendChild(card);
        });
        inner.appendChild(grid); return s;
      }
      case "list": {
        r = shell(it); s = r[0]; inner = r[1]; label(inner, it); title(inner, it);
        var ol = mk("ol", { class: "cb-list" });
        (Array.isArray(it.items) ? it.items : []).slice(0, 40).forEach(function (x, i) {
          ol.appendChild(mk("li", {}, [mk("span", { class: "n" }, [str(x.num).trim() || (i < 9 ? "0" : "") + (i + 1)]), mk("span", { class: "t" }, [str(x.title)]), mk("span", { class: "d" }, [str(x.text)])]));
        });
        inner.appendChild(ol); return s;
      }
      case "stats": {
        r = shell(it); s = r[0]; inner = r[1]; label(inner, it); title(inner, it);
        var st = mk("div", { class: "cb-stats" });
        (Array.isArray(it.items) ? it.items : []).slice(0, 12).forEach(function (x) { st.appendChild(mk("div", {}, [mk("b", {}, [str(x.value)]), mk("span", {}, [str(x.label)])])); });
        inner.appendChild(st); return s;
      }
      case "quote": {
        r = shell(it); s = r[0]; inner = r[1]; label(inner, it);
        var bq = mk("blockquote"); inline(bq, str(it.text)); var qw = mk("div", { class: "cb-quote" }, [bq]);
        if (str(it.author).trim()) qw.appendChild(mk("cite", {}, [it.author.trim()]));
        inner.appendChild(qw); return s;
      }
      case "gallery": {
        r = shell(it); s = r[0]; inner = r[1]; label(inner, it); title(inner, it);
        var gl = mk("div", { class: "cb-gallery" }); gl.style.setProperty("--cols", Math.min(5, Math.max(1, +it.cols || 3)));
        (Array.isArray(it.images) ? it.images : []).slice(0, 36).forEach(function (x) {
          var u = img(x.url); if (!u) return;
          var f = mk("figure", {}, [mk("img", { src: u, alt: str(x.caption), loading: "lazy", decoding: "async" })]);
          if (str(x.caption).trim()) f.appendChild(mk("figcaption", {}, [x.caption.trim()])); gl.appendChild(f);
        });
        inner.appendChild(gl); return s;
      }
      case "spacer": {
        r = shell(it); s = r[0]; s.style.height = Math.min(400, Math.max(8, +it.height || 64)) + "px"; s.removeChild(r[1]); return s;
      }
    }
    return null;
  }
  function blockEl(it) {
    if (!it || !ID_OK.test(str(it.id))) return null;
    var el = q('.cb[data-bid="' + it.id + '"]'), sig = JSON.stringify(it);
    if (el && el.__sig === sig) return el;
    var n = block(it);
    if (!n) return el;
    n.__sig = sig;
    if (el) el.replaceWith(n);
    return n;
  }
  function layoutItems(c) {
    var L = c.layout && Array.isArray(c.layout.items) ? c.layout.items : [], seen = {}, out = [];
    L.forEach(function (it) { if (it && typeof it.id === "string" && !seen[it.id]) { seen[it.id] = 1; out.push(it); } });
    [{ id: "about", type: "about" }, { id: "code", type: "code" }].forEach(function (d) { if (!seen[d.id]) out.push(d); });
    return out;
  }
  function applyLayout(c) {
    var foot = q("#site-footer"); if (!foot) return;
    var parent = foot.parentNode, wanted = [];
    layoutItems(c).forEach(function (it) {
      var el = it.type === "about" ? q("#about-swap") : it.type === "code" ? q("#about-swap-2") : blockEl(it);
      if (!el) return;
      if (it.type === "about" || it.type === "code") el.hidden = it.show === false;
      wanted.push(el);
    });
    qa(".cb[data-bid]").forEach(function (e) { if (wanted.indexOf(e) < 0) e.remove(); });
    var cur = [].slice.call(parent.children).filter(function (e) { return wanted.indexOf(e) >= 0; });
    var same = cur.length === wanted.length && cur.every(function (e, i) { return e === wanted[i]; });
    if (!same) wanted.forEach(function (e) { parent.insertBefore(e, foot); });
  }

  /* ---------- 4. hero bits, settings, theme, motion ---------- */
  function applyHero(c) {
    var h = c.hero || {};
    var a = q('[data-framer-name="LinkedIn image link"]:not([data-own])');
    if (a && typeof h.linkedin === "string" && /^https?:\/\//i.test(h.linkedin.trim())) a.setAttribute("href", h.linkedin.trim());
    var im = q('[data-framer-name="Portrait introduction"] img');
    if (im && str(h.alt).trim()) im.setAttribute("alt", h.alt.trim());
  }
  function applySettings(c) {
    var s = c.settings || {};
    if (str(s.title).trim()) D.title = s.title.trim();
    if (str(s.description).trim()) {
      var m = q('meta[name="description"]'); if (!m) { m = mk("meta", { name: "description" }); D.head.appendChild(m); }
      m.setAttribute("content", s.description.trim());
    }
    var fi = img(s.favicon);
    if (fi) {
      var l = q('link[rel="icon"]'); if (!l) { l = mk("link", { rel: "icon" }); D.head.appendChild(l); }
      l.setAttribute("href", fi); l.removeAttribute("type");
    }
  }
  function mix(c, p) { return "color-mix(in srgb," + c + " " + p + "%,transparent)"; }
  function applyTheme(c) {
    var s = c.settings || {}, t = s.theme || {}, css = "", no = [], m = s.motion || {};
    var ab = hex(t.about_bg), af = hex(t.about_fg), cb = hex(t.code_bg), cf = hex(t.code_fg), fb = hex(t.footer_bg), ff = hex(t.footer_fg);
    function sect(id, bg, fg, titleSel, textSel, labelSel) {
      if (bg) css += id + "{background:" + bg + "!important}";
      if (fg) css += id + "{color:" + fg + "}" + id + " " + titleSel + "{color:" + fg + "}" + id + " " + textSel + "{color:" + mix(fg, 72) + "}" + id + " " + labelSel + "{color:" + mix(fg, 55) + "}";
    }
    sect("#about-swap", ab, af, ".ab-title,.ab-script", ".ab-text", ".ab-label");
    if (ab) css += "#about-swap{box-shadow:0 12px 0 0 " + ab + "!important}";
    sect("#about-swap-2", cb, cf, ".ab-title,.ab-script", ".ab-text", ".ab-label");
    if (cb) {
      var k = function (a) { return mix(cb, a); };
      css += "#about-swap-2::before{background:radial-gradient(circle 70px at 12% 62%," + k(95) + " 0," + k(0) + " 100%),radial-gradient(circle 90px at 30% 70%," + k(92) + " 0," + k(0) + " 100%),radial-gradient(circle 80px at 52% 60%," + k(95) + " 0," + k(0) + " 100%),radial-gradient(circle 100px at 72% 72%," + k(90) + " 0," + k(0) + " 100%),radial-gradient(circle 70px at 90% 64%," + k(95) + " 0," + k(0) + " 100%),linear-gradient(to bottom," + k(0) + " 0," + k(70) + " 22%," + cb + " 46%," + cb + " 100%)!important}";
      if (cb.toLowerCase() !== "#ffffff") no.push("climb");   /* the overlap effect only looks right on white */
    }
    if (fb) css += "#site-footer{--ft-bg:" + fb + "}";
    if (ff) css += "#site-footer{color:" + ff + "}#site-footer .ft-link,#site-footer h2{color:" + ff + "}#site-footer h3,#site-footer .ft-bottom{color:" + mix(ff, 62) + "}#site-footer .ft-lede{color:" + mix(ff, 74) + "}";
    var st = D.getElementById("site-theme");
    if (!st) { st = mk("style", { id: "site-theme" }); D.head.appendChild(st); }
    if (st.textContent !== css) { st.textContent = css; window.dispatchEvent(new Event("ft-theme")); }
    if (m.entrance === false) no.push("entrance");
    if (m.reveal === false) no.push("reveal");
    if (m.wave === false) no.push("wave");
    if (m.climb === false && no.indexOf("climb") < 0) no.push("climb");
    var v = no.join(" "); if ((D.documentElement.getAttribute("data-no") || "") !== v) { v ? D.documentElement.setAttribute("data-no", v) : D.documentElement.removeAttribute("data-no"); window.dispatchEvent(new Event("ft-theme")); }
  }

  /* ---------- apply everything ---------- */
  function ready() { return !!(q("#about-swap") && q("#site-footer")); }
  Site.apply = function (c, fromPreview) {
    if (!c || typeof c !== "object") return;
    if (Site.preview && !fromPreview) return;           /* inside the editor, only the editor's own data counts */
    Site.latest = c;
    applyTheme(c); applySettings(c);
    if (!ready()) { retry(); return; }
    applyFooter(c); applyTexts(c); applyLayout(c); applyHero(c);
    D.dispatchEvent(new Event("site-applied"));
  };
  var tries = 0, timer = 0;
  function retry() {
    if (timer || tries > 80) return;
    timer = setTimeout(function () { timer = 0; tries++; if (Site.latest) Site.apply(Site.latest, true); }, 250);
  }
  /* Framer re-renders parts of the hero now and then: re-assert the few attributes we own */
  [1500, 4000, 9000].forEach(function (ms) { setTimeout(function () { if (Site.latest && ready()) applyHero(Site.latest); }, ms); });
  D.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[data-top]");
    if (a) { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });

  /* live preview from the editor (same origin only) */
  if (Site.preview) {
    window.addEventListener("message", function (e) {
      if (e.origin !== location.origin) return;
      var d = e.data;
      if (d && d.ezra === "content" && d.content) Site.apply(d.content, true);
    });
    var hello = function () { try { parent.postMessage({ ezra: "ready" }, location.origin); } catch (x) {} };
    D.addEventListener("DOMContentLoaded", hello); window.addEventListener("load", hello);
  }
})();
