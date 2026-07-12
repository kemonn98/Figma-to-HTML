/** Max concurrent `exportAsync` / heavy export I/O slots. */
const EXPORT_SLOT_LIMIT = 2;

let activeSlots = 0;
const waitQueue: Array<() => void> = [];

const acquireSlot = (): Promise<void> => {
  if (activeSlots < EXPORT_SLOT_LIMIT) {
    activeSlots += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waitQueue.push(() => {
      activeSlots += 1;
      resolve();
    });
  });
};

const releaseSlot = (): void => {
  activeSlots = Math.max(0, activeSlots - 1);
  const next = waitQueue.shift();
  if (next) next();
};

/** Run `fn` under a shared concurrency limit (guardrail for exportAsync spikes). */
export const withExportSlot = async <T>(fn: () => Promise<T>): Promise<T> => {
  await acquireSlot();
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
};
