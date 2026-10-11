export type ToolRow = { sign: string; text: string };
export type SearchMatch = {
  path: string | null;
  line: number | null;
  text: string;
};
export type ToolView =
  | { kind: "generic" }
  | {
      kind: "read";
      name: string;
      path: string;
      range: { start: number; end: number | null } | null;
      content: string;
    }
  | {
      kind: "diff";
      name: string;
      path: string | null;
      rows: ToolRow[];
      replaceAll: boolean;
    }
  | {
      kind: "shell";
      name: string;
      command: string;
      description: string | null;
      exitCode: number | null;
      output: string;
    }
  | {
      kind: "search";
      name: string;
      pattern: string;
      scope: string | null;
      matches: SearchMatch[];
    }
  | { kind: "web"; name: string; url: string | null; query: string | null }
  | {
      kind: "todo";
      name: string;
      items: { content: string; status: string }[];
    };
export function canonicalToolName(name: string): string;
export function deriveToolView(tool: {
  name: string;
  input: string;
  output: string;
  status: string;
}): ToolView;
export function permissionsForTool<P extends { toolId?: string }>(
  permissions: P[],
  toolId: string,
): P[];
export function effectiveToolStatus(
  status: string,
  permissions: unknown[],
): string;
