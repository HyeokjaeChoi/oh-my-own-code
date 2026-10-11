import { z } from "zod";

export const MAX_TOOL_RESULT_BYTES = 8 * 1024;
const safeWebUrl = z
  .string()
  .url()
  .refine((value) => {
    try {
      return ["https:", "http:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "Only HTTP(S) URLs are supported");

const SafeText = z
  .string()
  .max(2_000)
  .refine(
    (value) => !/<\/?[a-z][\s\S]*?>/i.test(value),
    "Markup is not display text",
  );
export const LinkPreviewSchema = z
  .object({
    id: z.string().min(1).max(120),
    href: safeWebUrl,
    title: SafeText.optional(),
    description: SafeText.optional(),
    domain: SafeText.optional(),
  })
  .strict();
export type LinkPreviewPayload = z.infer<typeof LinkPreviewSchema>;

export function parseSafeLinkPreview(
  value: unknown,
): LinkPreviewPayload | null {
  try {
    const serialized = JSON.stringify(value);
    if (
      serialized === undefined ||
      new TextEncoder().encode(serialized).byteLength > MAX_TOOL_RESULT_BYTES
    )
      return null;
    return LinkPreviewSchema.parse(JSON.parse(serialized));
  } catch {
    return null;
  }
}

const MessagePartSchema = z.discriminatedUnion("type", [
  z
    .object({
      id: z.string(),
      type: z.literal("text"),
      text: z.string().max(4_000),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      type: z.literal("tool"),
      toolCallId: z.string(),
      toolName: z.string(),
      args: z.record(z.string(), z.unknown()),
      result: z.unknown(),
      status: z.enum(["complete", "error"]),
    })
    .strict(),
]);
export const SnapshotMessageSchema = z
  .object({
    id: z.string(),
    sessionId: z.string().min(1),
    role: z.enum(["user", "assistant"]),
    runId: z.string().nullable(),
    content: z.array(MessagePartSchema),
  })
  .strict();
export type SnapshotMessage = z.infer<typeof SnapshotMessageSchema>;

export const SyntheticSnapshotSchema = z
  .object({
    source: z.literal("synthetic-fixture"),
    revision: z.number().int().nonnegative(),
    eventCursor: z.number().int().nonnegative(),
    workspace: z
      .object({ id: z.string(), name: z.string(), label: z.string() })
      .strict(),
    session: z.object({ id: z.string(), title: z.string() }).strict(),
    run: z
      .object({
        id: z.string(),
        status: z.enum(["running", "complete", "unknown"]),
      })
      .strict(),
    messages: z.array(SnapshotMessageSchema),
    events: z.array(
      z.discriminatedUnion("type", [
        z
          .object({
            id: z.string(),
            sequence: z.number().int().positive(),
            type: z.literal("run.status"),
            sessionId: z.string().min(1),
            runId: z.string(),
            status: z.enum(["running", "complete", "unknown"]),
          })
          .strict(),
        z
          .object({
            id: z.string(),
            sequence: z.number().int().positive(),
            type: z.literal("message.appended"),
            sessionId: z.string().min(1),
            message: SnapshotMessageSchema,
          })
          .strict(),
      ]),
    ),
  })
  .strict();
export type SyntheticSnapshot = z.infer<typeof SyntheticSnapshotSchema>;

export const MUTATION_OPERATIONS = [
  "project.import",
  "workspace.create",
  "workspace.delete",
  "session.create",
  "session.fork",
  "session.rename",
  "session.archive",
  "session.restore",
  "session.delete",
  "message.send",
  "run.interrupt",
  "permission.decide",
  "permission.policy.update",
  "delegation.spawn",
  "tool.execute",
  "command.execute",
  "process.start",
  "process.stop",
  "file.write",
  "git.stage",
  "git.commit",
  "git.branch",
  "config.apply",
  "mcp.connect",
  "mcp.disconnect",
  "plugin.install",
  "job.create",
  "job.update",
] as const;
export type MutationOperation = (typeof MUTATION_OPERATIONS)[number];
export const mutationPath = (operation: MutationOperation) =>
  `/api/mutations/${operation}`;
