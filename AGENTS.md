# AGENTS.md — Figma to HTML

Guidance for AI agents working in this repository.

## Project overview

Figma plugin that exports a selected **auto-layout or grid frame** to **HTML + CSS**.

- Plugin name in Figma: **Figma to Codes**
- Source entry: `src/main.ts` (bundled to `code.js` via esbuild)
- UI: `ui.html` (370×600)

## Repository map

| Path | Role |
|------|------|
| `src/main.ts` | Thin entry: `showUI`, `onmessage` → `exportSelection` |
| `src/types.ts` | Shared export types (`ExportContext`, `ExportResult`, …) |
| `src/export/` | Selection export + progress reporting |
| `src/convert/` | Node → HTML dispatcher and per-type converters |
| `src/styles/` | Fills, strokes, effects, mask, layout, position, CSS classes |
| `src/assets/` | Image/SVG asset registration |
| `src/utils/` | Names, color/rem, HTML helpers |
| `code.js` | Bundled output Figma loads (gitignored) — do not edit by hand |
| `ui.html` | Plugin UI (checklist modal + info icon, always-visible HTML/CSS/Assets tabs, preview, ZIP, progress) |
| `manifest.json` | Figma plugin manifest (`main: code.js`) |
| `tsconfig.json` | Typecheck only (`noEmit`); includes `@figma/plugin-typings` |
| `previews/html/` | Local HTML/CSS preview samples |
| `README.md` | Feature and mapping documentation |
| `AGENTS.md` | Agent conventions and commands |
| `VERSION.md` | Changelog and current version |
| `.cursor/rules/` | Always-on Cursor rules (project context, git push release) |

## Commands

```bash
npm install
npm run build      # esbuild src/main.ts → code.js
npm run typecheck  # tsc --noEmit
npm run watch      # esbuild --watch
npm run lint
npm run lint:fix
```

After changing anything under `src/`, always rebuild (`npm run build` or keep `watch` running) so Figma picks up `code.js`.

## Architecture notes

- UI ↔ plugin messaging: UI posts `{ type: 'export' }`, `{ type: 'cancel' }`, `{ type: 'get-prefs' }`, or `{ type: 'set-pref' }`; plugin posts `prefs`, `export-progress`, `export-result`, or `error`. “Don’t show again” uses `figma.clientStorage` (not UI `localStorage`).
- Export entry: `exportSelection()` → recursive `nodeToHtmlCss(...)` in `src/convert/node.ts`.
- Result includes `assets` (base64) for ZIP/`assets/` files; preview rewrites asset paths to data URLs.
- Styling: utility classes (gap/padding/font-size in **rem**) + CSS classes for shared visuals; solid colors → color tokens (`text-black-50`, `bg-white`, `text-c-ff5500`) via `src/utils/color-tokens.ts`; positioning stays inline.
- Icon fonts (including Font Awesome) → SVG file in `assets/` via `exportAsync` + `<img>` (no FA CDN in export).
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

1. **Edit `src/**/*.ts`, not `code.js`.** Rebuild after changes.
2. **Keep Figma typings working.** `tsconfig.json` must keep `typeRoots` for `@figma` and `"types": ["plugin-typings"]`. `src/main.ts` has `/// <reference types="@figma/plugin-typings" />`.
3. **Strict TypeScript.** No implicit `any`; unused locals fail ESLint (`^_` prefix allowed for intentionally unused).
4. **Preserve export contracts.** Selection must be a single Frame with auto-layout or grid (`layoutMode !== 'NONE'`), or group/component/instance as currently allowed.
5. **Match existing mapping patterns** when adding node/style support — prefer utility classes, fall back to inline styles, reuse helpers in `src/styles/` and `src/utils/`.
6. **Do not expand scope.** Avoid drive-by refactors, new docs, or unrelated cleanup unless asked.
7. **Network:** UI may load JSZip/Prism from allowed CDN domains listed in `manifest.json`.
8. **clipsContent:** always emit `overflow: hidden` (and matching `clip-path` when the frame has corner radius). Do not skip clipping for layer blur — Clip content is required for frame masking.
9. **HTML + CSS only** — no React/JSX export path.
10. **Images and SVGs** go to `assets/` in the ZIP; do not leave `#e5e7eb` placeholders when `getImageByHash` succeeds; do not inline SVG markup.
11. **Spacing/font-size** utilities use `pxToRem` (base 16).

## When changing export behavior

- Update mapping logic in the relevant `src/convert/*` or `src/styles/*` module.
- If user-facing behavior changes, update `README.md` only when asked or when the change is part of the task.
- Sanity-check with `npm run lint`, `npm run typecheck`, and `npm run build`.

## Useful references

- [Figma Plugin API](https://www.figma.com/plugin-docs/)
- Local docs: `README.md` (node type table, layout mapping, styling approach)
