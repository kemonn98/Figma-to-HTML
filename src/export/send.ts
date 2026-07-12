import type { ExportResult, PreviewMode } from '../types';
import { uint8ToBase64 } from '../utils/html';
import { reportExportProgress, yieldToUi } from './progress';

/** Defer live preview when total binary size is large. */
export const DEFERRED_ASSET_BYTES = 20_000_000;

export const resolvePreviewMode = (assetBytesTotal: number): PreviewMode => {
  if (assetBytesTotal > DEFERRED_ASSET_BYTES) {
    return 'deferred';
  }
  return 'full';
};

/**
 * Stream export to the UI: meta → one asset at a time (drop bytes after encode) → done.
 * Avoids a single mega postMessage and lowers peak memory on the main thread.
 */
export const sendExportResult = async (result: ExportResult): Promise<void> => {
  const assets = result.assets;
  let assetBytesTotal = 0;
  for (let i = 0; i < assets.length; i++) {
    assetBytesTotal += assets[i].bytes.byteLength;
  }
  const assetCount = assets.length;
  const previewMode = resolvePreviewMode(assetBytesTotal);

  figma.ui.postMessage({
    type: 'export-meta',
    html: result.html,
    css: result.css,
    frameWidth: result.frameWidth,
    frameHeight: result.frameHeight,
    assetCount,
    assetBytesTotal,
    previewMode,
  });
  await yieldToUi();

  if (assetCount === 0) {
    await reportExportProgress('Finishing export…', 98);
  }

  for (let i = 0; i < assetCount; i++) {
    const a = assets[i];
    const pct = 85 + ((i + 1) / assetCount) * 13;
    await reportExportProgress(`Encoding asset ${i + 1}/${assetCount}… ${a.fileName}`, pct);
    const bytesBase64 = uint8ToBase64(a.bytes);
    a.bytes = new Uint8Array(0);
    figma.ui.postMessage({
      type: 'export-asset',
      index: i,
      fileName: a.fileName,
      mimeType: a.mimeType,
      bytesBase64,
    });
    await yieldToUi();
  }

  // Help GC: clear the list after streaming
  assets.length = 0;

  await reportExportProgress('Finishing export…', 99);
  figma.ui.postMessage({ type: 'export-done', ok: true });
};
