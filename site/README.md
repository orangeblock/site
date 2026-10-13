# site

The blog and projects site, built with Astro as static HTML. Design decisions are in [`../docs/design.md`](../docs/design.md).

## Running

All commands run from `site/`.

| Command                        | What it does                                        |
| ------------------------------ | --------------------------------------------------- |
| `npm install`                  | Install dependencies                                |
| `npm run dev`                  | Dev server at http://localhost:4321                 |
| `npx astro dev --background`   | Same, in background (`npx astro dev stop` to stop)  |
| `npm run build`                | Build the site into `dist/`                         |
| `npm run preview`              | Serve `dist/` locally to check the production build |
| `npx astro check`              | Type-check `.astro`, `.ts` and content frontmatter  |

The build downloads the fonts from Fontsource the first time, so it needs a network connection.

Deploying to the server: [`../deploy/README.md`](../deploy/README.md).

## Layout

```
src/
  content/blog/       Posts (.md or .mdx)
  content/projects/   Projects (.md or .mdx)
  components/         Figure, Wide, Embed, Scene, list components
  scenes/             three.js scenes used by <Scene>
  layouts/            Base (header/footer) and Article
  pages/              Routes, including rss.xml.ts
  styles/global.css   Colours, typography, layout
  code-theme.mjs      Syntax highlighting colours
astro.config.mjs      Site URL, fonts, MDX, code theme
```

## Writing a post

Create `src/content/blog/<slug>.mdx`, or `src/content/blog/<slug>/index.mdx` if the post has its own images. The slug becomes the URL: `/blog/<slug>/`.

```mdx
---
title: On frame budgets
date: 2026-10-13
tags: [rendering, web]
---

Body text in Markdown.[^1]

[^1]: Footnotes use standard Markdown syntax and appear at the end of the post.
```

`title` and `date` are required, `tags` is optional. Each tag gets a page at `/blog/tags/<tag>/`, and `/blog/tags/` lists them all. Plain `.md` works too if the post uses no components.

### Fixed URLs

By default the URL comes from the file path, so moving or renaming the file changes it. To pin the URL, add `slug` to the frontmatter:

```mdx
---
title: On frame budgets
date: 2026-10-13
slug: frame-budgets
---
```

The post is then served at `/blog/frame-budgets/` wherever the file lives. Slugs may contain lowercase letters, digits, hyphens and slashes; anything else fails the build. `slug` works the same way for projects.

Slugs must be unique within a collection. If two entries share one, the build only prints a `multiple entries with the same slug` warning and one entry silently replaces the other.

### Components

Import the components you need at the top of the `.mdx` file, below the frontmatter. The path depends on how deep the file is; from `src/content/blog/<slug>/index.mdx` it is `../../../components/`.

```mdx
import Figure from '../../../components/Figure.astro';
import Wide from '../../../components/Wide.astro';
import Embed from '../../../components/Embed.astro';
import Scene from '../../../components/Scene.astro';
import diagram from './diagram.png';
```

**Images**: `<Figure src={diagram} alt="..." caption="..." />`

- Local images (imported as above) are converted to AVIF/WebP at several widths during the build.
- `src` can also be an external URL string, which is used as-is.
- Add `wide` to make it wider than the text column.

**Wide code blocks**: wrap the code block in `<Wide>`, with blank lines around the fence:

````mdx
<Wide>

```python
long_line = ...
```

</Wide>
````

Normal code blocks follow the text width and scroll sideways.

**Video and other embeds**: `<Embed src="https://www.youtube-nocookie.com/embed/<id>" title="..." />`

- Shows a placeholder and loads the player only when clicked, so nothing is fetched from the third party before that.
- `thumbnail={img}` takes a local image to show instead of the plain placeholder.
- Also accepts `caption`, `wide`, and `aspect` (default `"16 / 9"`).

**3D scenes**: `<Scene name="cube" alt="..." />`

- Runs `src/scenes/cube.ts`. three.js is only downloaded when the scene scrolls into view, and rendering pauses when it scrolls out.
- `poster={img}` shows an image until the scene loads.
- Also accepts `caption`, `wide`, and `aspect`.
- To add a scene, create `src/scenes/<name>.ts` exporting `mount(canvas)`, which returns `{ start(), stop() }`. See `cube.ts`.

[`src/content/blog/style-test/index.mdx`](src/content/blog/style-test/index.mdx) uses every element and is a working reference.

## Adding a project

Create `src/content/projects/<slug>.mdx`:

```mdx
---
title: mesh-viewer
date: 2026-09-01
description: glTF viewer with orbit controls
---
```

It appears in the projects list and gets a page at `/projects/<slug>/` using the article layout. The same components work here.

## Placeholders to replace

- `site` in `astro.config.mjs` (used for absolute URLs in the RSS feed).
- The intro line in `src/pages/index.astro` and the text in `src/pages/about.astro`.
- `SITE_NAME` in `src/lib.ts`.
- The sample posts and project in `src/content/`.
