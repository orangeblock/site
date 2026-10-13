# Site design

Personal site hosting a blog (essays, multimedia) and projects (3D visualisations, three.js experiments, model viewers).

## Principles

- **Performance first.** Pages are static HTML. No SPA. JavaScript ships only where a page needs interactivity.
- **Dark-mode native.** Dark only, not black. No light theme or toggle.
- **Utilitarian, engineer-focused.** Restrained, no ornament, nothing terminal-themed or kitsch.
- **Keep it basic.** No extras that weren't asked for (reading time, copy buttons, section numbering, figure numbering).

## Visual identity

### Colour

Graphite and amber palette.

| Token        | Value     | Use                                   |
| ------------ | --------- | ------------------------------------- |
| `bg`         | `#1b1a18` | Page background                       |
| `surface`    | `#23221f` | Code blocks, figure frames            |
| `surface-2`  | `#2a2825` | Inline code background                |
| `border`     | `#34322e` | Hairlines, dividers                   |
| `text`       | `#e4ded2` | Body text                             |
| `muted`      | `#9a948a` | Metadata, nav, captions               |
| `faint`      | `#8a8378` | Code comments                         |
| `accent`     | `#e0a458` | Links, footnote markers               |

### Typography

- **Interface and headings:** IBM Plex Mono (400, 500, italic 400).
- **Prose:** Atkinson Hyperlegible Next (400, 700, italic 400).
- **Body size:** 18px, line height 1.6.
- Fonts are self-hosted WOFF2, subset to Latin.

### Motion

Short state changes only: hover and focus transitions of 150ms or less. No scroll-linked effects, no page transitions. Respect `prefers-reduced-motion`.

### Code highlighting

Custom Shiki theme ("balanced"), applied at build time:

| Token kind                 | Colour    |
| -------------------------- | --------- |
| Keywords                   | `#e0a458` |
| Functions, YAML keys       | `#a9c4b0` |
| Types, builtins            | `#d8c08a` |
| Strings                    | `#b8bb8a` |
| Numbers, booleans          | `#d3869b` |
| Decorators                 | `#c9886a` |
| Comments (italic)          | `#8a8378` |
| Punctuation, operators     | `#9a948a` |

## Layout

- Single centred column, 16px side gutter on small screens.
- **Measure:** `34.5 × body size` (621px at 18px), about 80 characters per line in Atkinson. Don't use `ch` for the measure: Atkinson's `0` is about 1.5× its average glyph width, so `66ch` gives about 99 characters.
- The measure is computed from the body size, not `em`, so elements with smaller font sizes (code, captions) share the same column width.
- **Images and figures** follow the text width by default. A figure can opt in to wide: `measure + 16rem` (877px at 18px), centred, clamped to the viewport minus gutters.
- **Code blocks** follow the text width and scroll horizontally. A block can opt in to wide, same as figures.
- **Footnotes** go at the end of the article, numbered, with back links. No margin notes.

## Pages

| Route                 | Content                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `/`                   | One-line intro, latest 5 posts, latest 3 projects, links to full lists |
| `/blog`               | All posts, one list, no year grouping or pagination                    |
| `/blog/<slug>`        | Article                                                                |
| `/blog/tags`          | All tags with post counts                                              |
| `/blog/tags/<tag>`    | Posts with that tag                                                    |
| `/projects`           | Project list (design deferred)                                         |
| `/about`              | About page                                                             |
| `/rss.xml`            | Full-content feed                                                      |

### Shared elements

- **Header:** site name (placeholder `dan/` for now) on the left; `blog projects about rss` on the right.
- **Footer:** `© year name · rss`.
- **Lists** (posts and projects): plain rows separated by hairlines. Post row: date · title · tags. Project row: date · name · one-line description. Rows stack on narrow screens. No cards, no thumbnails.
- **Article header:** date · tags (tags link to their tag page), then the title.

## Content

- Posts are MDX files in the repo.
- Frontmatter: title, date, tags. No drafts, series, or categories.
- Images live in the repo and are optimised by Astro at build time (AVIF/WebP, multiple widths). Video, audio, and some images are embedded from external hosts.
- **Embeds** (YouTube, Vimeo, etc.) show a static thumbnail and load the player only on click. No third-party requests before that.
- **3D in posts:** an island component that shows a poster image and loads three.js only when it scrolls into view. Only pages that use it ship three.js.

## Performance budget

- No JavaScript on article pages by default. Exceptions: embed facades and 3D islands on pages that use them.
- Article pages under 150KB before images.
- Fonts about 100KB total.
- Lighthouse performance score of 100 on article and list pages.

## Stack

- **Frontend:** Astro, TypeScript, MDX, plain CSS with custom properties (no Tailwind). Vue islands can be added if a component needs reactive UI; otherwise `.astro` components and small vanilla scripts.
- **Backend (later):** Python, uv, FastAPI, for project APIs and site features.

## Repo layout

```
site/    Astro site (npm)
api/     FastAPI app (later)
deploy/  Caddyfile and deploy script
docs/    Design and planning docs
```

## Hosting and deployment

- Server: 1 vCPU, 512MB RAM. Too small to build on, so builds happen locally.
- Build in `site/` on the local machine, rsync the output to the server (`deploy/deploy.sh`, details in `deploy/README.md`).
- Caddy serves static files over HTTP on the server's IP until a domain exists, then HTTPS automatically. When the API exists, Caddy reverse-proxies `/api` to uvicorn run by systemd.
- No Docker.
- 1GB swap file on the server.
- Move to GitHub Actions for builds once the repo is on GitHub.
- Cloudflare free plan in front once a domain exists.

## Deferred

- Project page and projects index design: revisit once projects exist.
- FastAPI scope and how projects are served.
- Domain, DNS, and CDN setup.
- Site name in the header.
- 404 page.
- Favicon.
