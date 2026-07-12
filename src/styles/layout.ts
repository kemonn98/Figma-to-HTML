import type { ExportContext } from '../types';
import { pxToRem, snapPx, roundDim } from '../utils/color';
import { formatNegativeClassValue } from '../utils/names';
import { registerUtilityClass } from './classes';

export const mapPrimaryAxis = (val: FrameNode['primaryAxisAlignItems']) => {
  switch (val) {
    case 'MIN':
      return 'flex-start';
    case 'MAX':
      return 'flex-end';
    case 'CENTER':
      return 'center';
    case 'SPACE_BETWEEN':
      return 'space-between';
    default:
      return 'flex-start';
  }
};

export const mapCounterAxis = (val: FrameNode['counterAxisAlignItems']) => {
  switch (val) {
    case 'MIN':
      return 'flex-start';
    case 'MAX':
      return 'flex-end';
    case 'CENTER':
      return 'center';
    case 'BASELINE':
      return 'baseline';
    default:
      return 'stretch';
  }
};

export const registerSizingUtilities = (
  node: SceneNode,
  parentLayoutMode: FrameNode['layoutMode'] | null,
  context: ExportContext,
  parentFrame: FrameNode | null = null
): { classes: string[]; styles: string[] } => {
  const classes: string[] = [];
  const styles: string[] = [];
  const sizingHorizontal =
    'layoutSizingHorizontal' in node ? node.layoutSizingHorizontal : null;
  const sizingVertical =
    'layoutSizingVertical' in node ? node.layoutSizingVertical : null;
  const hasLayoutSizing =
    sizingHorizontal !== null || sizingVertical !== null;
  const isAbsolute =
    parentLayoutMode !== null &&
    'layoutPositioning' in node &&
    node.layoutPositioning === 'ABSOLUTE';
  const layoutGrow =
    'layoutGrow' in node && typeof node.layoutGrow === 'number'
      ? node.layoutGrow
      : 0;
  const layoutAlign =
    'layoutAlign' in node ? node.layoutAlign : null;

  const addClass = (cls: string) => {
    if (classes.indexOf(cls) === -1) classes.push(cls);
  };

  const hasMaxWidth =
    'maxWidth' in node &&
    typeof (node as { maxWidth?: number | null }).maxWidth === 'number' &&
    (node as { maxWidth: number }).maxWidth > 0;
  const hasMaxHeight =
    'maxHeight' in node &&
    typeof (node as { maxHeight?: number | null }).maxHeight === 'number' &&
    (node as { maxHeight: number }).maxHeight > 0;

  /**
   * Parent CENTER/MAX on counter axis: `align-self: stretch` + `max-width` leaves the
   * capped box stuck at the start. Prefer `width/height: 100%` so parent `items-center|end`
   * can center the constrained child (matches Figma FILL + max size).
   */
  const parentCentersOrEndsCounter = (() => {
    if (!parentFrame || parentFrame.layoutMode === 'NONE' || parentFrame.layoutMode === 'GRID') {
      return false;
    }
    const align = parentFrame.counterAxisAlignItems;
    return align === 'CENTER' || align === 'MAX';
  })();

  let horizontalCounterFillDone = false;
  let verticalCounterFillDone = false;

  const applyHorizontalCounterFill = () => {
    if (horizontalCounterFillDone || isAbsolute) return;
    horizontalCounterFillDone = true;
    if (parentCentersOrEndsCounter && hasMaxWidth) {
      registerUtilityClass('w-full', ['  width: 100%;'], context);
      addClass('w-full');
      return;
    }
    registerUtilityClass('self-stretch', ['  align-self: stretch;'], context);
    addClass('self-stretch');
  };

  const applyVerticalCounterFill = () => {
    if (verticalCounterFillDone || isAbsolute) return;
    verticalCounterFillDone = true;
    if (parentCentersOrEndsCounter && hasMaxHeight) {
      registerUtilityClass('h-full', ['  height: 100%;'], context);
      addClass('h-full');
      return;
    }
    registerUtilityClass('self-stretch', ['  align-self: stretch;'], context);
    addClass('self-stretch');
  };

  if (parentLayoutMode && layoutGrow > 0 && !isAbsolute) {
    registerUtilityClass('flex-1', ['  flex: 1;'], context);
    addClass('flex-1');
  }

  if (parentLayoutMode && layoutAlign === 'STRETCH' && !isAbsolute) {
    if (parentLayoutMode === 'VERTICAL') applyHorizontalCounterFill();
    else if (parentLayoutMode === 'HORIZONTAL') applyVerticalCounterFill();
    else {
      registerUtilityClass('self-stretch', ['  align-self: stretch;'], context);
      addClass('self-stretch');
    }
  }

  if (hasLayoutSizing && parentLayoutMode && !isAbsolute) {
    if (sizingHorizontal === 'FILL') {
      if (parentLayoutMode === 'HORIZONTAL') {
        registerUtilityClass('flex-1', ['  flex: 1;'], context);
        addClass('flex-1');
      } else if (parentLayoutMode === 'VERTICAL') {
        applyHorizontalCounterFill();
      }
    }
    if (sizingVertical === 'FILL') {
      if (parentLayoutMode === 'VERTICAL') {
        registerUtilityClass('flex-1', ['  flex: 1;'], context);
        addClass('flex-1');
      } else if (parentLayoutMode === 'HORIZONTAL') {
        applyVerticalCounterFill();
      }
    }
  }

  if (node.type === 'TEXT') {
    const text = node as TextNode;
    if (hasLayoutSizing) {
      if (sizingHorizontal === 'FIXED') {
        styles.push(`width: ${roundDim(text.width)}px`);
      }
      if (sizingVertical === 'FIXED') {
        styles.push(`height: ${roundDim(text.height)}px`);
      }
    } else {
      if (text.textAutoResize === 'NONE' || text.textAutoResize === 'TRUNCATE') {
        styles.push(`width: ${roundDim(text.width)}px`);
        styles.push(`height: ${roundDim(text.height)}px`);
      } else if (text.textAutoResize === 'HEIGHT') {
        styles.push(`width: ${roundDim(text.width)}px`);
      }
    }
  }

  if (node.type === 'RECTANGLE') {
    const rect = node as RectangleNode;
    if (hasLayoutSizing) {
      if (sizingHorizontal === 'FIXED') {
        styles.push(`width: ${roundDim(rect.width)}px`);
      }
      if (sizingVertical === 'FIXED') {
        styles.push(`height: ${roundDim(rect.height)}px`);
      }
    } else {
      const primaryFill =
        parentLayoutMode === 'HORIZONTAL'
          ? layoutGrow > 0
          : parentLayoutMode === 'VERTICAL'
          ? layoutGrow > 0
          : false;
      const counterFill = layoutAlign === 'STRETCH';

      if (!primaryFill) {
        styles.push(`width: ${roundDim(rect.width)}px`);
      }
      if (!counterFill) {
        styles.push(`height: ${roundDim(rect.height)}px`);
      }
    }
  }

  if (node.type === 'FRAME') {
    const frame = node as FrameNode;
    if (hasLayoutSizing) {
      if (sizingHorizontal === 'FIXED') {
        styles.push(`width: ${roundDim(frame.width)}px`);
      }
      if (sizingVertical === 'FIXED') {
        styles.push(`height: ${roundDim(frame.height)}px`);
      }
    } else {
      if (frame.layoutMode === 'NONE') {
        styles.push(`width: ${roundDim(frame.width)}px`);
        styles.push(`height: ${roundDim(frame.height)}px`);
      } else {
      const primaryIsWidth = frame.layoutMode === 'HORIZONTAL';
      const primaryFixed = frame.primaryAxisSizingMode === 'FIXED';
      const counterFixed = frame.counterAxisSizingMode === 'FIXED';
      const primaryFill =
        parentLayoutMode && layoutGrow > 0;
      const counterFill = layoutAlign === 'STRETCH';

      if (primaryFixed && !primaryFill) {
        styles.push(
          `${primaryIsWidth ? 'width' : 'height'}: ${roundDim(
            primaryIsWidth ? frame.width : frame.height
          )}px`
        );
      }
      if (counterFixed && !counterFill) {
        styles.push(
          `${primaryIsWidth ? 'height' : 'width'}: ${roundDim(
            primaryIsWidth ? frame.height : frame.width
          )}px`
        );
      }
      }
    }
  }

  // Figma min/max size constraints
  if ('minWidth' in node && typeof (node as { minWidth?: number | null }).minWidth === 'number') {
    const v = (node as { minWidth: number }).minWidth;
    if (v > 0) styles.push(`min-width: ${roundDim(v)}px`);
  }
  if ('maxWidth' in node && typeof (node as { maxWidth?: number | null }).maxWidth === 'number') {
    const v = (node as { maxWidth: number }).maxWidth;
    if (v > 0) styles.push(`max-width: ${roundDim(v)}px`);
  }
  if ('minHeight' in node && typeof (node as { minHeight?: number | null }).minHeight === 'number') {
    const v = (node as { minHeight: number }).minHeight;
    if (v > 0) styles.push(`min-height: ${roundDim(v)}px`);
  }
  if ('maxHeight' in node && typeof (node as { maxHeight?: number | null }).maxHeight === 'number') {
    const v = (node as { maxHeight: number }).maxHeight;
    if (v > 0) styles.push(`max-height: ${roundDim(v)}px`);
  }

  // CSS grid child placement
  if (
    parentLayoutMode === 'GRID' &&
    'gridColumnSpan' in node &&
    typeof (node as { gridColumnSpan?: number }).gridColumnSpan === 'number'
  ) {
    const col = (node as { gridColumnAnchorIndex?: number; gridColumnSpan: number });
    const row = (node as { gridRowAnchorIndex?: number; gridRowSpan?: number });
    const colStart = (col.gridColumnAnchorIndex ?? 0) + 1;
    const colSpan = Math.max(1, col.gridColumnSpan);
    const rowStart = (row.gridRowAnchorIndex ?? 0) + 1;
    const rowSpan = Math.max(1, row.gridRowSpan ?? 1);
    styles.push(`grid-column: ${colStart} / span ${colSpan}`);
    styles.push(`grid-row: ${rowStart} / span ${rowSpan}`);
  }

  return { classes, styles };
};

