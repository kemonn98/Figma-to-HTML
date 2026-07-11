# Figma to HTML

A Figma plugin that exports a selected **frame with auto-layout** to **HTML + CSS**, so you can use the result in a browser or in your project.

---

## What it does

- **Input:** One frame selected in Figma that uses **auto-layout** (layout mode is not "None"). Grid layout is also supported.
- **Output:** A full HTML document and a separate CSS file (`index.html`, `styles.css`).

The plugin walks the frame tree, maps Figma’s layout and styles to HTML elements and CSS (utility-style classes + inline styles where needed), and returns the markup and CSS. The plugin UI is 370×600px.

---

## How to use

1. In Figma, select a **single frame** that has **auto-layout** or **grid layout** enabled.
2. Run the plugin (e.g. Plugins → Figma to HTML).
3. Click **Export** to generate the code. HTML and CSS appear in the panels below.
4. Use **Copy** next to each panel to copy the content, or **Download ZIP** to get `index.html`, `styles.css`, and any `assets/` images.

**Requirements:**

- Exactly one node selected.
- That node must be a **Frame**.
- The frame must use **auto-layout** (Horizontal/Vertical) or **grid layout** (not "None").

---

## UI (ui.html)

- **Header:** Title "Figma to Codes", version capsule, and short instructions.
- **Export:** Opens a checklist modal (auto layout, assets, naming, clip tips); after **Continue export**, runs the export and shows a full-width status card (primary step + % in white, detail/filename in gray, 0–100% bar).
- **Download ZIP:** Builds a ZIP with HTML, CSS, and exported files under `assets/` (PNG images and SVG vectors; export first if needed). Filename: `figma-export.zip`.
- **Output panels:** Tabs for **HTML**, **CSS**, and **Assets** (name + size list).
- **Toasts:** Success/error only (e.g. "Export complete.", "Copied to clipboard.", "ZIP downloaded."); progress stays in the status card.

The plugin UI is 370×600px.

---

## Logic and features (`src/`)

Plugin logic lives under `src/` and is bundled to `code.js` with esbuild (`src/main.ts` entry).

### Export flow

- The UI sends `{ type: 'export' }` to the plugin code.
- The plugin calls `exportSelection()` (`src/export/selection.ts`), which checks selection, builds an **export context**, and runs the tree walk.
- The tree is converted recursively with `nodeToHtmlCss(...)` (`src/convert/node.ts`), which dispatches to per-type converters (`frame`, `group`, `text`, `rectangle`, `ellipse`, `vector`).
- Result: `{ html, css, frameWidth, frameHeight, assets }`. HTML is a full document (doctype, head, body, optional Google Fonts links, link to `styles.css`). Image fills and icon/vector SVGs are written under `assets/` and referenced by relative path. CSS is written to `styles.css`.

### Node types supported

| Figma node   | HTML element | What's exported |
|-------------|-------------------|-----------------|
| **Frame**   | `<div>`           | Auto-layout → flex; grid → CSS grid; sizing; solid/gradient fills; image fills → `assets/*.png` (`<img>` or `background-image`); corner radius; strokes; effects; opacity; blend; **Clip content** (`clipsContent`) → `overflow: hidden` (+ `clip-path` when rounded — required for masking); rotation; absolute children (parent `position: relative`). Root frame uses `width: 100%`, `max-width`, `min-height`, `margin-inline: auto`. Invisible spacers skipped. |
| **Text**    | `<p>` or `<h1>` / `<img>` | Normal text → `<p>` (largest hero text ≥40px in top band → single `<h1>`). Icon fonts (Font Awesome and others with short slug) → `assets/*.svg` via `<img>`. Mixed fills → per-segment spans. |
| **Rectangle** | `<div>` (+ optional `<img>`) | Solid fill / image asset; corner radius; strokes; effects; sizing; position; rotation. |
| **Vector / Line / Ellipse / Polygon / Star / Boolean operation** | `<div>` + `<img>` or border | Simple axis-aligned **LINE** / 2-point **VECTOR** dividers → CSS `border-top` / `border-left` (no SVG). Other shapes → `exportAsync` → `assets/*.svg`. |

Other node types are not converted.

### Styling approach

- **Markup:** HTML uses `class="..."` and `style="..."`. Positioning stays inline; shared visuals (fill, radius, shadow, color) prefer CSS classes via `styleMap`.
- **Units:** Gap, padding, and font-size utilities use **rem** (`16px = 1rem`). Class names keep Figma px tokens (`gap-16`, `text-56`). Absolute `left`/`top`/fixed sizes stay **px**.
- **Utility-style classes** (Tailwind-like): Flex, grid, gap, padding, justify, align, font size/weight, line-height, letter-spacing, font family, text align/transform/decoration, `flex-1`, `self-stretch`. Zero gap/padding utilities are omitted.
- **Deduplication:** Same CSS signature reuses the same class via `styleMap`.
- **Inline styles:** Positioning, transforms, overflow/clip-path, and one-off sizes.

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
  - If any child has absolute positioning, the parent frame gets `position: relative`.  
  - Absolute child’s `z-index` is set from its index in the parent’s children array.  
  - Constraints (min/max/center/stretch) on horizontal and vertical map to `left`/`right`/`top`/`bottom` and, for center, `transform: translateX(-50%)` / `translateY(-50%)` with optional pixel offset.  
  - Rotation is added to `transform` when non-zero.

### Helpers (summary)

- **sanitizeName:** Lowercase, strip invalid characters, spaces → hyphens, trim leading/trailing hyphens (for class names).
- **escapeHtml:** Escape special characters in text content.
- **formatNegativeClassValue:** Class-safe value (e.g. negative padding → `neg-N` in class name).
- **Font weight:** Inferred from font style string (e.g. "Bold" → 700, "Light" → 300).
- **Fills:** `getSolidFill` (frames/rectangles), `getSolidTextFill` (text); `hasImageFill` for placeholder background when no solid fill.
- **Strokes:** `getStrokePaint` / `getStrokeStyles` — solid → box-shadow inset (INSIDE), outline (OUTSIDE), or border (CENTER); gradient → border-image; dashed when dash pattern present. `hasInvisibleStrokesOnly` for vectors that become placeholders.
- **Effects:** `getEffectsStyles` — drop shadow, inner shadow → box-shadow; layer blur → filter: blur().
- **Blend mode:** `mapBlendMode` → `mix-blend-mode` (only if not normal).
- **Vectors:** `isVectorNode` (VECTOR, LINE, ELLIPSE, POLYGON, STAR, BOOLEAN_OPERATION); `exportAsync` → `assets/*.svg` referenced by `<img>` (not inlined).
- **Layout:** `isAbsoluteChild` for absolute positioning vs `position: relative` + z-index for stacking.

### Output format

- **HTML:** Full document with optional Google Fonts, link to `styles.css`, and body markup. Images/icons reference `assets/<name>.png` / `assets/<name>.svg`.
- **CSS:** `html { font-size: 16px; }`, `body, p, h1 { margin: 0; }`, then generated utility/component rules (rem for spacing and font-size).
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
