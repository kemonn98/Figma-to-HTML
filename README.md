# Figma to HTML

A Figma plugin that exports a selected **frame with auto-layout** to **HTML + CSS**, so you can use the result in a browser or in your project.

---

## What it does

- **Input:** One frame selected in Figma that uses **auto-layout** (layout mode is not "None"). Grid layout is also supported.
- **Output:** A full HTML document and a separate CSS file (`index.html`, `styles.css`).

The plugin walks the frame tree, maps Figma’s layout and styles to HTML elements and CSS (utility-style classes + inline styles where needed), and returns the markup and CSS. The plugin UI is 370×730px.

---

## How to use

1. In Figma, select a **single frame** that has **auto-layout** or **grid layout** enabled.
2. Run the plugin (e.g. Plugins → Figma to HTML).
3. Click **Export**, review the checklist modal, then **Continue export**. HTML and CSS appear in the panels below.
4. Use **Copy** next to each panel to copy the content, or **Download ZIP** to get `index.html`, `styles.css`, and any `assets/` images.

**Requirements:**

- Exactly one node selected.
- That node must be a **Frame**.
- The frame must use **auto-layout** (Horizontal/Vertical) or **grid layout** (not "None").

---

## UI (ui.html)

- **Header:** Title "Figma to Codes", version capsule, and short instructions.
- **Export:** Opens a checklist modal (auto layout, assets, naming, clip tips) unless dismissed via “Don’t show this again” (`figma.clientStorage`); info icon reopens guidelines. After **Continue export**, a **progress modal** (dark blurred backdrop) shows the current step + % bar and rotating **Pro tips**. Preview defaults to full-width + top-aligned (header first), with zoom and drag-to-pan.
- **Download ZIP:** Builds a ZIP with HTML, CSS, and exported files under `assets/` (PNG images and SVG vectors; export first if needed). Filename: `figma-export.zip`. Large exports (total assets ≳20 MB) may skip the live preview to save memory; use **Load preview** when offered — ZIP download still works.
- **Output panels:** Tabs for **HTML**, **CSS**, and **Assets** are visible on open (placeholders until export); then show code / asset list.
- **Toasts:** Success/error only (e.g. "Export complete.", "Copied to clipboard.", "ZIP downloaded."); progress stays in the progress modal.
- **Footer:** “Plugin by SlabPixel” (link) · **Readme** opens “Why this exists” (vibe-coding context for layout, not a 100% Figma→production generator).

The plugin UI is 370×730px.

Coverage of what maps to static HTML/CSS vs out of scope: [`FEATURES.md`](FEATURES.md).

---

## Logic and features (`src/`)

Plugin logic lives under `src/` and is bundled to `code.js` with esbuild (`src/main.ts` entry).

### Export flow

- The UI sends `{ type: 'export' }` to the plugin code.
- The plugin calls `exportSelection()` (`src/export/selection.ts`), which checks selection, builds an **export context**, and runs the tree walk.
- The tree is converted recursively with `nodeToHtmlCss(...)` (`src/convert/node.ts`), which dispatches to per-type converters (`frame`, `group`, `text`, `rectangle`, `ellipse`, `vector`).
- Result: `{ html, css, frameWidth, frameHeight, assets }` (assets still as binary). IMAGE fills are re-encoded via a temporary rectangle + `exportAsync` PNG (long-edge capped at 1920 / ~2× node size; PNG preserves transparency), then `sendExportResult()` (`src/export/send.ts`) streams to the UI: `export-meta` → one `export-asset` per file (base64, then drop bytes) → `export-done`. Large asset totals defer live preview. HTML is a full document (doctype, head, body, optional Google Fonts links, link to `styles.css`). Image fills and icon/vector SVGs are written under `assets/` and referenced by relative path. CSS is written to `styles.css`.

### Node types supported

