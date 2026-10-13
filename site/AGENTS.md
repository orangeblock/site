# site

Astro 7 static site. Design decisions (palette, typography, layout, performance budget, routes) live in `../docs/design.md`: read it before changing styles, layout, or adding a page or component.

## Dev server

Run from this directory:

```
npx astro dev --background   # start, http://localhost:4321
npx astro dev status
npx astro dev logs
npx astro dev stop
```

Verify changes with `npx astro check` and `npm run build`.

## Working rules

- Leave git commits to the user: make the change, then report what is ready to commit.
- Build only what was asked. Suggest extras for the user to accept.
- Stay inside the performance budget in `../docs/design.md`: pages ship zero JavaScript unless a component on that page needs it.
- Check Astro APIs against `node_modules/astro` types or https://docs.astro.build before using them.

## Content

How posts, projects and the MDX components (`Figure`, `Wide`, `Embed`, `Scene`) work: `README.md`.
