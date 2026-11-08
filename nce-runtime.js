(function() {
    var origin = "https://ezrassekamwa.framer.website";
    var allowed = ["https://ezrassekamwa.framer.website/"];
    var page = window.__NCE_PAGE__ || { path: "/", root: "./" };
    var relativeRoot = page.root || "./";
    var pageBase = origin + (page.path || "/");
    // Set when the site's not-found page was written to the root as 404.html
    // rather than to a directory of its own. Null otherwise.
    var notFoundPath = null;

    // www-insensitive same-site check, mirroring the server-side crawler:
    // canonical-host links (www vs bare domain) are still internal.
    function siteHost(host) {
        var h = (host || "").toLowerCase();
        return h.indexOf("www.") === 0 ? h.slice(4) : h;
    }
    var exportHost = siteHost(origin.replace(/^https?:\/\//, ""));
    function isInternalUrl(url) { return siteHost(url.host) === exportHost; }
    // A link to one of the site's files (a PDF, a photo a gallery opens) is
    // no page: the server-side pass leaves it alone (isInternalResourcePath),
    // and so does this one.
    var filePath = new RegExp("\\.(html|png|jpg|jpeg|gif|svg|css|js|pdf|ico|xml|json|txt|woff|woff2|ttf|eot|mp4|webm|mp3|webp|avif)$", "i");
    function isFileLink(url) { return filePath.test(url.pathname) || url.pathname.indexOf("/cdn-cgi/") === 0; }

    function normalizePath(pathname) {
        // Percent escapes in one case, as normalizePagePathname writes them.
        pathname = pathname.replace(/%[0-9a-f]{2}/gi, function (escape) { return escape.toUpperCase(); });
        var withoutIndex = pathname.replace(/\/index\.html$/i, "");
        var withoutTrailingSlash = withoutIndex.replace(/\/$/, "");
        // This script reads its own output again (at load, and whenever an
        // href changes). Every page's href leads back to its path by dropping
        // "/index.html"; the not-found page's is a file of its own.
        if (notFoundPath && withoutTrailingSlash === "/404.html") return notFoundPath;
        return withoutTrailingSlash || "/";
    }

    // Mirror of page-identity.ts. A query-addressed page (WordPress's default
    // /?p=123 permalinks) is a distinct document living in its own directory,
    // so the client must key on the same identity the server used — otherwise
    // a link injected at runtime resolves back to the homepage.
    var PAGE_QUERY_PARAMS = ["attachment_id","cat","cpage","p","page","page_id","paged","post","post_type","product","tag"];
    function querySignature(url) {
        var pairs = [];
        try {
            url.searchParams.forEach(function (value, key) {
                if (PAGE_QUERY_PARAMS.indexOf(key) !== -1 && value !== "") pairs.push(key + "=" + value);
            });
        } catch (e) { return ""; }
        return pairs.sort().join("&");
    }
    function identityPath(url) {
        var sig = querySignature(url);
        return normalizePath(url.pathname) + (sig ? "?" + sig : "");
    }
    function queryDirectory(url) {
        var sig = querySignature(url);
        if (!sig) return "";
        return "_q/" + sig.split("&").map(function (pair) {
            return pair.replace("=", "-").replace(/[^A-Za-z0-9._-]+/g, "_");
        }).join("__");
    }

    var currentPath = normalizePath(page.path || "/");

    // page.path is the page's DISK path (decoded, matching the ZIP entry);
    // url.pathname is percent-encoded. Compare in one space, or a page at
    // /café never recognises a link to itself. The href we EMIT stays
    // encoded — that is the form that resolves to the file we wrote.
    function decodePath(p) { try { return decodeURIComponent(p); } catch (e) { return p; } }
    function isSelfPath(clean) { return decodePath(clean) === currentPath; }

    function buildExportHref(url) {
        var clean = normalizePath(url.pathname);
        var queryDir = queryDirectory(url);
        if (!queryDir && isSelfPath(clean) && url.hash) {
            return url.hash;
        }
        if (notFoundPath && !queryDir && clean === notFoundPath) {
            return relativeRoot + "404.html" + (url.hash || "");
        }

        var base = clean === "/" ? "" : clean.substring(1);
        var dir = queryDir ? (base ? base + "/" + queryDir : queryDir) : base;
        var targetPath = !dir ? "index.html" : (!queryDir && namesHtmlFile(dir)) ? dir : dir + "/index.html";
        return relativeRoot + targetPath + (url.hash || "");
    }

    // Mirror of directoryNamesHtmlFile (page-identity.ts): a page whose
    // address names an HTML file is written as that file.
    var RESERVED_ROOT_HTML_FILES = ["404.html","search.html"];
    function namesHtmlFile(dir) {
        var lastSlash = dir.lastIndexOf("/");
        var name = decodePath(dir.slice(lastSlash + 1));
        if (!/\.html?$/i.test(name)) return false;
        return !(lastSlash === -1 && RESERVED_ROOT_HTML_FILES.indexOf(name.toLowerCase()) !== -1);
    }

    function neutralizeLink(a) {
        if (!a) return;
        var rawHref = a.getAttribute("href");
        if (!rawHref) return;
        if (a.getAttribute("data-nce-checked") === rawHref) return;

        a.setAttribute("data-nce-checked", rawHref);

        // Ignore anchors, JS, mailto, tel
        if (rawHref.indexOf("#") === 0 || rawHref.indexOf("javascript:") === 0 || rawHref.indexOf("mailto:") === 0 || rawHref.indexOf("tel:") === 0) return;

        try {
            // Crucial: Resolve against intended page URL, NOT local filesystem.
            var url = new URL(rawHref, pageBase);
            if (isInternalUrl(url) && !isFileLink(url)) {
                // Internal link
                var full = origin + identityPath(url);
                var isExported = allowed.indexOf(full) !== -1;

                if (!isExported) {
                    // Block unexported pages
                    a.setAttribute("href", "javascript:void(0)");
                    a.removeAttribute("target");
                    a.style.cursor = "default";
                } else {
                    a.setAttribute("href", buildExportHref(url));
                    if (a.style.cursor === "default") {
                        a.style.cursor = "";
                    }
                }
            } else {
                // External link
                if (a.getAttribute("target") !== "_blank") {
                    a.setAttribute("target", "_top");
                }
            }
        } catch(err) {}
    }

    // Process existing links immediately
    document.querySelectorAll("a[href]").forEach(neutralizeLink);

    // Watch for dynamically added links (e.g., React portals, dropdowns)
    var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            mutation.addedNodes.forEach(function(node) {
                if (node.nodeType === 1) { // ELEMENT_NODE
                    if (node.tagName === "A") neutralizeLink(node);
                    if (node.querySelectorAll) {
                        node.querySelectorAll("a[href]").forEach(neutralizeLink);
                    }
                }
            });
            if (mutation.type === "attributes" && mutation.attributeName === "href") {
                neutralizeLink(mutation.target);
            }
        });
    });
    // Target documentElement to catch portals/overlays injected outside <body>
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });

    // Fallback event blackhole for advanced SPAs targeting unexported links
    var events = ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend"];
    events.forEach(function(ev) {
        document.addEventListener(ev, function(e) {
            var a = e.target.closest("a");
            if (!a) return;
            var rawHref = a.getAttribute("href");
            if (!rawHref || rawHref.indexOf("#") === 0) return;

            // Blackhole neutralized links completely across all interactions
            if (rawHref.indexOf("javascript:void(0)") !== -1) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                return;
            }

            // Offline file:// routing fallback
            if (ev === "click" && window.location.protocol === "file:") {
                try {
                    var url = new URL(rawHref, pageBase);
                    if (isInternalUrl(url) && !isFileLink(url)) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();

                        var clean = normalizePath(url.pathname);
                        var full = origin + clean;
                        var isExported = allowed.indexOf(full) !== -1;
                        if (isExported) {
                            if (isSelfPath(clean) && url.hash) {
                                var el = document.querySelector(url.hash);
                                if (el) { el.scrollIntoView({ behavior: 'smooth' }); }
                                else { window.location.hash = url.hash; }
                                return;
                            }

                            window.location.href = buildExportHref(url);
                        }
                        return;
                    }
                } catch(err) {}
            }
        }, true);
    });
})();