| Figma node   | HTML element | What's exported |
|-------------|-------------------|-----------------|
| **Frame**   | `<div>` / `<button>` / `<a>` | Auto-layout → flex; grid → CSS grid; sizing; fills; image fills → `assets/*.png`; radius/strokes/effects; **Clip content**; rotation; absolute children. Layer names matching Button/Btn/CTA → `<button type="button">`; Link → `<a href="#">`. Root: `width: 100%`, `max-width`, `min-height`. |
| **Text**    | `<p>` / `<img>` | All text → `<p>`. Truncate (`textTruncation: ENDING` / maxLines / fixed box) → `truncate` or `line-clamp-N` with ellipsis. Icon fonts → `assets/*.svg` via `<img>`. Mixed fills → per-segment spans. |
| **Rectangle** | `<div>` (+ optional `<img>`) | Solid fill / image asset; corner radius; strokes; effects; sizing; position; rotation. |
| **Vector / Line / Ellipse / Polygon / Star / Boolean operation** | `<div>` + `<img>` or border | Simple axis-aligned **LINE** / 2-point **VECTOR** dividers → CSS `border-top` / `border-left` (no SVG). Other shapes → `exportAsync` → `assets/*.svg`. |

Other node types are not converted.

### Styling approach

- **Markup:** HTML uses `class="..."` and `style="..."`. Positioning stays inline; shared visuals (fill, radius, shadow, color) prefer CSS classes via `styleMap`.
- **Units:** Gap and padding snap to a **4px** grid, then use **rem** (`16px = 1rem`). Font-size utilities stay unsnapped. Class names keep px tokens (`gap-16`, `text-56`). Absolute `left`/`top`/fixed sizes stay **px**.
- **Utility-style classes** (Tailwind-like): Flex, grid, gap, padding, justify (omit `justify-start`), align-items including `items-start` (CSS default is stretch), font size/weight (omit `font-400`), line-height, letter-spacing (omit `tracking-0`), font family, text align (omit `text-left`), `flex-1`, `self-stretch`.
- **Deduplication:** Same CSS signature reuses the same class via `styleMap`. Shared tokens: colors (`text-black-50`, `bg-white`), `opacity-*`, `rounded-*`, `shadow-inset-*`, `bg-grad-*` / `text-grad-*` — not the first layer’s name.
- **Linear gradients:** Invert `gradientTransform` to get handle start/end in the node box, compute CSS angle, then remap Figma stop positions onto the CSS gradient line (stops may be outside 0–100% when handles don’t span the full box).
- **Inline styles:** Positioning, transforms, overflow/clip-path, and one-off sizes.
- **Skipped:** `visible === false`, `opacity < 0.01`, empty mask source nodes (mask wrapper kept).

### Layout mapping

- **Auto-layout (flex) frames**  
  - `display: flex`; direction from layout mode (horizontal → row, vertical → column).  
  - If `layoutWrap === 'WRAP'`: `flex-wrap: wrap`; optional `align-content: space-between`; row-gap or column-gap from counter axis spacing.  
  - Gap and padding from frame properties; padding unified (`p-N`) or per side (`pt-N`, etc.).  
  - `justify-content` and `align-items` from primary/counter axis alignment.
- **Grid frames**  
  - `display: grid`; `grid-template-rows` / `grid-template-columns` from `gridRowCount` / `gridColumnCount` (repeat(N, minmax(0, 1fr))); gap from `itemSpacing`.
- **Sizing**  
  - When `layoutSizingHorizontal` / `layoutSizingVertical` exist: **FILL** → `flex-1` (primary) or `self-stretch` (counter); **FIXED** gets explicit width/height.  
  - Otherwise: `layoutGrow > 0` → `flex-1`; `layoutAlign === 'STRETCH'` → `self-stretch`. Text and rectangle get width/height when they don’t fill.  
  - Frames with auto-layout use primary/counter axis sizing mode when not using explicit layoutSizing*.
