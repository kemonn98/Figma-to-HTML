# AGENTS.md — Figma to HTML

Guidance for AI agents working in this repository.

## Project overview

Figma plugin that exports a selected **auto-layout or grid frame** to **HTML + CSS**.

- Plugin name in Figma: **Figma to Codes**
- Runtime entry: `code.js` (compiled from `code.ts`)
- UI: `ui.html` (370×500)

## Repository map

| Path | Role |
|------|------|
| `code.ts` | Plugin main logic: tree walk, layout/style mapping, export |
| `code.js` | Compiled output Figma loads (gitignored) — build with `npm run build`, do not edit by hand |
| `ui.html` | Plugin UI (export, preview, HTML/CSS/Assets panels, ZIP download, progress card) |
| `manifest.json` | Figma plugin manifest |
| `tsconfig.json` | TypeScript config; includes `@figma/plugin-typings` |
| `previews/html/` | Local HTML/CSS preview samples |
| `README.md` | Feature and mapping documentation |
| `AGENTS.md` | Agent conventions and commands |
| `VERSION.md` | Changelog and current version |
| `.cursor/rules/` | Always-on Cursor rules (project context, git push release) |

## Commands

```bash
npm install
npm run build      # tsc → code.js
npm run watch      # rebuild on save
npm run lint
npm run lint:fix
```

After changing `code.ts`, always rebuild (`npm run build` or keep `watch` running) so Figma picks up `code.js`.

## Architecture notes

- UI ↔ plugin messaging: UI posts `{ type: 'export' }` or `{ type: 'cancel' }`; plugin posts `export-progress` (`message` + overall `percent` 0–100), `export-result`, or `error`.
- Export entry: `exportSelection()` → recursive `nodeToHtmlCss(...)`.
- Result includes `assets` (base64) for ZIP/`assets/` files and `previewFaIcons` (preview-only); preview rewrites asset paths to data URLs and FA `<i>` to SVG `<img>`.
- Styling: utility classes (gap/padding/font-size in **rem**) + CSS classes for shared visuals; positioning stays inline.
- Font Awesome text → CDN `<i class="fa-*">` in export; preview swaps to SVG snapshots so Pro icons still render.
- Other icon fonts → SVG file in `assets/` via `exportAsync`.
- Vectors export as `assets/*.svg` (referenced with `<img>`), not inlined markup; simple H/V dividers → CSS border.
- Layer-derived CSS class names must not start with a digit (prefix `N…`).
- HTML + CSS only — no React/JSX export path.

## Release command (prompt listener)

When the user says **`git push`**, **`git push minor`**, or **`git push major`**, follow `.cursor/rules/git-push-release.mdc`:

| Command | Version bump |
|---------|----------------|
| `git push` | patch `x.x.X` |
| `git push minor` | minor `x.X.0` |
| `git push major` | major `X.0.0` |

Order: inspect diffs → bump `VERSION.md` + `package.json` → update `README.md` + `AGENTS.md` → commit all → `git push` → `npm run build` → verify clean working tree.

## Agent conventions

1. **Edit `code.ts`, not `code.js`.** Rebuild after changes.
2. **Keep Figma typings working.** `tsconfig.json` must keep `typeRoots` for `@figma` and `"types": ["plugin-typings"]`. Top of `code.ts` has `/// <reference types="@figma/plugin-typings" />`.
3. **Strict TypeScript.** No implicit `any`; unused locals fail ESLint (`^_` prefix allowed for intentionally unused).
4. **Preserve export contracts.** Selection must be a single Frame with auto-layout or grid (`layoutMode !== 'NONE'`).
5. **Match existing mapping patterns** when adding node/style support — prefer utility classes, fall back to inline styles, reuse helpers (`getSolidFill`, `getStrokeStyles`, `getEffectsStyles`, etc.).
6. **Do not expand scope.** Avoid drive-by refactors, new docs, or unrelated cleanup unless asked.
7. **Network:** UI may load JSZip/Prism from allowed CDN domains listed in `manifest.json`.
8. **clipsContent:** always emit `overflow: hidden` (and matching `clip-path` when the frame has corner radius). Do not skip clipping for layer blur — Clip content is required for frame masking.
9. **HTML + CSS only** — no React/JSX export path.
10. **Images and SVGs** go to `assets/` in the ZIP; do not leave `#e5e7eb` placeholders when `getImageByHash` succeeds; do not inline SVG markup.
11. **Spacing/font-size** utilities use `pxToRem` (base 16).

## When changing export behavior

- Update mapping logic in `code.ts` helpers / `nodeToHtmlCss`.
- If user-facing behavior changes, update `README.md` only when asked or when the change is part of the task.
- Sanity-check with `npm run lint` and `npm run build`.

## Useful references

- [Figma Plugin API](https://www.figma.com/plugin-docs/)
- Local docs: `README.md` (node type table, layout mapping, styling approach)
