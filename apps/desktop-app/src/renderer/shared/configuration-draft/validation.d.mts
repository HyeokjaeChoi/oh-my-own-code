export type ConfigurationDraftKind = "instructions" | "mcp";
export function configurationTargetPath(
  root: string,
  kind: ConfigurationDraftKind,
): string;
export function configurationFileContentFits(
  kind: ConfigurationDraftKind,
  text: unknown,
): boolean;
export function configurationFileWriteFits(
  kind: ConfigurationDraftKind,
  text: unknown,
): boolean;
export const CONFIGURATION_DRAFT_LIMITS: Readonly<{
  bytes: 32768;
  entries: 16;
  diffRows: 80;
}>;
export type ConfigurationIssue =
  | "empty"
  | "too_large"
  | "control_bytes"
  | "json_invalid"
  | "too_deep"
  | "unsupported_shape"
  | "invalid_server"
  | "invalid_command"
  | "invalid_url"
  | "invalid_option";
export type ConfigurationValidation = {
  status: "valid" | "invalid" | "unsupported";
  issues: ConfigurationIssue[];
};
export type ConfigurationLoadIdentity = Readonly<{
  id: string;
  epoch: string;
  workspaceId: string;
  path: string;
  kind: ConfigurationDraftKind;
  revision: number;
}>;
export type ConfigurationDraft = {
  text: string;
  baseline: string;
  revision: number;
  validation: (ConfigurationValidation & { revision: number }) | null;
  baselineFile?: { path: string; version: string };
  fileObservation?: ConfigurationLoadIdentity;
  fileSave?: {
    status: "pending" | "saved" | "denied" | "conflict" | "unknown";
    current: boolean;
    identity: Readonly<{
      operationId: string;
      epoch: string;
      workspaceId: string;
      path: string;
      kind: ConfigurationDraftKind;
      revision: number;
      floor: number;
      backupId?: string;
      request: Readonly<
        {
          type: "configuration.save";
          workspaceId: string;
          requestId: string;
          kind: ConfigurationDraftKind;
          text: string;
        } & (
          | { expectation: "version"; version: string }
          | { expectation: "missing"; version?: never }
        )
      >;
    }>;
    version?: string;
    backupId?: string;
    code?: string;
  };
  fileRequest?: ConfigurationLoadIdentity;
  fileRead?: {
    status:
      | "loading"
      | "available"
      | "missing"
      | "unsupported"
      | "unavailable"
      | "error";
    path: string;
    reason?: string;
  };
};
export const emptyConfigurationDraft: ConfigurationDraft;
export const configurationIssueMessages: Record<ConfigurationIssue, string>;
export function configurationDraftKey(
  workspaceId: string,
  path: string,
  kind: ConfigurationDraftKind,
): string;
export function configurationDraftFits(text: string): boolean;
export function validateConfigurationDraft(
  kind: ConfigurationDraftKind,
  text: string,
): ConfigurationValidation;
