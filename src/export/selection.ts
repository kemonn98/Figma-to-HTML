import type { ExportAsset, ExportContext, ExportResult } from '../types';
import { REM_BASE } from '../utils/color';
import { uint8ToBase64 } from '../utils/html';
import { isFontAwesomeFamily } from '../convert/text';
import { findHeroHeadingNodeId, nodeToHtmlCss } from '../convert/node';
import {
  reportExportProgress,
  countExportableNodes,
  countUniqueImageHashes,
} from './progress';

export const exportSelection = async (): Promise<ExportResult> => {
  await reportExportProgress('Loading page…', 1);
  await figma.currentPage.loadAsync();
  await reportExportProgress('Checking selection…', 2);
  const selection = figma.currentPage.selection[0];
  const allowedTypes = ['FRAME', 'GROUP', 'TRANSFORM_GROUP', 'COMPONENT', 'INSTANCE'];
  if (!selection || allowedTypes.indexOf(selection.type) === -1) {
    throw new Error('Select a frame, component, instance, or group.');
  }
  const rootNode = selection as SceneNode;

  await reportExportProgress('Scanning layers…', 4);
  const progressTotal = Math.max(1, countExportableNodes(rootNode));
  const imageHashes = new Set<string>();
  countUniqueImageHashes(rootNode, imageHashes);
  const imageTotal = imageHashes.size;
  if (imageTotal > 0) {
    await reportExportProgress(
      `Found ${imageTotal} image${imageTotal === 1 ? '' : 's'} to export…`,
      5
    );
  }

  const context: ExportContext = {
    nameCounts: new Map<string, number>(),
    styleMap: new Map<string, string>(),
    utilityClasses: new Set<string>(),
    styleEntries: [],
    fontFamiliesUsed: new Set<string>(),
    usedBaseClasses: new Set<string>(),
    assets: [],
    assetNameCounts: new Map<string, number>(),
    imageHashToFile: new Map<string, string>(),
    rootNode,
    rootHeight: rootNode.height,
    heroHeadingNodeId: findHeroHeadingNodeId(rootNode),
    isRootPass: true,
    progressDone: 0,
    progressTotal,
    progressLastReportAt: 0,
    imageTotal,
    imageDone: 0,
  };

  await reportExportProgress('Converting layers…', 5);
  const baseIndent = 2;
  const { html: bodyContent } = await nodeToHtmlCss(rootNode, context, null, null, null, 0, baseIndent);

  await reportExportProgress('Building CSS…', 78);
  const googleFonts = Array.from(context.fontFamiliesUsed)
    .filter((f) => !isFontAwesomeFamily(f))
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`)
    .join('&');
  const css =
    `html { font-size: ${REM_BASE}px; }\n` +
    `body, p, h1 { margin: 0; }\n\n` +
    context.styleEntries
      .sort((a, b) => {
        const baseCompare = a.baseName.localeCompare(b.baseName);
        if (baseCompare !== 0) return baseCompare;
        return a.suffix - b.suffix;
      })
      .map((entry) => entry.cssText)
      .join('');

  const frameWidth = rootNode.width;
  const frameHeight = rootNode.height;

  await reportExportProgress('Assembling HTML…', 85);
  const fontsLink =
    googleFonts.length > 0
      ? `    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?${googleFonts}&display=swap" rel="stylesheet">
`
      : '';
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Figma Export</title>
${fontsLink}    <link rel="stylesheet" href="styles.css">
  </head>
  <body>
${bodyContent}
  </body>
</html>`;

  const assets: ExportAsset[] = [];
  const assetCount = context.assets.length;
  if (assetCount === 0) {
    await reportExportProgress('Finishing export…', 98);
  }
  for (let i = 0; i < assetCount; i++) {
    const a = context.assets[i];
    const pct = 85 + ((i + 1) / assetCount) * 13;
    await reportExportProgress(`Encoding asset ${i + 1}/${assetCount}… ${a.fileName}`, pct);
    assets.push({
      fileName: a.fileName,
      bytesBase64: uint8ToBase64(a.bytes),
      mimeType: a.mimeType,
    });
  }
  await reportExportProgress('Finishing export…', 99);
  return { html, css, frameWidth, frameHeight, assets };
};
