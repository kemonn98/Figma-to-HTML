# VERSION.md

Changelog and version history for **Figma to HTML** (Figma plugin: *Figma to Codes*).

**Current version: `1.5.9`**

Source of truth for released history: commits on `main` → [kemonn98/Figma-to-HTML](https://github.com/kemonn98/Figma-to-HTML).  
`package.json` should stay in sync with the version declared here.

---

## Versioning scheme

| Segment | When to bump |
|---------|----------------|
| **MAJOR** (`X.0.0`) | Breaking export/API change, or a milestone that redefines the product |
| **MINOR** (`x.Y.0`) | New export capability or substantial UI/feature work |
| **PATCH** (`x.y.Z`) | Bug fixes, polish, docs, tooling |

---

## Unreleased

---

## 1.5.9 — 2026-07-13

**Commit:** `pending`

- UI: Preview stage background dark (`#0f0f0f`)
- UI: Preview drag-to-pan with ±¾ export pad; vertical clamp top-anchored for tall pages
- UI: Default preview fit full-width + top-aligned (header first)

---

## 1.5.8 — 2026-07-12

**Commit:** `3e544a5`

- UI: export progress + Pro tips in a popup modal with dark blurred backdrop
- Plugin window height 730px; rename coverage doc to `FEATURES.md`

---

## 1.5.7 — 2026-07-12

**Commit:** `b71c1b1`

- Export: chunked asset transfer (`export-meta` → `export-asset` × N → `export-done`) to lower peak memory and reduce Figma crashes on large sites
- Drop binary bytes after each base64 encode; defer live preview when total binary > ~20 MB (Load preview on demand; ZIP still works)
- Guardrail: limit concurrent `exportAsync` slots (2) for vectors / masks / icon SVGs
- Compress IMAGE fills before transfer: temp-rect `exportAsync` PNG with long-edge cap (1920 / 2× node); always PNG to preserve alpha
- UI: more rotating Pro tips during export (assets, preview defer, naming, layout, masks, etc.)

---

## 1.5.6 — 2026-07-12

**Commit:** `f5bfad4`

- Fidelity: background blur, min/max size, multi-fill stacks, image FILL/FIT/TILE/CROP, per-corner radius, grid child span, `strokesIncludedInLayout`, mixed text spans, vertical text align, paragraph indent, lists, OpenType features, ellipse as CSS, vector masks as SVG `mask-image`, full blur radius, radial gradient centers, CSS variables from bound fills
- Flip H/V from `relativeTransform` → `scaleX/Y(-1)`; rotate/flip pivot always center + AABB positioning
- Fix: FILL + max-width under parent `items-center|end` → `w-full` (not `self-stretch`)
- Text truncate / individual side strokes
- UI: rotating Pro tips during export; footer Readme (“Why this exists”); FEATURES.md
- Corner smoothing documented as out of scope (geometric radius only)

---

## 1.5.5 — 2026-07-11

**Commit:** `7eec8ee`

- All text nodes export as `<p>` (no `h1`–`h4` / hero heading detection)
- Linear gradients: map Figma handle start/end (via inverse `gradientTransform`) onto the CSS gradient line so custom positions remap stop % (not angle-only)
- Fix: emit `items-start` for counter-axis MIN (Top/Left) — CSS `align-items` defaults to stretch, not flex-start
- Plugin UI footer: “Plugin by SlabPixel” with link to slabpixel.com

---

## 1.5.4 — 2026-07-11

**Commit:** `e05263b`

- Style tokens: `opacity-*`, `rounded-*` / `rounded-full`, `shadow-inset-*`, `bg-grad-*`, `text-grad-*` (shared utilities, not layer names)
- Omit default utilities: `justify-start`, `items-start`, `text-left`, `font-400`, `tracking-0`
- Skip `visible === false` and `opacity < 0.01` nodes; no `opacity-0` classes
- Snap gap/padding to 4px grid before rem tokens
- Skip empty mask source nodes (wrapper only); omit default `.group` utility on passthrough groups
- Semantic hints: layer `Button`/`Link` → `<button>`/`<a href="#">`; text ≥32px → `h2`, ≥24px → `h3` (hero still `h1`)
- Fix: absolute frames keep `position: absolute` (do not overwrite with `relative` for containing block)
- Fix: reset UA `font-weight`/`font-size` on `h1`–`h3` so omitted `font-400` matches Figma

---

## 1.5.3 — 2026-07-11

**Commit:** `467aa06`

- Solid `color` / `background` styles use shared color utilities (`text-black-50`, `text-white-90`, `bg-c-0835ff`) instead of the first layer’s name
- Info icon next to Export opens guidelines; “Don’t show this again” persists via `figma.clientStorage`
- HTML / CSS / Assets tabs visible on open with empty placeholders

---

## 1.5.2 — 2026-07-11

**Commit:** `aade361`

- Export checklist modal (auto layout, assets, naming, clip tips) before starting export
- Status card: primary step text and % in white; detail (filename) in gray
- Plugin UI height 370×600

---

## 1.5.1 — 2026-07-11

**Commit:** `b4fd61c`

- Icon fonts (including Font Awesome) export as `assets/*.svg` + `<img>`; remove Font Awesome CDN from export HTML/preview
- Split plugin logic into `src/` modules; build with esbuild → `code.js`
- Use `moduleResolution: "bundler"` in tsconfig (replace deprecated `node`)

---

## 1.5.0 — 2026-07-11

**Commit:** `a198094`

- HTML + CSS only: remove React/JSX export, format tabs, `previews/react`, and `unpkg` access
- Image fills → `assets/*.png` in ZIP; vectors → `assets/*.svg` (`<img>`), not inlined SVG
- Font Awesome → CDN `<i class="fa-*">`; Pro icons use SVG snapshots in plugin preview only
- Other icon fonts → SVG assets; text newlines → `<br>`; CSS class names never start with a digit
- Simple axis-aligned LINE/2-point VECTOR dividers → CSS `border-top` / `border-left`
- Clip content always honored (`overflow` + rounded `clip-path`); groups get positioning context
- Rotated group children positioned via AABB; vector wrappers always sized
- Rem-based gap/padding/font-size; root `max-width`/`min-height`; hero large text → `<h1>`
- Plugin UI: Assets tab, version capsule, unified 0–100% export status card; toast on complete/error only
- Preview: artboard-sized scale, FA/Google Fonts links; `manifest` allows fonts CDNs

---

## 1.4.2 — 2026-07-11

**Commit:** `79d18b1`

- Gradient and dashed stroke export (solid/gradient paints, `border-image`, `border-style: dashed`)
- Skip `overflow: hidden` on clipped frames when a descendant has layer blur
- TypeScript/ESLint cleanup: Figma plugin typings in `tsconfig`, remove unused helpers
- Add `AGENTS.md`, `VERSION.md`, and Cursor rules (project context + git push release flow)
- Refresh `previews/html` sample; README stroke/docs sync

---

## 1.4.1 — 2026-02-17

**Commit:** `40bf615` — *rotation issue*

- Fix rotation handling in export (`code.ts` large update)
- Preview HTML/CSS cleanup

---

## 1.4.0 — 2026-02-15

**Commit:** `095969b` — *export support for group onj*

- Add export support for Figma **Group** / transform-group objects

---

## 1.3.0 — 2026-02-14

**Commit:** `920b5b7` — *preview features*

- Local preview workflow / samples under `previews/`

---

## 1.2.1 — 2026-02-13

**Commit:** `00dbeae` — *prettier implementation*

- Prettier / output formatting improvements

---

## 1.2.0 — 2026-02-13

**Commits:**

| Hash | Message |
|------|---------|
| `5ecacc0` | ui design updates |
| `40fb836` | ui design updates |
| `7247695` | ui major updates |
| `088a8c9` | ui major updates |

- Major plugin UI redesign (`ui.html`)
- Follow-up UI polish

---

## 1.1.0 — 2026-02-13

**Commit:** `beae29c` — *add react export features*

- Add **React (JSX) + CSS** export alongside HTML + CSS

---

## 1.0.1 — 2026-02-13

**Commit:** `e4a10f4` — *bug fix and improvement*

- Bug fixes and export quality improvements after CSS mapping work

---

## 1.0.0 — 2026-02-12

**Commits:**

| Hash | Message |
|------|---------|
| `420bd39` | major css mapping update |
| `fc8297a` | major css mapping update |

- First **stable** HTML + CSS export with major CSS/utility mapping
- Product considered feature-complete for core frame → HTML/CSS path

---

## 0.3.0 — 2026-02-12

**Commits:**

| Hash | Message |
|------|---------|
| `ba45e6b` | guards udpate |
| `46b4e1e` | readme update |
| `9c035a0` | text multi color |

- Multi-color / mixed text fill support
- Selection/export guards
- README documentation

---

## 0.2.0 — 2026-02-11

**Commits:**

| Hash | Message |
|------|---------|
| `41764cb` | major code ts update |
| `1e409e5` | code ts updates |
| `1344204` | code ts updates |

- Core `code.ts` export engine iterations

---

## 0.1.0 — 2026-02-11

**Commit:** `7844772` — *first commit*

- Initial plugin scaffold (manifest, TypeScript plugin code, UI, tooling)

---

## Commit → version index

| Date | Commit | Message | Version |
|------|--------|---------|---------|
| 2026-07-11 | `79d18b1` | gradient/dashed strokes, lint, agent docs | **1.4.2** *(current)* |
| 2026-02-17 | `40bf615` | rotation issue | 1.4.1 |
| 2026-02-15 | `095969b` | export support for group onj | 1.4.0 |
| 2026-02-14 | `920b5b7` | preview features | 1.3.0 |
| 2026-02-13 | `00dbeae` | prettier implementation | 1.2.1 |
| 2026-02-13 | `5ecacc0` … `088a8c9` | ui design / major updates | 1.2.0 |
| 2026-02-13 | `beae29c` | add react export features | 1.1.0 |
| 2026-02-13 | `e4a10f4` | bug fix and improvement | 1.0.1 |
| 2026-02-12 | `420bd39` / `fc8297a` | major css mapping update | 1.0.0 |
| 2026-02-12 | `ba45e6b` … `9c035a0` | guards, readme, text multi color | 0.3.0 |
| 2026-02-11 | `41764cb` … `1344204` | code ts updates | 0.2.0 |
| 2026-02-11 | `7844772` | first commit | 0.1.0 |

---

## How to bump next time

1. Decide MAJOR / MINOR / PATCH from the table above.
2. Add a new section under **Unreleased** → dated release heading.
3. Update **Current version** at the top of this file.
4. Set `"version"` in `package.json` to the same value.
5. Optionally tag: `git tag v1.x.y && git push origin v1.x.y`.
