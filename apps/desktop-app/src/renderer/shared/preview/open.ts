// Renderer-only hand-off: other panels (terminal, file list) ask the preview tab to open a target.
export type PreviewTarget = { url: string } | { path: string };
export const PREVIEW_OPEN_EVENT = "omoc:preview-open";
let pending: PreviewTarget | undefined;
export function requestPreview(target: PreviewTarget) {
  pending = target;
  window.dispatchEvent(new Event(PREVIEW_OPEN_EVENT));
}
export function takePendingPreview() {
  const target = pending;
  pending = undefined;
  return target;
}
