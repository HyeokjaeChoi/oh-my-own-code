import { useEffect, useMemo, useRef, useState } from "react";
import { Input, ModalSheet } from "@workbench/ui";
import {
  selectors,
  useWindowWorkbench,
  useWorkbenchSelector,
} from "../../entities/workbench/index.js";
import {
  OPEN_AUTOMATION_EVENT,
  OPEN_NOTIFICATIONS_EVENT,
  OPEN_SETTINGS_EVENT,
  PALETTE_SOURCES,
  buildPaletteEntries,
  filterPaletteEntries,
  type PaletteEntry,
} from "../../shared/palette/index.js";
import { selectionKey } from "../../shared/projection/index.js";
import type { ProjectActions } from "../../shared/project-actions/index.js";
import {
  callTerminal,
  announceTerminalStarted,
  type TerminalInfo,
} from "../../shared/terminal/index.js";
import styles from "./palette.module.css";

const startErrors: Record<string, string> = {
  UNKNOWN_SCRIPT: "package.json에 없는 스크립트입니다.",
  LIMIT_REACHED: "터미널을 더 만들 수 없습니다.",
  NOT_FOUND: "작업 공간을 찾을 수 없습니다.",
};

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

// Cmd/Ctrl+K palette: runtime commands/skills, app operations and project scripts in one list.
export function CommandPalette() {
  const { actions, store } = useWindowWorkbench();
  const selection = useWorkbenchSelector(selectors.selection);
  const catalog = useWorkbenchSelector(selectors.catalog);
  const lists = useWorkbenchSelector(selectors.lists);
  const pending = useWorkbenchSelector(selectors.pending);
  const workspaceBlocked = useWorkbenchSelector(
    selectors.workspaceMutationDisabled,
  );
  const resourceBlocked = useWorkbenchSelector(selectors.mutationDisabled);
  const connected = useWorkbenchSelector((s) => s.connection === "connected");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [project, setProject] = useState<ProjectActions>();
  const [error, setError] = useState<string>();
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "k" ||
        // macOS: Ctrl+K is native kill-line in text fields.
        !(IS_MAC
          ? event.metaKey && !event.ctrlKey
          : event.ctrlKey && !event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing
      )
        return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const workspaceId = selection.workspaceId;
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    setError(undefined);
    setProject(undefined);
    if (!workspaceId) return;
    let stale = false;
    void callTerminal<ProjectActions>({
      type: "terminal.scripts",
      workspaceId,
    }).then((r) => !stale && r.ok && setProject(r.value));
    return () => {
      stale = true;
    };
  }, [open, workspaceId]);

  const entries = useMemo(
    () =>
      open
        ? buildPaletteEntries({
            hasWorkspace: Boolean(workspaceId),
            pending,
            workspaceBlocked,
            resourceBlocked,
            connected,
            sessions: lists?.sessions.filter(
              (s) => s.workspaceId === workspaceId && !s.archived,
            ),
            currentSessionId: selection.sessionId,
            catalog,
            scripts: project?.scripts,
            packageManager: project?.packageManager,
            draft:
              store.getState().drafts[
                selectionKey(workspaceId, selection.sessionId)
              ]?.text,
          })
        : [],
    [
      open,
      workspaceId,
      pending,
      workspaceBlocked,
      resourceBlocked,
      connected,
      lists,
      selection.sessionId,
      catalog,
      project,
      store,
    ],
  );
  const shown = useMemo(
    () => filterPaletteEntries(entries, query),
    [entries, query],
  );
  const active = Math.min(index, Math.max(shown.length - 1, 0));
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active, shown]);

  const run = async (entry: PaletteEntry) => {
    if (entry.disabled) return;
    const a = entry.action;
    if (a.type === "script") {
      if (!workspaceId) return;
      const r = await callTerminal<TerminalInfo>({
        type: "terminal.start",
        workspaceId,
        script: a.script,
      });
      if (!r.ok)
        return setError(
          startErrors[r.code] ?? "스크립트를 시작하지 못했습니다.",
        );
      actions.openPanel("terminal");
      announceTerminalStarted(workspaceId, r.value.terminalId);
    } else if (a.type === "settings")
      window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT));
    else if (a.type === "notifications")
      window.dispatchEvent(new Event(OPEN_NOTIFICATIONS_EVENT));
    else if (a.type === "automation")
      window.dispatchEvent(new Event(OPEN_AUTOMATION_EVENT));
    else if (a.type === "panel") actions.openPanel(a.panel);
    else if (a.type === "session.create") {
      if (workspaceId)
        void actions.mutate({ type: "session.create", workspaceId }, true);
    } else if (a.type === "workspace.import")
      void actions.mutate({ type: "workspace.import" }, true);
    else if (a.type === "session.select")
      actions.select(workspaceId, a.sessionId);
    else actions.draft(a.text);
    setOpen(false);
  };

  return (
    <ModalSheet open={open} onOpenChange={setOpen} title="명령 팔레트">
      <Input
        className={styles.search}
        autoFocus
        value={query}
        placeholder="명령, 스킬, 동작 검색"
        aria-label="명령 검색"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={shown[active] ? `pal-${active}` : undefined}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const n = shown.length || 1;
            setIndex((active + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
          } else if (e.key === "Enter" && shown[active]) {
            e.preventDefault();
            void run(shown[active]);
          }
        }}
      />
      {error && <p role="alert">{error}</p>}
      <ul
        id="palette-list"
        ref={list}
        className={styles.list}
        role="listbox"
        aria-label="명령 목록"
      >
        {shown.map((entry, i) => (
          <li
            key={entry.id}
            id={`pal-${i}`}
            role="option"
            aria-selected={i === active}
            aria-disabled={entry.disabled}
            className={styles.item}
            data-active={i === active}
            onMouseMove={() => setIndex(i)}
            onClick={() => void run(entry)}
          >
            <span className={styles.main}>
              <span>{entry.label}</span>
              <small className={styles.source}>
                {PALETTE_SOURCES[entry.source]}
              </small>
            </span>
            {(entry.reason || entry.detail) && (
              <small className={styles.detail}>
                {entry.reason ?? entry.detail}
              </small>
            )}
          </li>
        ))}
        {!shown.length && (
          <li className={styles.empty}>일치하는 항목이 없습니다.</li>
        )}
      </ul>
    </ModalSheet>
  );
}
