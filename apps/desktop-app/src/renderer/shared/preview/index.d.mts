export const PREVIEW_LIMITS: Readonly<{
  urlChars: number;
  fileBytes: number;
  pathChars: number;
}>;
export type PreviewRequest =
  | { type: "preview.open"; url: string }
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
  mode: "url" | "inert";
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: string | null;
  externalRequest: string | null;
};
export type PreviewFile =
  | { kind: "markdown"; text: string }
  | { kind: "image"; dataUrl: string }
  | { kind: "html"; state: PreviewState };
export type PreviewResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string };
export function parseLocalUrl(raw: unknown): string | undefined;
export function parseExternalUrl(raw: unknown): string | undefined;
export function navigationDecision(
  mode: "url" | "inert",
  url: string,
): "allow" | "external" | "deny";
export function validatePreviewRequest(
  value: unknown,
): PreviewRequest | undefined;
