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
  context: ExportContext
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

  if (parentLayoutMode && layoutGrow > 0 && !isAbsolute) {
    registerUtilityClass('flex-1', ['  flex: 1;'], context);
    addClass('flex-1');
  }

  if (parentLayoutMode && layoutAlign === 'STRETCH' && !isAbsolute) {
    registerUtilityClass('self-stretch', ['  align-self: stretch;'], context);
    addClass('self-stretch');
  }

  if (hasLayoutSizing && parentLayoutMode && !isAbsolute) {
    if (sizingHorizontal === 'FILL') {
      if (parentLayoutMode === 'HORIZONTAL') {
        registerUtilityClass('flex-1', ['  flex: 1;'], context);
        addClass('flex-1');
      } else if (parentLayoutMode === 'VERTICAL') {
        registerUtilityClass('self-stretch', ['  align-self: stretch;'], context);
        addClass('self-stretch');
      }
    }
    if (sizingVertical === 'FILL') {
      if (parentLayoutMode === 'VERTICAL') {
        registerUtilityClass('flex-1', ['  flex: 1;'], context);
        addClass('flex-1');
      } else if (parentLayoutMode === 'HORIZONTAL') {
        registerUtilityClass('self-stretch', ['  align-self: stretch;'], context);
        addClass('self-stretch');
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
      if (text.textAutoResize === 'NONE') {
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
        return { classes, styles };
      }

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
        return null; // default flex-start — omit
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
