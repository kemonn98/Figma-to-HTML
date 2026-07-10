# AGENTS.md — Figma to HTML

Guidance for AI agents working in this repository.

## Project overview

Figma plugin that exports a selected **auto-layout or grid frame** to **HTML + CSS** or **React (JSX) + CSS**.

- Plugin name in Figma: **Figma to Codes**
- Runtime entry: `code.js` (compiled from `code.ts`)
- UI: `ui.html` (370×500)

## Repository map

| Path | Role |
|------|------|
| `code.ts` | Plugin main logic: tree walk, layout/style mapping, export |
| `code.js` | Compiled output Figma loads (gitignored) — build with `npm run build`, do not edit by hand |
| `ui.html` | Plugin UI (format tabs, export, copy, ZIP download) |
| `manifest.json` | Figma plugin manifest |
| `tsconfig.json` | TypeScript config; includes `@figma/plugin-typings` |
| `previews/` | Local HTML/CSS preview samples |
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

- UI ↔ plugin messaging: UI posts `{ type: 'export', format: 'html' | 'react' }` or `{ type: 'cancel' }`.
- Export entry: `exportSelection(format)` → recursive `nodeToHtmlCss(...)`.
- Styling: Tailwind-like utility classes + inline styles when needed; CSS deduped via `styleMap` / `utilityClasses`.
- HTML uses `class` / `style="..."`; React uses `className` / `style={{ ... }}`.
- Vectors (VECTOR, LINE, ELLIPSE, etc.) export as inlined SVG via `exportAsync({ format: 'SVG' })`.

## Release command (prompt listener)

When the user says **`git push`**, **`git push minor`**, or **`git push major`**, follow `.cursor/rules/git-push-release.mdc`:

| Command | Version bump |
|---------|----------------|
| `git push` | patch `x.x.X` |
| `git push minor` | minor `x.X.0` |
| `git push major` | major `X.0.0` |

Order: inspect diffs → bump `VERSION.md` + `package.json` → update `README.md` + `AGENTS.md` → commit all → `git push` → verify clean working tree.

## Agent conventions

1. **Edit `code.ts`, not `code.js`.** Rebuild after changes.
2. **Keep Figma typings working.** `tsconfig.json` must keep `typeRoots` for `@figma` and `"types": ["plugin-typings"]`. Top of `code.ts` has `/// <reference types="@figma/plugin-typings" />`.
3. **Strict TypeScript.** No implicit `any`; unused locals fail ESLint (`^_` prefix allowed for intentionally unused).
4. **Preserve export contracts.** Selection must be a single Frame with auto-layout or grid (`layoutMode !== 'NONE'`).
5. **Match existing mapping patterns** when adding node/style support — prefer utility classes, fall back to inline styles, reuse helpers (`getSolidFill`, `getStrokeStyles`, `getEffectsStyles`, etc.).
6. **Do not expand scope.** Avoid drive-by refactors, new docs, or unrelated cleanup unless asked.
7. **Network:** UI may load JSZip from allowed CDN domains listed in `manifest.json`.
8. **clipsContent:** only emit `overflow: hidden` when the frame clips and no descendant has a visible layer blur.

## When changing export behavior

- Update mapping logic in `code.ts` helpers / `nodeToHtmlCss`.
- If user-facing behavior changes, update `README.md` only when asked or when the change is part of the task.
- Sanity-check with `npm run lint` and `npm run build`.

## Useful references

- [Figma Plugin API](https://www.figma.com/plugin-docs/)
- Local docs: `README.md` (node type table, layout mapping, styling approach)
