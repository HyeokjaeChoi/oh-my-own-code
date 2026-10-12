// Wraps a flat workbench operation in the v2 envelope the host validates
// (src/workbench-contract.mjs validateEnvelope): reads carry a readId, mutations
// an operationId, and both the runtimeEpoch learned from earlier results (the
// first snapshot is the only request allowed without one).
import { READ_TYPES } from "../src/workbench-contract.mjs";

export function createWorkbenchBridge(page) {
  let runtimeEpoch;
  let sequence = 0;
  return async function bridge(operation) {
    const id = `e2e-${++sequence}`;
    const envelope = READ_TYPES.includes(operation?.type)
      ? {
          version: 2,
          readId: id,
          ...(runtimeEpoch && { runtimeEpoch }),
          operation,
        }
      : { version: 2, operationId: id, runtimeEpoch, operation };
    const result = await page.evaluate(
      (value) => window.desktopBridge.workbench(value),
      envelope,
    );
    const seen = result?.value?.runtimeEpoch ?? result?.receipt?.runtimeEpoch;
    if (typeof seen === "string") runtimeEpoch = seen;
    return result;
  };
}
