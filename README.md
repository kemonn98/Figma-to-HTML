# Figma to HTML

A Figma plugin that exports a selected **frame with auto-layout** to clean **HTML** and **CSS**, so you can use the result in a browser or in your project.

---

## What it does

- **Input:** One frame selected in Figma that uses **auto-layout** (layout mode is not "None").
- **Output:** An HTML document and a separate CSS file that reproduce the layout and styling of that frame and its children.

The plugin walks the frame tree, maps Figma’s layout and styles to HTML elements and CSS (utility-style classes + inline styles where needed), and returns both the full HTML and the CSS string (e.g. to save as `index.html` and `styles.css`).

---

## How to use

1. In Figma, select a **single frame** that has **auto-layout** enabled.
2. Run the plugin (e.g. Plugins → Figma to HTML, or as you’ve set it up).
3. Click **Export** in the plugin UI.
4. Copy or save the generated HTML and CSS (the UI may offer copy/download; implementation depends on your `ui.html`).

**Requirements:**

- Exactly one node selected.
- That node must be a **Frame**.
- The frame must use **auto-layout** (not "None").

---

## Logic and features

### Export flow

- The plugin shows a UI; when the user triggers export, it calls `exportSelection()`.
- `exportSelection()` checks that the selection is a single frame with auto-layout, then builds an **export context** (see below) and runs the tree walk.
- The tree is converted recursively with `nodeToHtmlCss(node, context, parentLayoutMode, parentFrame)`.
- The result is `{ html, css }`. The HTML is a full document (doctype, head, body) that links to `styles.css`; the CSS is the contents of that file.

### Node types supported

| Figma node   | HTML element | What’s exported |
|-------------|--------------|------------------|
| **Frame**   | `<div>`      | Auto-layout → flex (direction, gap, padding, justify, align), sizing, solid fill, corner radius, rotation, absolute children (relative container). Non–auto-layout frames get fixed width/height. |
| **Text**    | `<p>`        | Characters (HTML-escaped), font size, weight, line-height, letter-spacing, font family, text align, sizing, absolute position, rotation. |
| **Rectangle** | `<div>`    | Solid fill, corner radius, width/height (or flex fill), absolute position, rotation. |

Other node types are not converted (only Frame, Text, Rectangle are handled).

### Styling approach

- **Utility-style classes** (Tailwind-like):  
  Flex (`flex`, `flex-row`, `flex-col`), gap (`gap-N`), padding (`p-N`, `pt-N`, `pr-N`, `pb-N`, `pl-N`), justify (`justify-start`, `justify-center`, etc.), align (`items-start`, `items-center`, etc.), font size (`text-N`), font weight (`font-N`), line-height (`leading-N`), letter-spacing (`tracking-N`), font family (`fontfam-<name>`), text align (`text-left`, `text-center`, etc.), and layout helpers (`flex-1`, `self-stretch`).  
  Numeric values in class names can be negative (e.g. `gap-neg-4`).
- **Deduplication:**  
  Same “CSS signature” (e.g. same set of rules) reuses the same class name via a `styleMap`. Utility classes are registered once in a `utilityClasses` set.
- **Naming:**  
  Node names are sanitized (lowercase, alphanumeric + hyphens/underscores, spaces → hyphens) and used as base class names. Duplicates get numeric suffixes (`baseName`, `baseName-2`, …).
- **Inline styles** are used only when necessary: explicit dimensions, background color, border-radius, positioning (absolute with left/right/top/bottom/transform), and rotation when not already part of an absolute-position transform.

### Layout mapping

- **Auto-layout frames**  
  - `display: flex`; direction from layout mode (horizontal → row, vertical → column).  
  - Gap and padding from frame properties; padding can be unified (`p-N`) or per side (`pt-N`, `pr-N`, etc.).  
  - `justify-content` and `align-items` from primary/counter axis alignment.
- **Sizing**  
  - Primary axis: fixed size → width/height (depending on direction); fill → `flex: 1` (`flex-1`).  
  - Counter axis: stretch → `align-self: stretch` (`self-stretch`); otherwise explicit width/height where applicable.  
  - Text and rectangle nodes get width/height when they don’t fill.
- **Absolute positioning**  
  - If a child has absolute positioning, the parent frame gets `position: relative`.  
  - Child’s constraints (min/max/center/stretch) on horizontal and vertical are mapped to `left`/`right`/`top`/`bottom` and, for center, `transform: translateX(-50%)` / `translateY(-50%)` with optional pixel offset.  
  - Rotation is added to `transform` when non-zero.

### Helpers (summary)

- **sanitizeName:** Lowercase, strip invalid characters, spaces → hyphens, trim leading/trailing hyphens (for class names).
- **escapeHtml:** Escape `&`, `<`, `>`, `"`, `'` in text content.
- **formatNegativeClassValue:** Class-safe value (e.g. negative padding → `neg-N` in class name).
- **Font weight:** Inferred from font style string (e.g. “Bold” → 700, “Light” → 300).

### Output format

- **HTML:** Full document with `<!doctype html>`, `<html lang="en">`, head (charset, viewport, title, `<link rel="stylesheet" href="styles.css">`), and body containing the exported markup.
- **CSS:** All generated rules, sorted by base name and suffix, so you can save it as `styles.css` and use it next to the HTML file.

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

More details: [Figma plugin quickstart](https://www.figma.com/plugin-docs/plugin-quickstart-guide/).
