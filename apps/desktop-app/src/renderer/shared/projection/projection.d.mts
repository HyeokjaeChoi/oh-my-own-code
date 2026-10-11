import type { ThreadMessageLike } from "@assistant-ui/react";
import type { WorkbenchMessage } from "../../../desktop-bridge.js";
export function selectionKey(workspaceId?: string, sessionId?: string): string;
export function mapMessages(messages: WorkbenchMessage[]): ThreadMessageLike[];