- **Absolute positioning**
  - Absolute children keep `position: absolute` (constraints → `left`/`top`/`right`/`bottom` / center transforms).
  - Parents that need a containing block get `position: relative` only if they are not already positioned (`absolute` already creates a containing block).
  - Absolute child’s `z-index` is set from its index in the parent’s children array.  
  - Constraints (min/max/center/stretch) on horizontal and vertical map to `left`/`right`/`top`/`bottom` and, for center, `transform: translateX(-50%)` / `translateY(-50%)` with optional pixel offset.  
  - Rotation is added to `transform` when non-zero.

### Helpers (summary)

- **sanitizeName:** Lowercase, strip invalid characters, spaces → hyphens, trim leading/trailing hyphens (for class names).
- **escapeHtml:** Escape special characters in text content.
- **formatNegativeClassValue:** Class-safe value (e.g. negative padding → `neg-N` in class name).
- **Font weight:** Inferred from font style string (e.g. "Bold" → 700, "Light" → 300).
- **Fills:** `appendStackedFillStyles` (layered solids/gradients/images); `getSolidFill` / `getSolidTextFill`; image scale modes via `imagePaintToBgLayer`; bound COLOR variables → `:root` custom properties when present.
- **Strokes:** `getStrokePaint` / `getStrokeStyles` — solid uniform → box-shadow inset (INSIDE), outline (OUTSIDE when excluded from layout), or border (CENTER / included); **individual** `strokeTop/Right/Bottom/LeftWeight` → `border-top` / …; gradient → border-image; dashed when dash pattern present (exact dash on vectors/SVG; CSS boxes get generic `dashed`). Extra solid strokes → stacked `box-shadow` rings.
- **Effects:** `getEffectsStyles` — drop/inner shadow → box-shadow; layer blur → `filter: blur()` (full Figma radius); background blur → `backdrop-filter`. **Corner smoothing** has no standard CSS equivalent — export uses geometric `border-radius` only.
- **Blend mode:** `mapBlendMode` → `mix-blend-mode` (only if not normal).
- **Vectors:** `isVectorNode` (VECTOR, LINE, ELLIPSE, POLYGON, STAR, BOOLEAN_OPERATION); `exportAsync` → `assets/*.svg` referenced by `<img>` (not inlined). Full ellipses prefer CSS `border-radius: 50%`.
- **Masks:** rect/ellipse/frame → `clip-path`; gradient fills → `mask-image`; vector/boolean masks → SVG `mask-image`.
- **Layout:** `isAbsoluteChild` for absolute positioning vs `position: relative` + z-index for stacking; min/max size; grid child span. FILL + `max-width` under parent `items-center|end` → `w-full` (not `self-stretch`).
- **Transform:** flip H/V from `relativeTransform`; rotate/flip use `transform-origin: center` + AABB-centered position (`src/utils/transform.ts`).

### Output format

- **HTML:** Full document with optional Google Fonts, link to `styles.css`, and body markup. Images/icons reference `assets/<name>.png` / `assets/<name>.svg`.
- **CSS:** `html { font-size: 16px; }`, `body, p { margin: 0; }`, then generated utility/component rules.
- **ZIP:** `index.html`, `styles.css`, and `assets/*` when images or SVGs were exported.

---

## Development setup

This plugin uses TypeScript and NPM.

1. **Node.js**  
   Install from [nodejs.org](https://nodejs.org/en/download/) (includes NPM).

2. **TypeScript** (global, optional for compilation):
   ```bash
   npm install -g typescript
   ```

3. **Plugin typings** (in the plugin directory):
   ```bash
   npm install --save-dev @figma/plugin-typings
   ```

4. **Build**  
   Bundle `src/main.ts` → `code.js` with esbuild (Figma runs the JS):
   ```bash
   npm run build
   ```
   Or `npm run watch` so the JS is regenerated on save.

5. **UI dependency**  
   The UI loads JSZip from CDN (`https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js`) for the Download ZIP feature. No local install required.

More details: [Figma plugin quickstart](https://www.figma.com/plugin-docs/plugin-quickstart-guide/).
