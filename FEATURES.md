# FEATURES.md

Figma → static HTML/CSS fidelity checklist for **Figma to Codes**.

Status: **Done** | **Partial** | **Planned** | **Out of scope**

Scope: visual & layout fidelity to **static HTML + CSS** only. No prototype interactions, animations, sticky scroll behavior, FigJam-only nodes, or runtime JS.

---

## Node types

| Feature | Status |
|---------|--------|
| Frame / Component / Instance | Done |
| Group / Transform group | Done |
| Text / Rectangle | Done |
| Ellipse (CSS when full ellipse; arcs/donuts → SVG) | Done |
| Vector / Line / Polygon / Star / Boolean → SVG | Done |
| Axis-aligned line dividers → CSS border | Done |
| Section / Slice / Sticky / Connector / Table / Widget / Embed | Out of scope |
| Component set | Out of scope |

---

## Auto layout & sizing

| Feature | Status |
|---------|--------|
| Flex direction, gap, padding, wrap | Done |
| Justify / align (incl. `items-start`) | Done |
| FILL / HUG / FIXED sizing | Done |
| Absolute in auto layout | Done |
| min/max width & height | Done |
| strokesIncludedInLayout | Done |
| Aspect ratio lock | Out of scope (rare; no stable CSS without JS) |

---

## Grid

| Feature | Status |
|---------|--------|
| Equal `1fr` tracks from row/col count | Done |
| Child span / anchor placement | Done |
| Uneven track sizes from API | Planned (when sizes exposed) |

---

## Fills & images

| Feature | Status |
|---------|--------|
| Solid / linear (custom handles) / radial / angular | Done / Partial (diamond ≈ radial) |
| Multiple layered fills | Done |
| Image FILL / FIT / TILE / CROP | Done |
| imageTransform crop | Done (approx via size/position %) |
| Video / noise / pattern fills | Out of scope |

---

## Strokes

| Feature | Status |
|---------|--------|
| Uniform + individual T/R/B/L | Done |
| Inside / outside / center | Done |
| Dashed (generic on CSS boxes) | Done |
| Exact dash on CSS boxes | Out of scope — vectors/dividers with dash → SVG `stroke-dasharray` |
| Multiple strokes | Done (extra solids as `box-shadow` rings) |

---

## Effects

| Feature | Status |
|---------|--------|
| Drop / inner shadow | Done |
| Layer blur | Done (full Figma radius) |
| Background blur | Done (`backdrop-filter`) |
| Corner smoothing | Out of scope (no standard CSS; geometric `border-radius` only) |

---

## Text

| Feature | Status |
|---------|--------|
| Typography utilities, truncate, all `<p>` | Done |
| Mixed fills per segment | Done |
| Mixed font size/weight/family (+ letterSpacing, lineHeight, decoration, case) | Done |
| textAlignVertical | Done (fixed-height boxes → flex column) |
| paragraphIndent | Done |
| Lists | Done (`ul`/`ol` from `listOptions`) |
| OpenType features | Done (`font-feature-settings` when API exposes) |
| Prototype / heading AI tags | Out of scope / by design |

---

## Other

| Feature | Status |
|---------|--------|
| Masks (rect/ellipse/gradient) | Done |
| Vector mask as mask-image SVG | Done |
| Constraints SCALE | Done |
| Flip horizontal / vertical (`relativeTransform`) | Done |
| Variables → CSS custom properties | Done (solid fill colors when bound) |
| Prototype / animations / sticky / variants | Out of scope |

---

Update this file when a Planned item lands (→ Done/Partial).
