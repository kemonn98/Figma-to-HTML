import type { ExportContext } from '../types';

export const truncateLabel = (text: string, max = 36): string => {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)) + '…';
};

export const yieldToUi = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** Overall export progress 0–100 (single scale for the UI). */
export const reportExportProgress = async (message: string, percent: number): Promise<void> => {
  const pct = Math.round(Math.min(100, Math.max(0, percent)));
  figma.ui.postMessage({
    type: 'export-progress',
    message,
    percent: pct,
  });
  await yieldToUi();
};

/** Map layer walk progress into overall % (setup 0–5, layers 5–75). */
export const overallPercentFromLayers = (context: ExportContext): number => {
  const total = Math.max(1, context.progressTotal);
  const done = Math.min(context.progressDone, total);
  return 5 + (done / total) * 70;
};

export const countExportableNodes = (node: SceneNode): number => {
  if (node.visible === false) return 0;
  let count = 1;
  if ('children' in node && node.children) {
    for (const child of node.children) {
      count += countExportableNodes(child as SceneNode);
    }
  }
  return count;
};

/** Count unique IMAGE fill hashes (each hash is exported once). */
export const countUniqueImageHashes = (node: SceneNode, seen: Set<string>): void => {
  if (node.visible === false) return;
  if ('fills' in node && node.fills !== figma.mixed && Array.isArray(node.fills)) {
    for (const paint of node.fills) {
      if (paint.type === 'IMAGE' && paint.visible !== false && paint.imageHash) {
        seen.add(paint.imageHash);
      }
    }
  }
  if ('children' in node && node.children) {
    for (const child of node.children) {
      countUniqueImageHashes(child as SceneNode, seen);
    }
  }
};

export const tickNodeProgress = (context: ExportContext, node: SceneNode) => {
  context.progressDone += 1;
  const now = Date.now();
  const isFirst = context.progressDone === 1;
  const isLast = context.progressDone >= context.progressTotal;
  if (!isFirst && !isLast && now - context.progressLastReportAt < 200) return;
  context.progressLastReportAt = now;
  const label = truncateLabel(node.name || node.type);
  void reportExportProgress(`Converting layers… ${label}`, overallPercentFromLayers(context));
};
