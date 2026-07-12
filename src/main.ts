/// <reference types="@figma/plugin-typings" />

import type { ExportMessage } from './types';
import { exportSelection } from './export/selection';
import { sendExportResult } from './export/send';

const SKIP_EXPORT_CHECKLIST_KEY = 'skipExportChecklist';

figma.showUI(__html__);
figma.ui.resize(370, 520);

const sendPrefsToUi = async () => {
  const skip = (await figma.clientStorage.getAsync(SKIP_EXPORT_CHECKLIST_KEY)) === true;
  figma.ui.postMessage({
    type: 'prefs',
    skipExportChecklist: skip,
  });
};

void sendPrefsToUi();

figma.ui.onmessage = (msg: ExportMessage) => {
  if (msg.type === 'get-prefs') {
    void sendPrefsToUi();
    return;
  }

  if (msg.type === 'set-pref') {
    void (async () => {
      if (msg.key === 'skipExportChecklist') {
        if (msg.value) {
          await figma.clientStorage.setAsync(SKIP_EXPORT_CHECKLIST_KEY, true);
        } else {
          await figma.clientStorage.deleteAsync(SKIP_EXPORT_CHECKLIST_KEY);
        }
        await sendPrefsToUi();
      }
    })();
    return;
  }

  if (msg.type === 'export') {
    (async () => {
      try {
        const result = await exportSelection();
        await sendExportResult(result);
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
