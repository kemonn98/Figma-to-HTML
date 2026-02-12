# Figma to HTML

A Figma plugin that exports a selected **frame with auto-layout** to **HTML + CSS** or **React (JSX) + CSS**, so you can use the result in a browser or in your project.

---

## What it does

- **Input:** One frame selected in Figma that uses **auto-layout** (layout mode is not "None"). Grid layout is also supported.
- **Output:** Depending on the chosen format:
  - **HTML + CSS:** A full HTML document and a separate CSS file (`index.html`, `styles.css`).
  - **React:** A JSX component file and the same CSS file (`Component.jsx`, `styles.css`).

The plugin walks the frame tree, maps Figma’s layout and styles to HTML/JSX elements and CSS (utility-style classes + inline styles where needed), and returns the markup and CSS. The plugin UI is 370×500px.

---

## How to use

1. In Figma, select a **single frame** that has **auto-layout** or **grid layout** enabled.
2. Run the plugin (e.g. Plugins → Figma to HTML).
3. Choose **HTML + CSS** or **React** in the plugin UI.
4. Click **Export** to generate the code. HTML/JSX and CSS appear in the text areas below.
5. Use **Copy** next to each panel to copy the content, or **Download ZIP** to get a ZIP with `index.html` + `styles.css` (HTML) or `Component.jsx` + `styles.css` (React).

**Requirements:**

- Exactly one node selected.
- That node must be a **Frame**.
- The frame must use **auto-layout** (Horizontal/Vertical) or **grid layout** (not "None").

---

## UI (ui.html)

- **Header:** Title "Figma to Codes" and short instructions.
- **Format tabs:** Switch between **HTML + CSS** and **React** before exporting.
- **Export:** Runs the export with the selected format; shows a progress bar and toast when done.
- **Download ZIP:** Builds a ZIP with the current HTML/JSX and CSS (export first if needed). Filename: `figma-export.zip`.
- **Output panels:** One for HTML/JSX and one for CSS, each with a copy button and resizable textarea.
- **Toasts:** Success ("Export complete.", "Copied to clipboard.", "ZIP downloaded."), error (e.g. "Select a frame with auto-layout.", "Export first to download."), and info ("Exporting…", etc.).

---

## Logic and features (code.ts)

### Export flow

- The UI sends `{ type: 'export', format: 'html' | 'react' }` to the plugin code.
- The plugin calls `exportSelection(format)`, which checks that the selection is a single frame with auto-layout or grid (not `layoutMode === 'NONE'`), builds an **export context**, and runs the tree walk.
- The tree is converted recursively with `nodeToHtmlCss(node, context, parentLayoutMode, parentFrame, outputFormat)`.
- Result: `{ format: 'html', html, css }` or `{ format: 'react', jsx, css }`. HTML is a full document (doctype, head, body, optional Google Fonts links, link to `styles.css`). React output is a default-exported function component that imports `./styles.css` and returns the JSX. CSS is shared and written to `styles.css`.

### Node types supported

| Figma node   | HTML/JSX element | What's exported |
|-------------|-------------------|-----------------|
| **Frame**   | `<div>`           | Auto-layout → flex (direction, gap, padding, justify, align, wrap, row-gap/column-gap, align-content); grid → `display: grid`, template rows/columns, gap; sizing (flex-1, self-stretch, fixed width/height); solid fill; corner radius; strokes (solid → box-shadow inset / outline / border by strokeAlign); effects (drop/inner shadow, layer blur); opacity; blend mode; clipsContent → overflow hidden; rotation; absolute children (parent gets `position: relative`). Non–auto-layout frames get fixed width/height. Image fill (no solid) → placeholder background `#e5e7eb`. Non-absolute children get `position: relative` and z-index (or reverse order if `itemReverseZIndex`). Invisible spacers (height &lt; 1, opacity ≈ 0, no children) are skipped. |
| **Text**    | `<p>`             | Characters (HTML/JSX-escaped); font size, weight, line-height, letter-spacing, font family, text align, text case (uppercase, lowercase, capitalize, small-caps), text decoration (underline, line-through); sizing; paragraph spacing (margin-bottom); absolute position; rotation. **Text color:** solid fill on node, or per-segment when fills are mixed (`getStyledTextSegments` → `<span style="...">` / `style={{ color: '...' }}` per segment). |
| **Rectangle** | `<div>`         | Solid fill; corner radius; width/height (or flex fill); strokes and effects; opacity; blend mode; absolute position; rotation. Image fill (no solid) → placeholder `#e5e7eb`. Invisible spacers skipped. |
| **Vector / Line / Ellipse / Polygon / Star / Boolean operation** | `<div>` wrapping SVG | Exported via `exportAsync({ format: 'SVG' })`, decoded and inlined; SVG IDs made unique to avoid collisions. Sizing and position classes + optional rotation. If only invisible strokes → placeholder div `#e5e7eb`. On export error, fallback placeholder. |

