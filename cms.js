/* Shared data layer for the public site, the resume page and the admin editor.
   Uses plain fetch against Supabase's REST / Auth / Storage endpoints.
   The key below is the *publishable* key: it is meant to be public and can only do what
   the database's row-level-security rules allow (read content; writes need the owner login). */
(function () {
  var URL_ = 'https://dgvaoswcbzzcyaentjwr.supabase.co';
  var KEY = 'sb_publishable_tiOayGxwD3kqG_q-aqQ_TQ_p5Rs5hE1';
  var PUB = URL_ + '/storage/v1/object/public/site-media/';

  function api(path, o) {
    o = o || {};
    var h = { apikey: KEY };
    if (o.token) h.Authorization = 'Bearer ' + o.token;
    if (o.headers) for (var k in o.headers) h[k] = o.headers[k];
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = ctl && setTimeout(function () { ctl.abort(); }, o.timeout || 8000);
    return fetch(URL_ + path, { method: o.method || 'GET', headers: h, body: o.body, signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (t) clearTimeout(t); return r; }, function (e) { if (t) clearTimeout(t); throw e; });
  }
  function json(path, o) {
    o = o || {};
    if (o.body && typeof o.body === 'string') { o.headers = o.headers || {}; if (!o.headers['Content-Type']) o.headers['Content-Type'] = 'application/json'; }
    return api(path, o).then(function (r) {
      return r.text().then(function (txt) {
        if (!r.ok) { var m = txt; try { var j = JSON.parse(txt); m = j.error_description || j.msg || j.message || j.error || txt; } catch (e) {} var err = new Error(m || ('HTTP ' + r.status)); err.status = r.status; throw err; }
        return txt ? JSON.parse(txt) : null;
      });
    });
  }
  /* Only allow image URLs from this site's own files or this project's media bucket. */
  function safeImg(u) {
    if (typeof u !== 'string') return null;
    if (u.indexOf(PUB) === 0) return u;
    if (/^assets\/[A-Za-z0-9_\-\/.]+$/.test(u) && u.indexOf('..') < 0) return u;
    return null;
  }
  function safeHref(u) {
    if (typeof u !== 'string') return null;
    return /^(https?:\/\/|mailto:|tel:)/i.test(u.trim()) ? u.trim() : null;
  }
  function loadPublic() {
    return Promise.all([
      json('/rest/v1/site_content?select=key,value'),
      json('/rest/v1/photos?select=*&order=position.asc')
    ]).then(function (r) {
      var content = {}; (r[0] || []).forEach(function (row) { content[row.key] = row.value; });
      return { content: content, photos: r[1] || [] };
    });
  }
  window.CMS = { URL: URL_, KEY: KEY, PUB: PUB, api: api, json: json, safeImg: safeImg, safeHref: safeHref, loadPublic: loadPublic };
})();
