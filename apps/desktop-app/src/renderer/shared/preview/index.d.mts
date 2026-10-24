export const PREVIEW_LIMITS: Readonly<{
  urlChars: number;
  fileBytes: number;
  pathChars: number;
}>;
export const PREVIEW_SCHEME: "omoc-preview";
export type PreviewRequest =
  | { type: "preview.open"; workspaceId: string; url: string }
  | { type: "preview.openFile"; workspaceId: string; path: string }
  | {
      type: "preview.bounds";
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | { type: "preview.nav"; action: "back" | "forward" | "reload" }
  | { type: "preview.state" }
  | { type: "preview.openExternal"; url: string }
  | { type: "preview.close" };
export type PreviewState = {
  open: boolean;
  mode: "url" | "file";
  url: string;
  file: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: string | null;
  externalRequest: string | null;
};
export type PreviewFile = {
  kind: "html" | "markdown" | "image" | "pdf";
  state: PreviewState;
};
export type PreviewResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string };
export function parseLocalUrl(raw: unknown): string | undefined;
export function parseExternalUrl(raw: unknown): string | undefined;
export function navigationDecision(
  mode: "url" | "file",
  url: string,
  origin?: string,
): "allow" | "external" | "deny";
export function previewRequestAllowed(
  raw: string,
  mode: "url" | "file",
): boolean;
export function detectLocalDevUrl(text: unknown): string | undefined;
export function validatePreviewRequest(
  value: unknown,
): PreviewRequest | undefined;