Other node types are not converted.

### Styling approach

- **Output format:** HTML uses `class="..."` and `style="..."`; React uses `className="..."` and `style={{ ... }}` (camelCase CSS props).
- **Utility-style classes** (Tailwind-like): Flex (`flex`, `flex-row`, `flex-col`, `flex-wrap`), grid (`grid`, `grid-rows-N`, `grid-cols-N`), gap (`gap-N`, `row-gap-N`, `column-gap-N`), content (`content-between`), padding (`p-N`, `pt-N`, `pr-N`, `pb-N`, `pl-N`), justify (`justify-start`, `justify-center`, etc.), align (`items-start`, `items-center`, etc.), font size (`text-N`), font weight (`font-N`), line-height (`leading-N`), letter-spacing (`tracking-N`), font family (`fontfam-<name>`), text align (`text-left`, `text-center`, etc.), text transform (`tt-uppercase`, etc.), text decoration (`decoration-underline`, etc.), and layout helpers (`flex-1`, `self-stretch`). Numeric values in class names can be negative (e.g. `gap-neg-4`).
- **Deduplication:** Same "CSS signature" reuses the same class name via a `styleMap`. Utility classes are registered once in `utilityClasses`.
- **Naming:** Node names are sanitized (lowercase, alphanumeric + hyphens/underscores, spaces → hyphens) and used as base class names. Duplicates get numeric suffixes (`baseName`, `baseName-2`, …).
- **Inline styles** are used when necessary: explicit dimensions, background color, border-radius, strokes (box-shadow/outline/border), effects (box-shadow, filter blur), positioning (absolute with left/right/top/bottom/transform), opacity, mix-blend-mode, overflow, box-sizing, rotation.

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
- **escapeHtml / escapeJsxText:** Escape special characters in text content (JSX also escapes `{`, `}`).
- **formatNegativeClassValue:** Class-safe value (e.g. negative padding → `neg-N` in class name).
- **Font weight:** Inferred from font style string (e.g. "Bold" → 700, "Light" → 300).
- **Fills:** `getSolidFill` (frames/rectangles), `getSolidTextFill` (text), `getSolidFillFromPaints` (mixed text segments); `hasImageFill` for placeholder background when no solid fill.
- **Strokes:** `getStrokeStyles` — solid stroke → box-shadow inset (INSIDE), outline (OUTSIDE), or border (CENTER). `hasInvisibleStrokesOnly` for vectors that become placeholders.
- **Effects:** `getEffectsStyles` — drop shadow, inner shadow → box-shadow; layer blur → filter: blur().
- **Blend mode:** `mapBlendMode` → `mix-blend-mode` (only if not normal).
- **Vectors:** `isVectorNode` (VECTOR, LINE, ELLIPSE, POLYGON, STAR, BOOLEAN_OPERATION); `decodeSvgBytes`, `makeSvgIdsUnique` for inlined SVG.
- **Layout:** `isAbsoluteChild` for absolute positioning vs `position: relative` + z-index for stacking.

### Output format

- **HTML:** Full document with `<!doctype html>`, `<html lang="en">`, head (charset, viewport, title, optional Google Fonts preconnect + link, `<link rel="stylesheet" href="styles.css">`), and body with the exported markup.
- **React:** Single file: `import './styles.css';` and a default-exported function `ExportedComponent()` returning the JSX (indented). Use with `styles.css` in the same folder.
- **CSS:** Optional `@import` for Google Fonts (used font families, excluding "font awesome"), then `body, p { margin: 0; }`, then all generated rules sorted by base name and suffix. Save as `styles.css` next to the HTML or JSX file.

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
   Compile `code.ts` to `code.js` (Figma runs the JS).  
   In VS Code: **Terminal → Run Build Task…** → choose **npm: watch** so the JS is regenerated on save.

5. **UI dependency**  
   The UI loads JSZip from CDN (`https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js`) for the Download ZIP feature. No local install required.

More details: [Figma plugin quickstart](https://www.figma.com/plugin-docs/plugin-quickstart-guide/).
