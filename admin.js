/* Site editor. Everything the public site shows can be changed here; nothing needs code.
   Data model (table site_content, one row per key): about, code, footer, hero, settings, layout, resume.
   Photos live in their own table. Every publish keeps the previous version (see History). */
(function () {
  "use strict";
  var $ = function (i) { return document.getElementById(i); };
  var SK = "ezra_admin_session", S = null;
  var KEYS = ["about", "code", "footer", "hero", "settings", "layout", "resume"];
  var content = {}, saved = {}, photos = [], savedPhotos = "[]", dbIds = [];
  var OPEN = new WeakSet();                       // list items the user has expanded (kept across redraws)

  /* =============================== helpers =============================== */
  function E(tag, a, kids) {
    var e = document.createElement(tag);
    for (var k in a || {}) { var v = a[k]; if (v != null && v !== false) e.setAttribute(k, v === true ? "" : v); }
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function uuid() { return crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); }); }
  function rid() { return "b" + Math.random().toString(36).slice(2, 8); }
  function say(id, m, ok) { var n = $(id); if (!n) return; n.textContent = m || ""; n.className = "msg" + (m ? (ok ? " ok" : " err") : ""); }
  var toastT;
  function toast(m) { [].forEach.call(document.querySelectorAll(".toast"), function (x) { x.remove(); }); var t = E("div", { class: "toast" }, [m]); document.body.appendChild(t); clearTimeout(toastT); toastT = setTimeout(function () { t.remove(); }, 2600); }
  function okLink(u) { return typeof u === "string" && /^(https?:\/\/\S+|mailto:\S+@\S+|tel:[\d+\-\s()]+|#top|#[\w-]+|[\w\-.\/]+\.html(#[\w-]+)?)$/i.test(u.trim()); }
  function hex6(v) { return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v); }
  function lum(h) { var c = [1, 3, 5].map(function (i) { var v = parseInt(h.substr(i, 2), 16) / 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
  function when(iso) { try { return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); } catch (e) { return iso; } }

  /* =============================== auth =============================== */
  function persist() { try { localStorage.setItem(SK, JSON.stringify(S)); } catch (e) {} }
  function setSession(r) { S = { access: r.access_token, refresh: r.refresh_token, exp: Date.now() + (r.expires_in || 3600) * 1000 - 60000 }; persist(); }
  function token() {
    if (S && Date.now() < S.exp) return Promise.resolve(S.access);
    if (!S) return Promise.reject(new Error("Signed out"));
    return CMS.json("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: S.refresh }) }).then(function (r) { setSession(r); return S.access; });
  }
  function authed(path, o) { return token().then(function (t) { o = o || {}; o.token = t; return CMS.json(path, o); }); }
  function signOut() { S = null; try { localStorage.removeItem(SK); } catch (e) {} location.reload(); }
  function show(id) { ["login", "app", "deny"].forEach(function (x) { $(x).classList.toggle("hide", x !== id); }); }
  $("lf").addEventListener("submit", function (e) {
    e.preventDefault(); say("lmsg", "");
    CMS.json("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email: $("em").value.trim(), password: $("pw").value }) })
      .then(function (r) { setSession(r); $("pw").value = ""; boot(); })
      .catch(function (er) { say("lmsg", /invalid/i.test(er.message) ? "Wrong email or password." : er.message); });
  });
  $("out").onclick = $("out2").onclick = signOut;

  /* =============================== uploads =============================== */
  function resize(file, max) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var s = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement("canvas"), png = file.type === "image/png";
        c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
        c.toBlob(function (b) { b ? res({ blob: b, type: png ? "image/png" : "image/jpeg", ext: png ? "png" : "jpg" }) : rej(new Error("Could not process image")); }, png ? "image/png" : "image/jpeg", .86);
      };
      im.onerror = function () { rej(new Error("That file is not a readable image")); };
      im.src = u;
    });
  }
  function putFile(blob, ext, type) {
    var name = uuid() + "." + ext;
    return token().then(function (t) {
      return CMS.api("/storage/v1/object/site-media/" + name, { method: "POST", token: t, body: blob, timeout: 90000, headers: { "Content-Type": type, "x-upsert": "false" } });
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (x) { throw new Error("Upload failed: " + x); });
      return CMS.PUB + name;
    });
  }
  function uploadImage(file, max) {
    if (file.type === "image/gif" || file.type === "image/avif") {
      if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error("That file is over 8 MB"));
      return putFile(file, file.type === "image/gif" ? "gif" : "avif", file.type);
    }
    return resize(file, max || 1600).then(function (r) { return putFile(r.blob, r.ext, r.type); });
  }
  function uploadPdf(file) {
    if (file.type !== "application/pdf") return Promise.reject(new Error("Please choose a PDF file"));
    if (file.size > 9 * 1024 * 1024) return Promise.reject(new Error("The PDF is over 9 MB"));
    return putFile(file, "pdf", "application/pdf");
  }
  function mediaList() {
    return authed("/storage/v1/object/list/site-media", { method: "POST", body: JSON.stringify({ prefix: "", limit: 300, offset: 0, sortBy: { column: "created_at", order: "desc" } }) })
      .then(function (a) { return (a || []).filter(function (f) { return f && f.id; }); });
  }

  /* =============================== modal =============================== */
  function modal(nodes, wide) {
    var box = $("modalBox"); box.textContent = ""; box.className = "box" + (wide ? " wide" : "");
    nodes.forEach(function (n) { box.appendChild(n); }); $("modal").classList.remove("hide");
    return function close() { $("modal").classList.add("hide"); box.textContent = ""; };
  }
  $("modal").addEventListener("mousedown", function (e) { if (e.target === $("modal")) $("modal").classList.add("hide"); });

  /* =============================== change tracking + preview =============================== */
  var pvReady = false, pvT;
  function snapshot(k) { return JSON.stringify(content[k] === undefined ? null : content[k]); }
  function photoSig() { return JSON.stringify(photos.map(function (p) { return [p.id, p.url, p.caption, +p.focus_x, +p.focus_y, +p.zoom]; })); }
  function dirtyKeys() {
    var d = KEYS.filter(function (k) { return snapshot(k) !== saved[k]; });
    if (photoSig() !== savedPhotos) d.push("photos");
    return d;
  }
  var NAMES = { about: "About", code: "Section 02", footer: "Footer", hero: "Hero", settings: "Site settings", layout: "Sections", resume: "Résumé", photos: "Photos" };
  var TAB_OF = { about: "sections", code: "sections", layout: "sections", footer: "footer", hero: "hero", photos: "hero", resume: "resume", settings: "settings" };
  function refreshBar() {
    var d = dirtyKeys(), st = $("st");
    st.className = "st" + (d.length ? " dirty" : "");
    st.textContent = d.length ? d.length + " unsaved change" + (d.length > 1 ? "s" : "") : "Everything is published";
    if (d.length) st.appendChild(E("small", {}, [d.map(function (k) { return NAMES[k] || k; }).join(" · ")]));
    $("publish").disabled = $("discard").disabled = !d.length;
    var tabs = {}; d.forEach(function (k) { tabs[TAB_OF[k]] = 1; });
    [].forEach.call($("nav").querySelectorAll("button"), function (b) { var dot = b.querySelector(".dot"); if (dot) dot.classList.toggle("hide", !tabs[b.dataset.tab]); });
  }
  function changed() { refreshBar(); clearTimeout(pvT); pvT = setTimeout(postPreview, 180); }
  function postPreview() {
    if (!pvReady) return;
    var c = clone(content); delete c.resume;
    try { $("pv").contentWindow.postMessage({ ezra: "content", content: c }, location.origin); } catch (e) {}
  }
  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.ezra === "ready") { pvReady = true; postPreview(); }
  });
  window.addEventListener("beforeunload", function (e) { if (dirtyKeys().length) { e.preventDefault(); e.returnValue = ""; } });

  /* =============================== form builders =============================== */
  /* F(obj, key, spec): a labelled control bound to obj[key].
     spec.type: text | area | url | num | slug | check | select | color | image | pdf */
  function F(obj, key, s) {
    s = s || {};
    var w = E("div", { class: "fld" + (s.type === "check" ? " chk" : "") + (s.cls ? " " + s.cls : "") }), t = s.type || "text", ctl;
    var lab = E("label", {}, [s.type === "check" ? "" : (s.label || key)]);
    function set(v) { if (v === undefined) delete obj[key]; else obj[key] = v; changed(); if (s.after) s.after(); }
    if (t === "check") {
      ctl = E("input", { type: "checkbox" }); ctl.checked = obj[key] == null ? s.def !== false : !!obj[key];
      ctl.onchange = function () { set(ctl.checked); };
      lab.appendChild(ctl); lab.appendChild(document.createTextNode(s.label || key)); w.appendChild(lab);
    } else if (t === "select") {
      ctl = E("select"); (s.opts || []).forEach(function (o) { ctl.appendChild(E("option", { value: o[0] }, [o[1]])); });
      ctl.value = obj[key] == null ? (s.def != null ? s.def : s.opts[0][0]) : obj[key];
      ctl.onchange = function () { set(isNaN(+ctl.value) || ctl.value === "" ? ctl.value : +ctl.value); };
      w.appendChild(lab); w.appendChild(ctl);
    } else if (t === "color") {
      var cw = E("div", { class: "colfld" }), pick = E("input", { type: "color" }), tx = E("input", { type: "text", placeholder: "default", maxlength: 7 });
      var rs = E("button", { class: "btn sec sm", type: "button" }, ["Default"]);
      function sync() { var v = obj[key]; pick.value = hex6(v) ? v : (s.def || "#ffffff"); tx.value = hex6(v) ? v : ""; tx.classList.toggle("bad", !!tx.value && !hex6(tx.value)); }
      pick.oninput = function () { obj[key] = pick.value; tx.value = pick.value; tx.classList.remove("bad"); changed(); if (s.after) s.after(); };
      tx.oninput = function () { var v = tx.value.trim(); if (v === "") { delete obj[key]; tx.classList.remove("bad"); } else if (hex6(v)) { obj[key] = v; pick.value = v; tx.classList.remove("bad"); } else tx.classList.add("bad"); changed(); if (s.after) s.after(); };
      rs.onclick = function () { delete obj[key]; sync(); changed(); if (s.after) s.after(); };
      sync(); cw.appendChild(pick); cw.appendChild(tx); cw.appendChild(rs); w.appendChild(lab); w.appendChild(cw);
    } else if (t === "image" || t === "pdf") {
      var box = E("div", { class: "imgfld" }), th = E("div", { class: "th" }), btns = E("div", { class: "row" }), msg = E("p", { class: "msg" });
      var up = E("label", { class: "btn sec sm", style: "margin:0;text-transform:none;letter-spacing:0;font-weight:500;color:inherit;cursor:pointer" }, [t === "pdf" ? "Upload PDF" : "Upload"]);
      var fi = E("input", { type: "file", accept: t === "pdf" ? "application/pdf" : "image/*", class: "hide" }); up.appendChild(fi);
      var lib = E("button", { class: "btn sec sm", type: "button" }, ["Library"]), rm = E("button", { class: "btn bad sm", type: "button" }, ["Remove"]);
      function paint() {
        var v = obj[key]; th.style.backgroundImage = t === "image" && v ? "url('" + v + "')" : ""; th.textContent = t === "pdf" ? (v ? "PDF" : "") : "";
        rm.classList.toggle("hide", !v);
        if (t === "pdf") { msg.textContent = v ? v.split("/").pop() : "No file"; msg.className = "msg"; }
      }
      fi.onchange = function () {
        if (!fi.files[0]) return; msg.textContent = "Uploading…"; msg.className = "msg";
        (t === "pdf" ? uploadPdf(fi.files[0]) : uploadImage(fi.files[0], s.max)).then(function (u) { obj[key] = u; paint(); changed(); if (s.after) s.after(); if (t === "image") { msg.textContent = ""; } })
          .catch(function (e) { msg.textContent = e.message; msg.className = "msg err"; }); fi.value = "";
      };
      lib.onclick = function () { pickMedia(t === "pdf" ? "pdf" : "image").then(function (u) { if (u) { obj[key] = u; paint(); changed(); if (s.after) s.after(); } }); };
      rm.onclick = function () { delete obj[key]; paint(); changed(); if (s.after) s.after(); };
      btns.appendChild(up); btns.appendChild(lib); btns.appendChild(rm);
      box.appendChild(th); box.appendChild(E("div", {}, [btns, msg])); paint(); w.appendChild(lab); w.appendChild(box);
    } else {
      ctl = E(t === "area" ? "textarea" : "input", t === "area" ? { rows: s.rows || 4 } : { type: t === "num" ? "number" : "text" });
      if (s.ph) ctl.setAttribute("placeholder", s.ph);
      if (t === "num") { if (s.min != null) ctl.min = s.min; if (s.max != null) ctl.max = s.max; }
      ctl.value = obj[key] == null ? "" : obj[key];
      function mark() { if (t === "url") ctl.classList.toggle("bad", ctl.value.trim() !== "" && !okLink(ctl.value)); if (t === "slug") ctl.classList.toggle("bad", ctl.value !== "" && !/^[a-z][a-z0-9-]{0,30}$/.test(ctl.value)); }
      ctl.oninput = function () {
        mark();
        if (t === "num") set(ctl.value === "" ? undefined : +ctl.value);
        else if (t === "slug") set(ctl.value === "" ? undefined : ctl.value.toLowerCase());
        else set(ctl.value);
      };
      mark(); w.appendChild(lab); w.appendChild(ctl);
    }
    if (s.hint) w.appendChild(E("p", { class: "hint" }, [s.hint]));
    return w;
  }
  function fields(box, obj, defs) { box.textContent = ""; defs.forEach(function (d) { box.appendChild(F(obj, d[0], d[1])); }); return box; }
  /* a textarea that edits an array of lines */
  function LINES(obj, key, label, hint) {
    var w = E("div", { class: "fld" }), t = E("textarea", { rows: 5 });
    t.value = (obj[key] || []).join("\n"); t.oninput = function () { obj[key] = t.value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean); changed(); };
    w.appendChild(E("label", {}, [label])); w.appendChild(t); if (hint) w.appendChild(E("p", { class: "hint" }, [hint])); return w;
  }

  /* L(arr, o): editable list. o = { fresh(), title(it,i), body(it,i)->node, max, add: "+ Add", noMove, noClone } */
  function L(arr, o) {
    var root = E("div", { class: "list" });
    function draw() {
      root.textContent = "";
      arr.forEach(function (it, i) {
        var d = E("details", { class: "item" }), tt = E("span", { class: "t" });
        function lbl() { var x = o.title(it, i); tt.textContent = ""; tt.appendChild(x ? document.createTextNode(x) : E("em", {}, ["(empty)"])); }
        lbl(); if (OPEN.has(it)) d.open = true;
        d.addEventListener("toggle", function () { d.open ? OPEN.add(it) : OPEN.delete(it); });
        var sum = E("summary", {}, [tt]);
        function act(txt, title, fn, cls) { var b = E("button", { class: "btn sec sm ico " + (cls || ""), type: "button", title: title }, [txt]); b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); fn(); }; sum.appendChild(b); }
        if (!o.noMove) { act("↑", "Move up", function () { move(i, -1); }); act("↓", "Move down", function () { move(i, 1); }); }
        if (!o.noClone) act("⧉", "Duplicate", function () { if (o.max && arr.length >= o.max) return; var c = clone(it); arr.splice(i + 1, 0, c); OPEN.add(c); draw(); changed(); });
        act("✕", "Remove", function () { if (confirm("Remove this item?")) { arr.splice(i, 1); draw(); changed(); } }, "bad");
        var body = E("div", { class: "body" }, [o.body(it, i)]);
        body.addEventListener("input", lbl); body.addEventListener("change", lbl);
        d.appendChild(sum); d.appendChild(body); root.appendChild(d);
      });
      if (!o.max || arr.length < o.max) {
        var add = E("button", { class: "btn sec sm", type: "button" }, [o.add || "+ Add"]);
        add.onclick = function () { var n = o.fresh(); arr.push(n); OPEN.add(n); draw(); changed(); };
        root.appendChild(add);
      }
    }
    function move(i, d) { var j = i + d; if (j < 0 || j >= arr.length) return; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; draw(); changed(); }
    draw(); return root;
  }

  /* =============================== media library / picker =============================== */
  function usageOf(url) {
    var hit = [], s = JSON.stringify(content);
    KEYS.forEach(function (k) { if (JSON.stringify(content[k] || null).indexOf(url) >= 0) hit.push(NAMES[k]); });
    if (photos.some(function (p) { return p.url === url; })) hit.push("Photos");
    return hit;
  }
  function mediaGrid(files, onPick, filter) {
    var g = E("div", { class: "media" });
    files.filter(filter || function () { return true; }).forEach(function (f) {
      var url = CMS.PUB + f.name, isPdf = /\.pdf$/i.test(f.name), th = E("div", { class: "th" }, [isPdf ? "PDF" : ""]);
      if (!isPdf) th.style.backgroundImage = "url('" + url + "')";
      var card = E("div", { class: "mi" + (onPick ? " pick" : "") }, [th, E("div", { class: "nm" }, [f.name.length > 22 ? f.name.slice(0, 8) + "…" + f.name.slice(-9) : f.name])]);
      if (onPick) card.onclick = function () { onPick(url); };
      else {
        var r = E("div", { class: "row" }), cp = E("button", { class: "btn sec sm", type: "button" }, ["Copy link"]), del = E("button", { class: "btn bad sm", type: "button" }, ["Delete"]);
        cp.onclick = function () { (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { toast("Link copied"); }, function () { prompt("Copy this link:", url); }); };
        del.onclick = function () {
          var u = usageOf(url), msg = u.length ? "This file is used in: " + u.join(", ") + ".\nDeleting it will leave a broken image there. Delete anyway?" : "Delete this file permanently?";
          if (!confirm(msg)) return;
          authed("/storage/v1/object/site-media/" + encodeURIComponent(f.name), { method: "DELETE" }).then(function () { toast("Deleted"); card.remove(); }).catch(function (e) { toast(e.message); });
        };
        r.appendChild(cp); r.appendChild(del); card.appendChild(r);
        var us = usageOf(url); if (us.length) card.insertBefore(E("div", { class: "nm" }, ["In use: " + us.join(", ")]), r);
      }
      g.appendChild(card);
    });
    if (!g.children.length) g.appendChild(E("p", { class: "hint" }, ["Nothing here yet."]));
    return g;
  }
  function pickMedia(kind) {
    return new Promise(function (resolve) {
      var holder = E("div", {}, [E("p", { class: "hint" }, ["Loading…"])]), done = false;
      var close = modal([E("h2", { style: "margin:0 0 8px;font-size:16px" }, [kind === "pdf" ? "Choose a PDF" : "Choose an image"]), holder,
        (function () { var r = E("div", { class: "row", style: "margin-top:12px;justify-content:flex-end" }); var c = E("button", { class: "btn sec", type: "button" }, ["Cancel"]); c.onclick = function () { fin(null); }; r.appendChild(c); return r; })()], true);
      function fin(v) { if (done) return; done = true; close(); resolve(v); }
      mediaList().then(function (files) {
        holder.textContent = "";
        holder.appendChild(mediaGrid(files, fin, function (f) { return kind === "pdf" ? /\.pdf$/i.test(f.name) : !/\.pdf$/i.test(f.name); }));
      }).catch(function (e) { holder.textContent = e.message; });
    });
  }

  /* =============================== shape =============================== */
  function ensureShape() {
    content.about = content.about || {}; content.code = content.code || {}; content.footer = content.footer || {};
    content.hero = content.hero || {}; content.resume = content.resume || {};
    var s = content.settings = content.settings || {}; s.theme = s.theme || {}; s.motion = s.motion || {};
    var l = content.layout = content.layout || {}; l.items = Array.isArray(l.items) ? l.items : [];
    ["about", "code"].forEach(function (id) { if (!l.items.some(function (i) { return i && i.id === id; })) l.items.push({ id: id, type: id }); });
    l.items = l.items.filter(function (i) { return i && typeof i.id === "string"; });
    l.items.forEach(function (i) { if (i.show == null) i.show = true; });
  }

  /* =============================== SECTIONS tab =============================== */
  var FMT = "Formatting: **bold**, *italic*, [link text](https://…).";
  var ABOUT = [["num", { label: "Number" }], ["label", { label: "Label" }], ["script", { label: "Handwritten words" }], ["title", { label: "Heading" }], ["text", { label: "Paragraph", type: "area", rows: 5, hint: FMT }]];
  var CODE = [["num", { label: "Number" }], ["label", { label: "Label" }], ["title", { label: "Heading" }], ["text", { label: "Paragraph", type: "area", rows: 5, hint: FMT }]];
  var THEMES = [["dark", "Dark"], ["light", "Light"], ["cream", "Cream"]];

  function buttonsList(it) {
    it.buttons = it.buttons || [];
    return L(it.buttons, { max: 4, add: "+ Add button", fresh: function () { return { label: "", url: "" }; }, title: function (b) { return b.label; },
      body: function (b) { var w = E("div"); w.appendChild(F(b, "label", { label: "Button text" })); w.appendChild(F(b, "url", { type: "url", label: "Address", hint: "https://…, mailto:…, resume.html or #name" })); return w; } });
  }
  var TYPES = {
    text: { name: "Text", desc: "A heading with paragraphs, optional buttons.",
      fresh: function () { return { type: "text", layout: "columns", label: "", title: "A new section", text: "Write something here.", buttons: [] }; },
      fields: function (w, it) {
        w.appendChild(F(it, "label", { label: "Small label" })); w.appendChild(F(it, "title", { label: "Heading" }));
        w.appendChild(F(it, "text", { type: "area", rows: 6, label: "Text", hint: FMT + " A blank line starts a new paragraph." }));
        w.appendChild(F(it, "layout", { type: "select", label: "Layout", opts: [["columns", "Heading left, text right"], ["stack", "Heading above text"]], def: "columns" }));
        w.appendChild(E("h3", {}, ["Buttons"])); w.appendChild(buttonsList(it)); } },
    split: { name: "Image + text", desc: "A picture beside a heading and text.",
      fresh: function () { return { type: "split", side: "left", label: "", title: "A new section", text: "", buttons: [] }; },
      fields: function (w, it) {
        w.appendChild(F(it, "image", { type: "image", label: "Image" })); w.appendChild(F(it, "image_alt", { label: "Image description (for screen readers)" }));
        w.appendChild(F(it, "side", { type: "select", label: "Image position", opts: [["left", "Left"], ["right", "Right"]], def: "left" }));
        w.appendChild(F(it, "label", { label: "Small label" })); w.appendChild(F(it, "title", { label: "Heading" }));
        w.appendChild(F(it, "text", { type: "area", rows: 5, label: "Text", hint: FMT })); w.appendChild(E("h3", {}, ["Buttons"])); w.appendChild(buttonsList(it)); } },
    cards: { name: "Cards", desc: "A grid of cards: title, text, optional picture and link.",
      fresh: function () { return { type: "cards", cols: 3, label: "", title: "A new section", intro: "", cards: [{ title: "First", text: "" }, { title: "Second", text: "" }, { title: "Third", text: "" }] }; },
      fields: function (w, it) {
        w.appendChild(F(it, "label", { label: "Small label" })); w.appendChild(F(it, "title", { label: "Heading" })); w.appendChild(F(it, "intro", { type: "area", rows: 3, label: "Intro text (optional)" }));
        w.appendChild(F(it, "cols", { type: "select", label: "Cards per row", opts: [[2, "2"], [3, "3"], [4, "4"]], def: 3 })); it.cards = it.cards || [];
        w.appendChild(E("h3", {}, ["Cards"]));
        w.appendChild(L(it.cards, { max: 24, add: "+ Add card", fresh: function () { return { title: "", text: "" }; }, title: function (c) { return c.title; },
          body: function (c) { var x = E("div"); x.appendChild(F(c, "title", { label: "Title" })); x.appendChild(F(c, "text", { type: "area", rows: 3, label: "Text" })); x.appendChild(F(c, "image", { type: "image", label: "Picture (optional)" }));
            x.appendChild(F(c, "url", { type: "url", label: "Link (optional)" })); x.appendChild(F(c, "link_label", { label: "Link text", ph: "Learn more" })); return x; } })); } },
    list: { name: "Numbered list", desc: "Ruled rows with a number, title and note.",
      fresh: function () { return { type: "list", label: "", title: "A new section", items: [{ title: "First", text: "" }, { title: "Second", text: "" }] }; },
      fields: function (w, it) {
        w.appendChild(F(it, "label", { label: "Small label" })); w.appendChild(F(it, "title", { label: "Heading" })); it.items = it.items || [];
        w.appendChild(E("h3", {}, ["Rows"]));
        w.appendChild(L(it.items, { max: 40, add: "+ Add row", fresh: function () { return { title: "", text: "" }; }, title: function (x) { return x.title; },
          body: function (x) { var b = E("div"); b.appendChild(F(x, "num", { label: "Number (blank = automatic)" })); b.appendChild(F(x, "title", { label: "Title" })); b.appendChild(F(x, "text", { type: "area", rows: 2, label: "Note" })); return b; } })); } },
    stats: { name: "Numbers", desc: "Big figures with captions, e.g. “3 internships”.",
      fresh: function () { return { type: "stats", label: "", title: "", items: [{ value: "3", label: "internships" }] }; },
      fields: function (w, it) {
        w.appendChild(F(it, "label", { label: "Small label" })); w.appendChild(F(it, "title", { label: "Heading (optional)" })); it.items = it.items || [];
        w.appendChild(E("h3", {}, ["Figures"]));
        w.appendChild(L(it.items, { max: 12, add: "+ Add figure", fresh: function () { return { value: "", label: "" }; }, title: function (x) { return (x.value || "") + " " + (x.label || ""); },
          body: function (x) { var b = E("div"); b.appendChild(F(x, "value", { label: "Figure" })); b.appendChild(F(x, "label", { label: "Caption" })); return b; } })); } },
    quote: { name: "Quote", desc: "One large pull-quote.",
      fresh: function () { return { type: "quote", label: "", text: "A line worth remembering.", author: "" }; },
      fields: function (w, it) { w.appendChild(F(it, "label", { label: "Small label" })); w.appendChild(F(it, "text", { type: "area", rows: 3, label: "Quote" })); w.appendChild(F(it, "author", { label: "Who said it" })); } },
    gallery: { name: "Gallery", desc: "A grid of pictures with optional captions.",
      fresh: function () { return { type: "gallery", cols: 3, label: "", title: "A new section", images: [] }; },
      fields: function (w, it) {
        w.appendChild(F(it, "label", { label: "Small label" })); w.appendChild(F(it, "title", { label: "Heading" }));
        w.appendChild(F(it, "cols", { type: "select", label: "Pictures per row", opts: [[2, "2"], [3, "3"], [4, "4"], [5, "5"]], def: 3 })); it.images = it.images || [];
        w.appendChild(E("h3", {}, ["Pictures"]));
        w.appendChild(L(it.images, { max: 36, add: "+ Add picture", fresh: function () { return { url: "", caption: "" }; }, title: function (x) { return x.caption || (x.url ? "Picture" : ""); },
          body: function (x) { var b = E("div"); b.appendChild(F(x, "url", { type: "image", label: "Picture" })); b.appendChild(F(x, "caption", { label: "Caption" })); return b; } })); } },
    spacer: { name: "Space", desc: "Empty room between two sections.",
      fresh: function () { return { type: "spacer", height: 80 }; },
      fields: function (w, it) { w.appendChild(F(it, "height", { type: "num", label: "Height (pixels)", min: 8, max: 400 })); } }
  };
  function secName(it) {
    if (it.type === "about") return ["About", content.about.title];
    if (it.type === "code") return ["Section 02", content.code.title || "Code as a creative material"];
    var T = TYPES[it.type]; return [T ? T.name : it.type, it.title || (it.text ? String(it.text).slice(0, 40) : "")];
  }
  function builtinBody(it) {
    var w = E("div"), obj = it.type === "about" ? content.about : content.code, defs = it.type === "about" ? ABOUT : CODE, holder = E("div");
    fields(holder, obj, defs); w.appendChild(holder);
    w.appendChild(E("p", { class: "hint" }, ["An emptied field is hidden on the site. “Reset” brings back the original wording."]));
    var rs = E("button", { class: "btn sec sm", type: "button" }, ["Reset to the original text"]);
    rs.onclick = function () { if (confirm("Reset this section to the original text?")) { Object.keys(obj).forEach(function (k) { delete obj[k]; }); fields(holder, obj, defs); changed(); } };
    w.appendChild(rs); return w;
  }
  function blockBody(it) {
    var w = E("div"), T = TYPES[it.type]; if (!T) return E("p", { class: "hint" }, ["Unknown section type."]);
    T.fields(w, it);
    if (it.type !== "spacer") {
      w.appendChild(E("h3", {}, ["Appearance"]));
      var g = E("div", { class: "cols2" });
      g.appendChild(F(it, "theme", { type: "select", label: "Theme", opts: THEMES, def: "dark" }));
      g.appendChild(F(it, "anchor", { type: "slug", label: "Link name (optional)", hint: "lowercase, e.g. projects — then link to it with #projects" }));
      g.appendChild(F(it, "bg", { type: "color", label: "Custom background" })); g.appendChild(F(it, "fg", { type: "color", label: "Custom text colour" }));
      w.appendChild(g);
    } else w.appendChild(F(it, "theme", { type: "select", label: "Background", opts: THEMES, def: "dark" }));
    return w;
  }
  function drawSections() {
    var box = $("p-sections"); box.textContent = "";
    box.appendChild(E("h2", { class: "ptitle" }, ["Sections"]));
    box.appendChild(E("p", { class: "lead" }, ["Everything between the photos and the footer. Reorder, hide, edit, or add new sections. The footer always comes last (edit it in the Footer tab)."]));
    var items = content.layout.items;
    function redraw() { drawSections(); changed(); }
    var list = E("div", { class: "list" });
    items.forEach(function (it, i) {
      var builtin = it.type === "about" || it.type === "code", d = E("details", { class: "item" + (it.show === false ? " off" : "") }), nm = secName(it);
      var tt = E("span", { class: "t" }, [nm[0] + (nm[1] ? " — " : ""), nm[1] ? E("em", {}, [String(nm[1])]) : ""]);
      var sum = E("summary", {}, [tt, E("span", { class: "tag" }, [builtin ? "Built-in" : "Added"])]);
      if (OPEN.has(it)) d.open = true; d.addEventListener("toggle", function () { d.open ? OPEN.add(it) : OPEN.delete(it); });
      var sw = E("label", { class: "switch", title: "Show on the site" }), cb = E("input", { type: "checkbox" }); cb.checked = it.show !== false;
      cb.onclick = function (e) { e.stopPropagation(); }; cb.onchange = function () { it.show = cb.checked; d.classList.toggle("off", !cb.checked); changed(); };
      sw.onclick = function (e) { e.stopPropagation(); }; sw.appendChild(cb); sw.appendChild(document.createTextNode("Show")); sum.appendChild(sw);
      function act(txt, title, fn, cls) { var b = E("button", { class: "btn sec sm ico " + (cls || ""), type: "button", title: title }, [txt]); b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); fn(); }; sum.appendChild(b); }
      act("↑", "Move up", function () { if (i > 0) { var t = items[i - 1]; items[i - 1] = it; items[i] = t; redraw(); } });
      act("↓", "Move down", function () { if (i < items.length - 1) { var t = items[i + 1]; items[i + 1] = it; items[i] = t; redraw(); } });
      if (!builtin) {
        act("⧉", "Duplicate", function () { var c = clone(it); c.id = rid(); if (c.anchor) delete c.anchor; items.splice(i + 1, 0, c); OPEN.add(c); redraw(); });
        act("✕", "Delete this section", function () { if (confirm("Delete this section? (You can bring it back from History.)")) { items.splice(i, 1); redraw(); } }, "bad");
      }
      var body = E("div", { class: "body" }, [builtin ? builtinBody(it) : blockBody(it)]);
      body.addEventListener("input", function () { var n = secName(it); tt.textContent = ""; tt.appendChild(document.createTextNode(n[0] + (n[1] ? " — " : ""))); if (n[1]) tt.appendChild(E("em", {}, [String(n[1])])); });
      d.appendChild(sum); d.appendChild(body); list.appendChild(d);
    });
    box.appendChild(list);
    var foot = E("details", { class: "item" }, [E("summary", {}, [E("span", { class: "t" }, ["Footer"]), E("span", { class: "tag" }, ["Always last"])]), E("div", { class: "body" }, [E("p", { class: "hint" }, ["Edit the footer text, links and columns in the Footer tab."])])]);
    foot.querySelector("summary").style.cursor = "pointer"; box.appendChild(foot);
    var add = E("button", { class: "btn", type: "button", style: "margin-top:12px" }, ["+ Add a section"]);
    add.onclick = function () {
      var g = E("div", { class: "types" }), close;
      Object.keys(TYPES).forEach(function (k) { var b = E("button", { type: "button" }, [E("b", {}, [TYPES[k].name]), E("span", {}, [TYPES[k].desc])]); b.onclick = function () { var n = TYPES[k].fresh(); n.id = rid(); n.theme = n.theme || "dark"; items.push(n); OPEN.add(n); close(); redraw(); }; g.appendChild(b); });
      var cancel = E("button", { class: "btn sec", type: "button", style: "margin-top:12px" }, ["Cancel"]); cancel.onclick = function () { close(); };
      close = modal([E("h2", { style: "margin:0 0 10px;font-size:16px" }, ["What kind of section?"]), g, cancel]);
    };
    box.appendChild(add);
  }

  /* =============================== HERO & PHOTOS tab =============================== */
  function norm(p) { return { id: p.id || uuid(), url: p.url, caption: p.caption || "", focus_x: p.focus_x == null ? 50 : +p.focus_x, focus_y: p.focus_y == null ? 22 : +p.focus_y, zoom: p.zoom == null ? 1 : +p.zoom }; }
  function imgStyle(img, p) { img.style.objectPosition = p.focus_x + "% " + p.focus_y + "%"; img.style.transformOrigin = p.focus_x + "% " + p.focus_y + "%"; img.style.transform = p.zoom > 1 ? "scale(" + p.zoom + ")" : ""; }
  var dragI = null, cp = null, cdrag = null;
  function drawPhotos() {
    var box = $("photos"); if (!box) return; box.textContent = "";
    $("count").textContent = photos.length + " photos" + (photos.length > 18 ? " — only the first 18 appear in the notebook" : "");
    photos.forEach(function (p, i) {
      var card = E("div", { class: "ph", draggable: "true" }), im = E("div", { class: "im" }), img = E("img", { alt: "", src: p.url }); imgStyle(img, p);
      im.appendChild(img); im.appendChild(E("span", { class: "n" }, [String(i + 1)])); card.appendChild(im);
      var cap = E("input", { type: "text", placeholder: "Caption" }); cap.value = p.caption; cap.oninput = function () { p.caption = cap.value; changed(); }; card.appendChild(cap);
      var r1 = E("div", { class: "row" });
      [["↑", function () { mv(i, -1); }], ["↓", function () { mv(i, 1); }], ["Crop", function () { crop(p); }]].forEach(function (a) { var b = E("button", { class: "btn sec sm", type: "button" }, [a[0]]); b.onclick = a[1]; r1.appendChild(b); }); card.appendChild(r1);
      var r2 = E("div", { class: "row" }), rb = E("label", { class: "btn sec sm", style: "margin:0;text-transform:none;letter-spacing:0;font-weight:500;color:inherit;cursor:pointer" }, ["Replace"]), rf = E("input", { type: "file", accept: "image/*", class: "hide" });
      rf.onchange = function () { if (!rf.files[0]) return; say("photoMsg", "Uploading…", 1); uploadImage(rf.files[0]).then(function (u) { p.url = u; p.focus_x = 50; p.focus_y = 22; p.zoom = 1; say("photoMsg", ""); drawPhotos(); changed(); }).catch(function (e) { say("photoMsg", e.message); }); };
      rb.appendChild(rf); r2.appendChild(rb);
      var d = E("button", { class: "btn bad sm", type: "button" }, ["Delete"]); d.onclick = function () { if (confirm("Remove this photo?")) { photos.splice(i, 1); drawPhotos(); changed(); } }; r2.appendChild(d); card.appendChild(r2);
      card.addEventListener("dragstart", function (e) { dragI = i; card.classList.add("over"); try { e.dataTransfer.setData("text/plain", String(i)); } catch (x) {} });
      card.addEventListener("dragend", function () { card.classList.remove("over"); });
      card.addEventListener("dragover", function (e) { e.preventDefault(); });
      card.addEventListener("drop", function (e) { e.preventDefault(); if (dragI == null || dragI === i) return; var m = photos.splice(dragI, 1)[0]; photos.splice(i, 0, m); dragI = null; drawPhotos(); changed(); });
      box.appendChild(card);
    });
  }
  function mv(i, d) { var j = i + d; if (j < 0 || j >= photos.length) return; var t = photos[i]; photos[i] = photos[j]; photos[j] = t; drawPhotos(); changed(); }
  function crop(p) {
    cp = p;
    var cb = E("div", { class: "crop", id: "cropBox" }), im = E("img", { alt: "", src: p.url }), zoom = E("input", { type: "range", min: 1, max: 4, step: .05 });
    cb.appendChild(im); imgStyle(im, p); zoom.value = p.zoom;
    zoom.oninput = function () { p.zoom = +zoom.value; imgStyle(im, p); };
    cb.addEventListener("pointerdown", function (e) { cdrag = { x: e.clientX, y: e.clientY, fx: p.focus_x, fy: p.focus_y }; cb.setPointerCapture(e.pointerId); });
    cb.addEventListener("pointermove", function (e) { if (!cdrag) return; var r = cb.getBoundingClientRect(), k = 1 / p.zoom; p.focus_x = Math.max(0, Math.min(100, cdrag.fx - (e.clientX - cdrag.x) / r.width * 100 * k)); p.focus_y = Math.max(0, Math.min(100, cdrag.fy - (e.clientY - cdrag.y) / r.height * 100 * k)); imgStyle(im, p); });
    cb.addEventListener("pointerup", function () { cdrag = null; });
    var ok = E("button", { class: "btn", type: "button" }, ["Done"]), close;
    ok.onclick = function () { close(); drawPhotos(); changed(); };
    close = modal([cb, E("p", { class: "hint" }, ["Drag the picture to choose what shows. Use the slider to zoom."]), E("label", { style: "font-size:12px;font-weight:600;color:var(--mute)" }, ["ZOOM"]), zoom, E("div", { class: "row", style: "margin-top:12px;justify-content:flex-end" }, [ok])]);
  }
  function drawHero() {
    var box = $("p-hero"); box.textContent = "";
    box.appendChild(E("h2", { class: "ptitle" }, ["Hero & photos"]));
    box.appendChild(E("p", { class: "lead" }, ["The big portrait at the top and the photo notebook under it."]));
    var c = E("div", { class: "card" }, [E("h2", {}, ["Portrait"])]);
    c.appendChild(E("p", { class: "hint" }, ["The current portrait has the name and the Portfolio / Résumé / LinkedIn words built into the picture itself, so a new image should include any text you want shown."]));
    c.appendChild(F(content.hero, "image", { type: "image", label: "Portrait image (empty = original)", max: 1800 }));
    c.appendChild(F(content.hero, "alt", { label: "Picture description (for screen readers and search)", ph: "Illustrated portrait of Ezra J.L. Ssekamwa" }));
    c.appendChild(F(content.hero, "linkedin", { type: "url", label: "Where the LinkedIn word in the portrait links to", hint: "Leave empty to keep the current link." }));
    c.appendChild(E("p", { class: "hint" }, ["Portrait changes show on the live site after publishing (the preview keeps the old portrait)."]));
    box.appendChild(c);
    var c2 = E("div", { class: "card" }, [E("h2", {}, ["Photo notebook"]), E("p", { class: "hint" }, ["The first 18 photos fill the notebook cards, in this order. Use the arrows (or drag a photo) to reorder, “Crop” to choose which part is shown, “Replace” to swap the picture. Photo changes show on the live site after publishing."])]);
    var add = E("input", { type: "file", accept: "image/*", multiple: "multiple" }); add.onchange = function () {
      var fs = [].slice.call(add.files); if (!fs.length) return; say("photoMsg", "Uploading " + fs.length + "…", 1);
      fs.reduce(function (pr, f) { return pr.then(function () { return uploadImage(f).then(function (u) { photos.push(norm({ url: u })); }); }); }, Promise.resolve())
        .then(function () { say("photoMsg", ""); add.value = ""; drawPhotos(); changed(); }).catch(function (e) { say("photoMsg", e.message); drawPhotos(); changed(); });
    };
    c2.appendChild(E("div", { class: "row" }, [add, E("span", { class: "hint", id: "count" })])); c2.appendChild(E("p", { class: "msg", id: "photoMsg" })); box.appendChild(c2);
    box.appendChild(E("div", { class: "photos", id: "photos" })); drawPhotos();
  }

  /* =============================== FOOTER tab =============================== */
  function legacyCols(f) {
    var wa = String(f.whatsapp || "").replace(/\D/g, "");
    return [
      { title: "Navigation", links: [{ label: "Portfolio", url: "#portfolio" }, { label: "Resume", url: "resume.html" }, { label: "Back to top", url: "#top" }] },
      { title: "Social", links: [{ label: "LinkedIn", url: f.linkedin || "https://www.linkedin.com/" }].concat(wa.length >= 7 ? [{ label: "WhatsApp", url: "https://wa.me/" + wa }] : []) },
      { title: "Contact", links: f.email ? [{ label: "Email me", url: "mailto:" + f.email }] : [] }
    ];
  }
  function linkBody(l) {
    var w = E("div"); w.appendChild(F(l, "label", { label: "Text" })); w.appendChild(F(l, "url", { type: "url", label: "Address", hint: "https://… · mailto:you@mail.com · tel:+256… · https://wa.me/256… · resume.html · #top · #name" }));
    var f = E("div", { class: "fld" }), s = E("select"); [["auto", "Automatic"], ["new", "New tab"], ["same", "Same tab"]].forEach(function (o) { s.appendChild(E("option", { value: o[0] }, [o[1]])); });
    s.value = l.ext === true ? "new" : l.ext === false ? "same" : "auto"; s.onchange = function () { if (s.value === "auto") delete l.ext; else l.ext = s.value === "new"; changed(); };
    f.appendChild(E("label", {}, ["Opens in"])); f.appendChild(s); w.appendChild(f);
    w.appendChild(F(l, "arrow", { type: "check", label: "Show the little arrow", def: true })); return w;
  }
  function drawFooter() {
    var box = $("p-footer"), f = content.footer; box.textContent = "";
    box.appendChild(E("h2", { class: "ptitle" }, ["Footer"]));
    box.appendChild(E("p", { class: "lead" }, ["The closing section with the wavy top edge."]));
    var c = E("div", { class: "card" }, [E("h2", {}, ["Text"])]);
    c.appendChild(F(f, "show", { type: "check", label: "Show the footer", def: true }));
    c.appendChild(F(f, "heading", { label: "Heading" })); c.appendChild(F(f, "lede", { type: "area", rows: 3, label: "Intro text", hint: FMT }));
    c.appendChild(F(f, "role", { label: "Role line (bottom, centre)" }));
    c.appendChild(F(f, "copyright", { label: "Copyright line", hint: "Keep the © symbol in this line: tapping it 10 times in a row is the hidden way into this editor." }));
    box.appendChild(c);
    var c2 = E("div", { class: "card" }, [E("h2", {}, ["Links"])]);
    if (!Array.isArray(f.cols)) {
      c2.appendChild(E("p", { class: "hint" }, ["The footer currently uses its standard three columns (Navigation, Social, Contact)."]));
      c2.appendChild(F(f, "linkedin", { type: "url", label: "LinkedIn address" }));
      c2.appendChild(F(f, "whatsapp", { label: "WhatsApp number (digits, with country code)" }));
      c2.appendChild(F(f, "email", { label: "Email address" }));
      var cu = E("button", { class: "btn sec", type: "button", style: "margin-top:10px" }, ["Customise columns and links…"]);
      cu.onclick = function () { f.cols = legacyCols(f); f.cols.forEach(function (x) { OPEN.add(x); }); drawFooter(); changed(); }; c2.appendChild(cu);
    } else {
      c2.appendChild(E("p", { class: "hint" }, ["Up to four columns. The first column is the widest. Use the address #top for a “Back to top” link."]));
      c2.appendChild(L(f.cols, { max: 4, add: "+ Add column", noClone: true, fresh: function () { return { title: "New column", links: [] }; }, title: function (x) { return x.title; },
        body: function (col) { var w = E("div"); w.appendChild(F(col, "title", { label: "Column heading" })); col.links = col.links || [];
          w.appendChild(L(col.links, { max: 10, add: "+ Add link", fresh: function () { return { label: "", url: "" }; }, title: function (l) { return l.label; }, body: linkBody })); return w; } }));
      var rs = E("button", { class: "btn bad sm", type: "button", style: "margin-top:10px" }, ["Go back to the standard columns"]);
      rs.onclick = function () { if (confirm("Replace your custom columns with the standard ones?")) { delete f.cols; drawFooter(); changed(); } }; c2.appendChild(rs);
    }
    box.appendChild(c2);
  }

  /* =============================== RÉSUMÉ tab =============================== */
  var RES_TOP = [["name", { label: "Name" }], ["headline", { label: "Headline" }], ["location", { label: "Location" }], ["phone", { label: "Phone (separate numbers with “ / ”)" }], ["email", { label: "Email" }], ["linkedin", { type: "url", label: "LinkedIn address" }], ["membership", { label: "Membership line" }]];
  var RES_SECS = [["profile", "Professional profile"], ["education", "Academic qualifications"], ["memberships", "Professional membership"], ["experience", "Internship experience"], ["skills", "Skills"], ["languages", "Languages"], ["referees", "Referees"]];
  var RES_L = {
    education: { f: [["title", "Qualification"], ["org", "Institution"], ["period", "Period"]], t: function (x) { return x.title; }, n: { title: "", org: "", period: "" } },
    memberships: { f: [["title", "Title"], ["detail", "Detail"]], t: function (x) { return x.title; }, n: { title: "", detail: "" } },
    experience: { f: [["role", "Role"], ["org", "Organisation"], ["place", "Place"], ["period", "Period"], ["bullets", "Bullet points (one per line)", 1]], t: function (x) { return (x.role || "") + (x.org ? " — " + x.org : ""); }, n: { role: "", org: "", place: "", period: "", bullets: [] } },
    skills: { f: [["name", "Skill"], ["level", "Level"]], t: function (x) { return x.name; }, n: { name: "", level: "" } },
    languages: { f: [["name", "Language"], ["level", "Level"]], t: function (x) { return x.name; }, n: { name: "", level: "" } },
    referees: { f: [["name", "Name"], ["role", "Role"], ["contact", "Contact (optional — leave empty to show “available on request”)"]], t: function (x) { return x.name; }, n: { name: "", role: "", contact: "" } }
  };
  function ensureResume() {
    var R = content.resume, l = Array.isArray(R.layout) ? R.layout : [];
    RES_SECS.forEach(function (s) { if (!l.some(function (x) { return x.id === s[0]; })) l.push({ id: s[0], title: s[1], show: true }); });
    l.forEach(function (x) { if (x.show == null) x.show = true; if (!x.title && !x.custom) x.title = (RES_SECS.filter(function (s) { return s[0] === x.id; })[0] || [0, x.id])[1]; });
    R.layout = l;
  }
  function resBody(x) {
    var R = content.resume, w = E("div");
    w.appendChild(F(x, "title", { label: "Section title" }));
    if (x.custom) { w.appendChild(F(x, "text", { type: "area", rows: 6, label: "Text", hint: FMT + " A blank line starts a new paragraph." })); return w; }
    if (x.id === "profile") { w.appendChild(F(R, "profile", { type: "area", rows: 6, label: "Text" })); return w; }
    var D = RES_L[x.id]; if (!D) return w; R[x.id] = R[x.id] || [];
    w.appendChild(L(R[x.id], { add: "+ Add", fresh: function () { return clone(D.n); }, title: D.t,
      body: function (it) { var b = E("div"); D.f.forEach(function (d) { b.appendChild(d[0] === "bullets" ? LINES(it, "bullets", d[1]) : F(it, d[0], { label: d[1] })); }); return b; } }));
    return w;
  }
  function drawResume() {
    var R = content.resume, box = $("p-resume"); box.textContent = ""; ensureResume();
    box.appendChild(E("h2", { class: "ptitle" }, ["Résumé page"])); box.appendChild(E("p", { class: "lead" }, ["The page the Résumé button opens."]));
    var c = E("div", { class: "card" }, [E("h2", {}, ["Heading details"])]);
    fields(c, R, RES_TOP); c.insertBefore(E("h2", {}, ["Heading details"]), c.firstChild); box.appendChild(c);
    var c2 = E("div", { class: "card" }, [E("h2", {}, ["Page title & download"])]);
    c2.appendChild(F(R, "title", { label: "Big page title", ph: "Resume" }));
    c2.appendChild(F(R, "pdf", { type: "pdf", label: "Downloadable PDF (optional)" }));
    c2.appendChild(F(R, "pdf_label", { label: "Download button text", ph: "Download PDF" }));
    c2.appendChild(E("p", { class: "hint" }, ["When a PDF is added, a download button appears under your name."])); box.appendChild(c2);
    var c3 = E("div", { class: "card" }, [E("h2", {}, ["Sections"]), E("p", { class: "hint" }, ["Rename, reorder or hide sections, edit their entries, or add your own."])]);
    var lst = R.layout, list = E("div", { class: "list" });
    function redraw() { drawResume(); changed(); }
    lst.forEach(function (x, i) {
      var d = E("details", { class: "item" + (x.show === false ? " off" : "") }), tt = E("span", { class: "t" }, [x.title || "(untitled)"]), sum = E("summary", {}, [tt]);
      if (x.custom) sum.appendChild(E("span", { class: "tag" }, ["Added"]));
      if (OPEN.has(x)) d.open = true; d.addEventListener("toggle", function () { d.open ? OPEN.add(x) : OPEN.delete(x); });
      var sw = E("label", { class: "switch" }), cb = E("input", { type: "checkbox" }); cb.checked = x.show !== false; cb.onclick = function (e) { e.stopPropagation(); };
      cb.onchange = function () { x.show = cb.checked; d.classList.toggle("off", !cb.checked); changed(); }; sw.onclick = function (e) { e.stopPropagation(); }; sw.appendChild(cb); sw.appendChild(document.createTextNode("Show")); sum.appendChild(sw);
      function act(t, ti, fn, cls) { var b = E("button", { class: "btn sec sm ico " + (cls || ""), type: "button", title: ti }, [t]); b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); fn(); }; sum.appendChild(b); }
      act("↑", "Move up", function () { if (i > 0) { var t = lst[i - 1]; lst[i - 1] = x; lst[i] = t; redraw(); } });
      act("↓", "Move down", function () { if (i < lst.length - 1) { var t = lst[i + 1]; lst[i + 1] = x; lst[i] = t; redraw(); } });
      if (x.custom) act("✕", "Delete", function () { if (confirm("Delete this section?")) { lst.splice(i, 1); redraw(); } }, "bad");
      var body = E("div", { class: "body" }, [resBody(x)]); body.addEventListener("input", function () { tt.textContent = x.title || "(untitled)"; });
      d.appendChild(sum); d.appendChild(body); list.appendChild(d);
    });
    c3.appendChild(list);
    var add = E("button", { class: "btn sec sm", type: "button" }, ["+ Add your own section"]);
    add.onclick = function () { var n = { id: rid(), custom: true, title: "New section", text: "", show: true }; lst.push(n); OPEN.add(n); redraw(); };
    c3.appendChild(add); box.appendChild(c3);
    var c4 = E("div", { class: "card" }, [E("h2", {}, ["Closing note"])]); c4.appendChild(F(R, "note", { type: "area", rows: 3, label: "Shown at the bottom of the page" })); box.appendChild(c4);
  }

  /* =============================== DESIGN & MOTION tab =============================== */
  var AREAS = [["about", "About section", "#111214", "#f2f0ea"], ["code", "Section 02", "#ffffff", "#111214"], ["footer", "Footer", "#f5ebe4", "#1c1917"]];
  function drawDesign() {
    var box = $("p-design"), th = content.settings.theme, mo = content.settings.motion; box.textContent = "";
    box.appendChild(E("h2", { class: "ptitle" }, ["Design & motion"]));
    box.appendChild(E("p", { class: "lead" }, ["Colours for the three built-in sections (added sections have their own colours), and switches for the movement on the page."]));
    var card = E("div", { class: "card" }, [E("h2", {}, ["Colours"]), E("p", { class: "hint" }, ["Leave a colour on “Default” to keep the original. Text must stay easy to read, so each pair shows a contrast check."])]);
    AREAS.forEach(function (a) {
      var chip = E("span", { class: "chip" }), id = a[0];
      function upd() { var bg = hex6(th[id + "_bg"]) ? th[id + "_bg"] : a[2], fg = hex6(th[id + "_fg"]) ? th[id + "_fg"] : a[3], r = ratio(bg, fg); chip.textContent = "Contrast " + r.toFixed(1) + ":1 — " + (r >= 4.5 ? "good" : r >= 3 ? "weak" : "hard to read"); chip.className = "chip " + (r >= 4.5 ? "ok" : r >= 3 ? "warn" : "bad"); }
      var g = E("div", { class: "cols2" }); g.appendChild(F(th, id + "_bg", { type: "color", label: a[1] + " — background", def: a[2], after: upd })); g.appendChild(F(th, id + "_fg", { type: "color", label: a[1] + " — text", def: a[3], after: upd }));
      card.appendChild(E("h3", {}, [a[1]])); card.appendChild(g); card.appendChild(chip); upd();
    });
    if (th.code_bg && th.code_bg.toLowerCase() !== "#ffffff") card.appendChild(E("p", { class: "hint" }, ["Note: with a non-white Section 02 background, its “sliding over the section above” effect is switched off automatically."]));
    var reset = E("button", { class: "btn bad sm", type: "button", style: "margin-top:12px" }, ["Reset all colours"]); reset.onclick = function () { Object.keys(th).forEach(function (k) { delete th[k]; }); drawDesign(); changed(); }; card.appendChild(reset);
    box.appendChild(card);
    var m = E("div", { class: "card" }, [E("h2", {}, ["Motion"]), E("p", { class: "hint" }, ["Visitors who ask their device for “reduced motion” always get the calm version, whatever you choose here."])]);
    m.appendChild(F(mo, "entrance", { type: "check", label: "Entrance animation when the page loads", def: true }));
    m.appendChild(F(mo, "reveal", { type: "check", label: "Sections fade in as you scroll", def: true }));
    m.appendChild(F(mo, "wave", { type: "check", label: "Wobbly, bouncy footer edge", def: true }));
    m.appendChild(F(mo, "climb", { type: "check", label: "Section 02 slides over the section above while scrolling", def: true }));
    box.appendChild(m);
  }

  /* =============================== SITE SETTINGS tab =============================== */
  function drawSettings() {
    var box = $("p-settings"), s = content.settings; box.textContent = "";
    box.appendChild(E("h2", { class: "ptitle" }, ["Site settings"])); box.appendChild(E("p", { class: "lead" }, ["What shows in the browser tab and in search results."]));
    var c = E("div", { class: "card" });
    c.appendChild(F(s, "title", { label: "Browser tab title", ph: "Ezra J.L. Ssekamwa — Civil Engineer & Curious Mind" }));
    c.appendChild(F(s, "description", { type: "area", rows: 3, label: "Short description (for search engines)" }));
    c.appendChild(F(s, "favicon", { type: "image", label: "Tab icon", max: 256, hint: "A small square picture works best." }));
    c.appendChild(E("p", { class: "hint" }, ["Search engines read the title and description. Some apps that make link previews (WhatsApp, LinkedIn) read the original page text only and may not show changes made here."]));
    box.appendChild(c);
  }

  /* =============================== MEDIA tab =============================== */
  function drawMedia() {
    var box = $("p-media"); box.textContent = "";
    box.appendChild(E("h2", { class: "ptitle" }, ["Media library"])); box.appendChild(E("p", { class: "lead" }, ["Every picture and PDF you have uploaded. Files marked “In use” are shown somewhere on the site."]));
    var c = E("div", { class: "card" }), up = E("input", { type: "file", accept: "image/*,application/pdf", multiple: "multiple" }), holder = E("div"), msg = E("p", { class: "msg" });
    c.appendChild(E("div", { class: "row" }, [up])); c.appendChild(msg); box.appendChild(c); box.appendChild(holder);
    function load() { holder.textContent = ""; holder.appendChild(E("p", { class: "hint" }, ["Loading…"])); mediaList().then(function (f) { holder.textContent = ""; holder.appendChild(E("p", { class: "hint" }, [f.length + " file" + (f.length === 1 ? "" : "s")])); holder.appendChild(mediaGrid(f)); }).catch(function (e) { holder.textContent = e.message; }); }
    up.onchange = function () {
      var fs = [].slice.call(up.files); if (!fs.length) return; msg.textContent = "Uploading " + fs.length + "…"; msg.className = "msg ok";
      fs.reduce(function (pr, f) { return pr.then(function () { return f.type === "application/pdf" ? uploadPdf(f) : uploadImage(f, 2400); }); }, Promise.resolve()).then(function () { msg.textContent = ""; up.value = ""; load(); }).catch(function (e) { msg.textContent = e.message; msg.className = "msg err"; });
    };
    load();
  }

  /* =============================== HISTORY & BACKUP tab =============================== */
  function applyRestored(key, value) {
    if (key === "photos") photos = (Array.isArray(value) ? value : []).filter(function (p) { return p && typeof p.url === "string"; }).map(norm);
    else { content[key] = clone(value); }
    ensureShape(); drawAll(); changed();
  }
  function drawHistory() {
    var box = $("p-history"); box.textContent = "";
    box.appendChild(E("h2", { class: "ptitle" }, ["History & backup"])); box.appendChild(E("p", { class: "lead" }, ["Every publish keeps the previous version. Restoring puts an old version into the editor as an unsaved change, so you can look it over and then publish (or discard)."]));
    var c = E("div", { class: "card" }, [E("h2", {}, ["Earlier versions"])]), sel = E("select");
    sel.appendChild(E("option", { value: "" }, ["All areas"])); KEYS.concat(["photos"]).forEach(function (k) { sel.appendChild(E("option", { value: k }, [NAMES[k]])); });
    var holder = E("div"); c.appendChild(E("div", { class: "fld" }, [sel])); c.appendChild(holder); box.appendChild(c);
    function load() {
      holder.textContent = "Loading…";
      authed("/rest/v1/site_revisions?select=id,key,saved_at&order=saved_at.desc&limit=80" + (sel.value ? "&key=eq." + sel.value : "")).then(function (rows) {
        holder.textContent = ""; if (!rows || !rows.length) { holder.appendChild(E("p", { class: "hint" }, ["No earlier versions yet. They appear after your next publish."])); return; }
        rows.forEach(function (r) {
          var v = E("button", { class: "btn sec sm", type: "button" }, ["View"]), re = E("button", { class: "btn sm", type: "button" }, ["Restore"]);
          v.onclick = function () { authed("/rest/v1/site_revisions?select=value&id=eq." + r.id).then(function (x) { var close = modal([E("h2", { style: "margin:0 0 8px;font-size:16px" }, [NAMES[r.key] + " — " + when(r.saved_at)]), E("pre", { class: "json" }, [JSON.stringify(x[0].value, null, 2).slice(0, 12000)]), E("div", { class: "row", style: "justify-content:flex-end" }, [(function () { var b = E("button", { class: "btn sec" , type: "button" }, ["Close"]); b.onclick = function () { close(); }; return b; })()])], true); }).catch(function (e) { toast(e.message); }); };
          re.onclick = function () { if (!confirm("Put this version into the editor? It stays unsaved until you publish.")) return; authed("/rest/v1/site_revisions?select=value&id=eq." + r.id).then(function (x) { applyRestored(r.key, x[0].value); toast("Restored into the editor — review it, then Publish"); }).catch(function (e) { toast(e.message); }); };
          holder.appendChild(E("div", { class: "rev" }, [E("div", { class: "w" }, [E("b", {}, [NAMES[r.key] || r.key]), E("div", { class: "hint", style: "margin:0" }, [when(r.saved_at)])]), v, re]));
        });
      }).catch(function (e) { holder.textContent = e.message; });
    }
    sel.onchange = load; load();
    var b = E("div", { class: "card" }, [E("h2", {}, ["Backup"]), E("p", { class: "hint" }, ["Download everything you can edit here as one file, or load such a file back in."])]);
    var ex = E("button", { class: "btn sec", type: "button" }, ["Download backup"]);
    ex.onclick = function () {
      var out = { app: "ezra-site-editor", version: 1, exported_at: new Date().toISOString(), content: {}, photos: photos.map(function (p) { return { id: p.id, url: p.url, caption: p.caption, focus_x: p.focus_x, focus_y: p.focus_y, zoom: p.zoom }; }) };
      KEYS.forEach(function (k) { out.content[k] = clone(content[k]); });
      var a = E("a", { href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" })), download: "site-backup-" + new Date().toISOString().slice(0, 10) + ".json" }); document.body.appendChild(a); a.click(); a.remove();
    };
    var im = E("input", { type: "file", accept: "application/json,.json" }), imMsg = E("p", { class: "msg" });
    im.onchange = function () {
      var f = im.files[0]; if (!f) return;
      f.text().then(function (t) {
        var o = JSON.parse(t); if (!o || o.app !== "ezra-site-editor" || typeof o.content !== "object") throw new Error("That is not a backup from this editor.");
        if (!confirm("Load this backup into the editor? Your current unsaved edits will be replaced. Nothing goes live until you publish.")) return;
        KEYS.forEach(function (k) { if (o.content[k] && typeof o.content[k] === "object") content[k] = clone(o.content[k]); });
        if (Array.isArray(o.photos)) photos = o.photos.filter(function (p) { return p && typeof p.url === "string"; }).map(norm);
        ensureShape(); drawAll(); changed(); imMsg.textContent = ""; toast("Backup loaded — review it, then Publish");
      }).catch(function (e) { imMsg.textContent = e.message; imMsg.className = "msg err"; }); im.value = "";
    };
    b.appendChild(E("div", { class: "row" }, [ex])); b.appendChild(E("div", { class: "fld" }, [E("label", {}, ["Load a backup"]), im])); b.appendChild(imMsg); box.appendChild(b);
  }

  /* =============================== ACCOUNT tab =============================== */
  function drawAccount() {
    var box = $("p-account"); box.textContent = "";
    box.appendChild(E("h2", { class: "ptitle" }, ["Account"]));
    var c = E("div", { class: "card" }, [E("h2", {}, ["Signed in as"])]), who = E("p", {}, ["…"]); c.appendChild(who); box.appendChild(c);
    authed("/auth/v1/user").then(function (u) { who.textContent = u.email || "(unknown)"; }).catch(function () { who.textContent = "(unknown)"; });
    var p = E("div", { class: "card" }, [E("h2", {}, ["Change password"])]), np = E("input", { type: "password", autocomplete: "new-password" }), m = E("p", { class: "msg" });
    p.appendChild(E("div", { class: "fld" }, [E("label", {}, ["New password (at least 8 characters)"]), np]));
    var go = E("button", { class: "btn", type: "button" }, ["Update password"]);
    go.onclick = function () { if (np.value.length < 8) { m.textContent = "Use at least 8 characters."; m.className = "msg err"; return; } authed("/auth/v1/user", { method: "PUT", body: JSON.stringify({ password: np.value }) }).then(function () { np.value = ""; m.textContent = "Password updated."; m.className = "msg ok"; }).catch(function (e) { m.textContent = e.message; m.className = "msg err"; }); };
    p.appendChild(go); p.appendChild(m); box.appendChild(p);
    var s = E("div", { class: "card" }, [E("h2", {}, ["Sign out everywhere"]), E("p", { class: "hint" }, ["Ends your editor session on every device, including this one."])]);
    var so = E("button", { class: "btn bad", type: "button" }, ["Sign out of all devices"]);
    so.onclick = function () { token().then(function (t) { return CMS.api("/auth/v1/logout?scope=global", { method: "POST", token: t }); }).then(signOut, signOut); };
    s.appendChild(so); box.appendChild(s);
    box.appendChild(E("div", { class: "card" }, [E("h2", {}, ["Security notes"]), E("p", { class: "hint" }, ["Only the owner account can change anything: the database refuses edits from everyone else, and pictures can only be uploaded or deleted by the owner. Hiding the way into this page is only a convenience, not protection."]), E("p", { class: "hint" }, ["Worth checking once in your Supabase dashboard: Authentication → Sign In / Providers → turn off “Allow new users to sign up”, so nobody else can create accounts."])]));
  }

  /* =============================== validation + publish =============================== */
  function validate() {
    var errs = [], items = content.layout.items, anchors = {};
    function link(where, u) { if (u != null && String(u).trim() !== "" && !okLink(u)) errs.push(where + ": “" + u + "” is not a valid address."); }
    if (content.hero.linkedin) link("Hero LinkedIn", content.hero.linkedin);
    (content.footer.cols || []).forEach(function (c) { (c.links || []).forEach(function (l) { if (l.label && !l.url) errs.push("Footer link “" + l.label + "” has no address."); link("Footer link “" + l.label + "”", l.url); }); });
    link("Résumé LinkedIn", content.resume.linkedin);
    items.forEach(function (it) {
      var n = secName(it)[0] + (it.title ? " “" + it.title + "”" : "");
      (it.buttons || []).forEach(function (b) { link(n + " button “" + b.label + "”", b.url); });
      (it.cards || []).forEach(function (c) { link(n + " card “" + c.title + "”", c.url); });
      if (it.anchor) { if (anchors[it.anchor]) errs.push(n + ": the link name “" + it.anchor + "” is used twice."); anchors[it.anchor] = 1; if (/^(about-swap|about-swap-2|site-footer|top|portfolio|main|root)$/.test(it.anchor)) errs.push(n + ": “" + it.anchor + "” is reserved — pick another link name."); }
    });
    photos.forEach(function (p, i) { if (!p.url) errs.push("Photo " + (i + 1) + " has no picture."); });
    return errs;
  }
  function savePhotos() {
    var keep = {}; photos.forEach(function (p) { keep[p.id] = 1; });
    var del = dbIds.filter(function (id) { return !keep[id]; });
    var rows = function (off) { return photos.map(function (p, i) { return { id: p.id, position: off + i + 1, url: p.url, caption: p.caption, focus_x: Math.round(p.focus_x * 10) / 10, focus_y: Math.round(p.focus_y * 10) / 10, zoom: Math.round(p.zoom * 100) / 100 }; }); };
    var up = function (off) { return photos.length ? authed("/rest/v1/photos?on_conflict=id", { method: "POST", body: JSON.stringify(rows(off)), headers: { Prefer: "resolution=merge-duplicates,return=minimal" } }) : Promise.resolve(); };
    var rev = savedPhotoRows.length ? authed("/rest/v1/site_revisions", { method: "POST", body: JSON.stringify([{ key: "photos", value: savedPhotoRows }]), headers: { Prefer: "return=minimal" } }).catch(function () {}) : Promise.resolve();
    return rev.then(function () { return del.length ? authed("/rest/v1/photos?id=in.(" + del.join(",") + ")", { method: "DELETE" }) : null; }).then(function () { return up(1000); }).then(function () { return up(0); }).then(function () { dbIds = photos.map(function (p) { return p.id; }); });
  }
  var savedPhotoRows = [];
  function cacheAll() {
    try {
      localStorage.setItem("ezra_content_v1", JSON.stringify({ about: content.about, footer: content.footer, code: content.code, hero: content.hero, settings: content.settings, layout: content.layout }));
      localStorage.setItem("ezra_resume_v1", JSON.stringify(content.resume));
      localStorage.setItem("ezra_photos_v1", JSON.stringify(photos.map(function (p) { return { url: p.url, fx: p.focus_x, fy: p.focus_y, zoom: p.zoom }; })));
    } catch (e) {}
  }
  function publish() {
    var d = dirtyKeys(); if (!d.length) return;
    var errs = validate();
    if (errs.length) { var close; var ok = E("button", { class: "btn", type: "button" }, ["Back to editing"]); ok.onclick = function () { close(); }; close = modal([E("h2", { style: "margin:0 0 8px;font-size:16px" }, ["Please fix these first"]), E("ul", {}, errs.map(function (x) { return E("li", {}, [x]); })), E("div", { class: "row", style: "justify-content:flex-end;margin-top:12px" }, [ok])]); return; }
    var btn = $("publish"); btn.disabled = true; $("discard").disabled = true; $("st").className = "st"; $("st").textContent = "Publishing…";
    var ck = d.filter(function (k) { return k !== "photos"; }), now = new Date().toISOString(), p = Promise.resolve();
    if (ck.length) p = p.then(function () { return authed("/rest/v1/site_content?on_conflict=key", { method: "POST", body: JSON.stringify(ck.map(function (k) { return { key: k, value: content[k], updated_at: now }; })), headers: { Prefer: "resolution=merge-duplicates,return=minimal" } }); });
    if (d.indexOf("photos") >= 0) p = p.then(savePhotos);
    p.then(function () {
      ck.forEach(function (k) { saved[k] = snapshot(k); }); if (d.indexOf("photos") >= 0) { savedPhotos = photoSig(); savedPhotoRows = clone(photos); }
      cacheAll(); refreshBar(); toast("Published. Refresh the site to see it.");
    }).catch(function (e) { refreshBar(); toast("Could not publish: " + e.message); });
  }
  $("publish").onclick = publish;
  $("discard").onclick = function () { if (confirm("Throw away all unsaved changes?")) loadAll().then(function () { toast("Changes discarded"); }); };
  document.addEventListener("keydown", function (e) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (!$("publish").disabled) publish(); } });

  /* =============================== tabs / preview / boot =============================== */
  var TABS = [["sections", "Sections", drawSections], ["hero", "Hero & photos", drawHero], ["footer", "Footer", drawFooter], ["resume", "Résumé page", drawResume],
    ["design", "Design & motion", drawDesign], ["settings", "Site settings", drawSettings], ["media", "Media library", drawMedia], ["history", "History & backup", drawHistory], ["account", "Account", drawAccount]];
  var LIVE = { media: 1, history: 1, account: 1 };            // drawn each time they are opened
  function drawAll() { TABS.forEach(function (t) { if (!LIVE[t[0]]) t[2](); }); }
  var built = false;
  function buildShell() {
    if (built) return; built = true;
    var nav = $("nav"), main = $("main"); nav.appendChild(E("small", {}, ["Edit the site"]));
    TABS.forEach(function (t, i) {
      if (i === 6) nav.appendChild(E("small", {}, ["Tools"]));
      var b = E("button", { type: "button", "data-tab": t[0] }, [E("span", {}, [t[1]]), E("span", { class: "dot hide" })]);
      b.onclick = function () { openTab(t[0]); }; nav.appendChild(b);
      main.appendChild(E("div", { class: "panel" + (i ? " hide" : ""), id: "p-" + t[0] }));
    });
    openTab("sections");
    $("pvToggle").onclick = function () { $("app").classList.toggle("pv-on"); if ($("app").classList.contains("pv-on")) ensurePreview(); };
    $("pvClose").onclick = function () { $("app").classList.remove("pv-on"); };
    $("pvReload").onclick = function () { pvReady = false; $("pv").src = "./index.html?preview=1&t=" + Date.now(); };
    [].forEach.call(document.querySelectorAll(".pvbar [data-w]"), function (b) { b.onclick = function () { [].forEach.call(document.querySelectorAll(".pvbar [data-w]"), function (x) { x.classList.toggle("on", x === b); }); $("pv").style.width = b.dataset.w; }; });
  }
  function openTab(id) {
    TABS.forEach(function (t) { $("p-" + t[0]).classList.toggle("hide", t[0] !== id); if (t[0] === id && LIVE[id]) t[2](); });
    [].forEach.call($("nav").querySelectorAll("button"), function (b) { b.classList.toggle("on", b.dataset.tab === id); });
    $("main").scrollTop = 0;
  }
  function ensurePreview() { if ($("pv").getAttribute("src") === "about:blank") { pvReady = false; $("pv").src = "./index.html?preview=1"; } }
  function loadAll() {
    return CMS.loadPublic().then(function (r) {
      content = {}; KEYS.forEach(function (k) { content[k] = r.content && r.content[k] != null ? clone(r.content[k]) : undefined; });
      ensureShape(); photos = (r.photos || []).map(norm); dbIds = photos.map(function (p) { return p.id; });
      drawAll(); KEYS.forEach(function (k) { saved[k] = snapshot(k); }); savedPhotos = photoSig(); savedPhotoRows = clone(photos);
      refreshBar(); postPreview();
    });
  }
  function boot() {
    authed("/rest/v1/rpc/is_owner", { method: "POST", body: "{}" }).then(function (ok) {
      if (ok !== true) { show("deny"); return; }
      buildShell();
      return loadAll().then(function () { show("app"); if (innerWidth >= 1180) { $("app").classList.add("pv-on"); ensurePreview(); } else $("app").classList.remove("pv-on"); });
    }).catch(function (e) {
      if (e.status === 401 || /Signed out|refresh|JWT|expired/i.test(e.message)) { S = null; try { localStorage.removeItem(SK); } catch (x) {} show("login"); } else { show("login"); say("lmsg", e.message); }
    });
  }
  window.addEventListener("resize", function () { if (innerWidth < 1180) $("app").classList.remove("pv-on"); });
  try { S = JSON.parse(localStorage.getItem(SK)); } catch (e) {}
  if (S && S.refresh) boot(); else show("login");
})();