export const registerGridUtilities = (frame: FrameNode, context: ExportContext): string[] => {
  if (frame.layoutMode !== 'GRID') return [];
  const classes: string[] = [];
  registerUtilityClass('grid', ['  display: grid;'], context);
  classes.push('grid');
  const rows = 'gridRowCount' in frame ? frame.gridRowCount : 1;
  const cols = 'gridColumnCount' in frame ? frame.gridColumnCount : 1;
  const rowsClass = `grid-rows-${rows}`;
  const colsClass = `grid-cols-${cols}`;
  registerUtilityClass(rowsClass, [`  grid-template-rows: repeat(${rows}, minmax(0, 1fr));`], context);
  registerUtilityClass(colsClass, [`  grid-template-columns: repeat(${cols}, minmax(0, 1fr));`], context);
  classes.push(rowsClass, colsClass);
  const gapSnapped = snapPx(frame.itemSpacing);
  if (gapSnapped !== 0) {
    const gapValue = formatNegativeClassValue(gapSnapped);
    const gapClass = `gap-${gapValue}`;
    registerUtilityClass(gapClass, [`  gap: ${pxToRem(gapSnapped)};`], context);
    classes.push(gapClass);
  }
  return classes;
};

export const registerFlexUtilities = (
  frame: FrameNode,
  context: ExportContext
): string[] => {
  const classes: string[] = [];
  registerUtilityClass('flex', ['  display: flex;'], context);
  classes.push('flex');

  const directionClass = frame.layoutMode === 'HORIZONTAL' ? 'flex-row' : 'flex-col';
  registerUtilityClass(
    directionClass,
    [`  flex-direction: ${frame.layoutMode === 'HORIZONTAL' ? 'row' : 'column'};`],
    context
  );
  classes.push(directionClass);

  if (frame.layoutWrap === 'WRAP') {
    registerUtilityClass('flex-wrap', ['  flex-wrap: wrap;'], context);
    classes.push('flex-wrap');
    if (frame.counterAxisAlignContent === 'SPACE_BETWEEN') {
      registerUtilityClass('content-between', ['  align-content: space-between;'], context);
      classes.push('content-between');
    }
    const counterSpacing = frame.counterAxisSpacing ?? frame.itemSpacing;
    if (counterSpacing != null && counterSpacing > 0) {
      const snapped = snapPx(counterSpacing);
      if (snapped > 0) {
        if (frame.layoutMode === 'HORIZONTAL') {
          const rowGapClass = `row-gap-${formatNegativeClassValue(snapped)}`;
          registerUtilityClass(rowGapClass, [`  row-gap: ${pxToRem(snapped)};`], context);
          classes.push(rowGapClass);
        } else {
          const colGapClass = `column-gap-${formatNegativeClassValue(snapped)}`;
          registerUtilityClass(colGapClass, [`  column-gap: ${pxToRem(snapped)};`], context);
          classes.push(colGapClass);
        }
      }
    }
  }

  // When SPACE_BETWEEN, Figma distributes space—don't add fixed gap (handles AUTO spacing)
  const isAutoGap = frame.primaryAxisAlignItems === 'SPACE_BETWEEN';
  if (!isAutoGap && frame.itemSpacing !== 0) {
    const snapped = snapPx(frame.itemSpacing);
    if (snapped !== 0) {
      const gapValue = formatNegativeClassValue(snapped);
      const gapClass = `gap-${gapValue}`;
      registerUtilityClass(gapClass, [`  gap: ${pxToRem(snapped)};`], context);
      classes.push(gapClass);
    }
  }

  const { paddingTop, paddingRight, paddingBottom, paddingLeft } = frame;
  const snapPad = {
    t: snapPx(paddingTop),
    r: snapPx(paddingRight),
    b: snapPx(paddingBottom),
    l: snapPx(paddingLeft),
  };
  const allSame =
    snapPad.t === snapPad.r &&
    snapPad.t === snapPad.b &&
    snapPad.t === snapPad.l;

  if (allSame) {
    if (snapPad.t !== 0) {
      const padValue = formatNegativeClassValue(snapPad.t);
      const padClass = `p-${padValue}`;
      registerUtilityClass(
        padClass,
        [`  padding: ${pxToRem(snapPad.t)};`],
        context
      );
      classes.push(padClass);
    }
  } else {
    if (snapPad.t !== 0) {
      const value = formatNegativeClassValue(snapPad.t);
      const className = `pt-${value}`;
      registerUtilityClass(className, [`  padding-top: ${pxToRem(snapPad.t)};`], context);
      classes.push(className);
    }
    if (snapPad.r !== 0) {
      const value = formatNegativeClassValue(snapPad.r);
      const className = `pr-${value}`;
      registerUtilityClass(
        className,
        [`  padding-right: ${pxToRem(snapPad.r)};`],
        context
      );
      classes.push(className);
    }
    if (snapPad.b !== 0) {
      const value = formatNegativeClassValue(snapPad.b);
      const className = `pb-${value}`;
      registerUtilityClass(
        className,
        [`  padding-bottom: ${pxToRem(snapPad.b)};`],
        context
      );
      classes.push(className);
    }
    if (snapPad.l !== 0) {
      const value = formatNegativeClassValue(snapPad.l);
      const className = `pl-${value}`;
      registerUtilityClass(
        className,
        [`  padding-left: ${pxToRem(snapPad.l)};`],
        context
      );
      classes.push(className);
    }
  }

  const justifyClass = (() => {
    switch (frame.primaryAxisAlignItems) {
      case 'MIN':
        return null; // default flex-start — omit
      case 'MAX':
        return 'justify-end';
      case 'CENTER':
        return 'justify-center';
      case 'SPACE_BETWEEN':
        return 'justify-between';
      default:
        return null;
    }
  })();
  if (justifyClass) {
    registerUtilityClass(
      justifyClass,
      [`  justify-content: ${mapPrimaryAxis(frame.primaryAxisAlignItems)};`],
      context
    );
    classes.push(justifyClass);
  }

  const itemsClass = (() => {
    switch (frame.counterAxisAlignItems) {
      case 'MIN':
        // CSS align-items defaults to stretch — must emit flex-start for Figma Top/Left
        return 'items-start';
      case 'MAX':
        return 'items-end';
      case 'CENTER':
        return 'items-center';
      case 'BASELINE':
        return 'items-baseline';
      default:
        return 'items-stretch';
    }
  })();
  if (itemsClass) {
    registerUtilityClass(
      itemsClass,
      [`  align-items: ${mapCounterAxis(frame.counterAxisAlignItems)};`],
      context
    );
    classes.push(itemsClass);
  }

  return classes;
};
