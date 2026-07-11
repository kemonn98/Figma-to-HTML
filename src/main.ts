/// <reference types="@figma/plugin-typings" />

import type { ExportMessage } from './types';
import { exportSelection } from './export/selection';

figma.showUI(__html__);
figma.ui.resize(370, 600);

figma.ui.onmessage = (msg: ExportMessage) => {
  if (msg.type === 'export') {
    (async () => {
      try {
        const result = await exportSelection();
        figma.ui.postMessage({
          type: 'export-result',
          html: result.html,
          css: result.css,
          frameWidth: result.frameWidth,
          frameHeight: result.frameHeight,
          assets: result.assets,
        });
      } catch (error) {
        figma.ui.postMessage({
          type: 'error',
          message: error instanceof Error ? error.message : 'Export failed.',
        });
      }
    })();
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};
