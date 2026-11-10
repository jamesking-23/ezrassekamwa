# Ezra J.L. Ssekamwa — Portfolio

Static export of the Framer portfolio, served with GitHub Pages: https://jamesking-23.github.io/ezrassekamwa/

## Site editor (no code needed)

Open the editor at `…/ezrassekamwa/admin.html` (on the live site: tap the © in the footer 10 times quickly) and sign in with the owner account. A live preview sits beside the editor; nothing goes public until **Publish** is pressed.

| Tab | What it controls |
|---|---|
| Sections | Text of About and Section 02; show/hide and reorder them; add new sections (text, image + text, cards, numbered list, numbers, quote, gallery, spacer) |
| Hero & photos | Portrait image, its description and LinkedIn link; the photo notebook (order, crop, captions) |
| Footer | Heading, intro, copyright/role lines, up to four link columns |
| Résumé page | Page title, details, every section (rename, reorder, hide, add your own), downloadable PDF |
| Design & motion | Colours of About, Section 02 and the footer (with contrast check); switches for each animation |
| Site settings | Browser-tab title, description, tab icon |
| Media library | Every uploaded picture/PDF, where it is used, delete |
| History & backup | Previous versions of everything (restore into the editor), download/load a full backup |
| Account | Change password, sign out of all devices |

### How it fits together
- `site.js` + `site.css` apply editor content to the public page (`Site.apply`), including the extra sections. `motion.js` / `motion.css` add the scroll and load animations.
- `cms.js` is the shared data layer; `admin.html` + `admin.js` + `admin.css` are the editor; `resume.html` renders the résumé page.
- Data lives in Supabase: table `site_content` (one row per area: `about`, `code`, `footer`, `hero`, `settings`, `layout`, `resume`), table `photos`, storage bucket `site-media`. Everyone can read; only the owner account can write (row-level security).
- `site_revisions` (owner-only) keeps the previous 40 versions of every area automatically (a database trigger), plus photo snapshots saved by the editor.
- Re-exporting from Framer overwrites `index.html` and `nce-runtime.js`; the customisations in them must be re-applied.
