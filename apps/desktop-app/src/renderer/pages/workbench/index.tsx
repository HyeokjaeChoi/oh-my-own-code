/* eslint-disable no-unused-vars -- Type parameter names describe callbacks; TypeScript unused checks remain enabled. */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ActionMenu, Button, Input, ModalSheet } from "@workbench/ui";
import {
  Bell,
  ChevronDown,
  Clock,
  Database,
  Folder,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Settings,
  SquarePen,
  SquareTerminal,
} from "lucide-react";
import { ActivityPanel } from "../../widgets/activity/index.js";
import {
  SessionNavigation,
  isPlaceholderTitle,
  sessionSuccessor,
  titleFromPrompt,
  withDisplayTitles,
} from "../../features/sessions/index.js";
import {
  OPEN_AUTOMATION_EVENT,
  OPEN_DATA_EVENT,
  OPEN_EXTENSIONS_EVENT,
  OPEN_NOTIFICATIONS_EVENT,
  OPEN_SETTINGS_EVENT,
} from "../../shared/palette/index.js";
import { NotificationCenter } from "../../features/notifications/index.js";
import { SettingsHost } from "../../widgets/settings/index.js";
import { CommandPalette } from "../../features/palette/index.js";
import { Conversation } from "../../widgets/conversation/index.js";
import { TerminalPanel } from "../../widgets/terminal/index.js";
import { PreviewPanel } from "../../widgets/preview/index.js";
import { PlansPanel } from "../../widgets/plans/index.js";
import { ChangesPanel } from "../../widgets/changes/index.js";
import { SidePanel } from "./side-panel.js";
import { FileExplorer } from "../../widgets/explorer/index.js";
import {
  composerOperation,
  rejectionMessage,
  transientRejection,
  selectors,
  currentGitReviewObservation,
  recoveryMessages,
  useWorkbenchSelector,
  useWindowWorkbench,
  type Panel,
} from "../../entities/workbench/index.js";
import type {
  WorktreeRequest,
  WorktreeResult,
} from "../../../desktop-bridge.js";
import { selectionKey } from "../../shared/projection/index.js";
import styles from "./shell.module.css";

const MIN_PANEL_WIDTH = 320;
const DEFAULT_PANEL_WIDTH = 420;
const states: Record<string, string> = {
  loading: "런타임 확인 중…",
  disconnected: "연결 끊김",
  unavailable: "사용 불가",
};
export function Workbench() {
  const { actions, store } = useWindowWorkbench();
  const recovery = useWorkbenchSelector(selectors.recovery);
  const gitObservation = useWorkbenchSelector(currentGitReviewObservation);
  // 변경 is the default tab once a current Git read shows changes.
  const hasChanges =
    gitObservation?.status === "available" && gitObservation.files.length > 0;
  const globalDisabled = useWorkbenchSelector(
    selectors.workspaceMutationDisabled,
  );
  const resourceDisabled = useWorkbenchSelector(selectors.mutationDisabled);
  const executionAvailable = useWorkbenchSelector(selectors.interruptAvailable);
  const snapshot = useWorkbenchSelector(selectors.snapshot);
  const selection = useWorkbenchSelector(selectors.selection);
  const catalog = useWorkbenchSelector(selectors.catalog);
  const lists = useWorkbenchSelector(selectors.lists);
  const connection = useWorkbenchSelector((s) => s.connection);
  const pending = useWorkbenchSelector(selectors.pending);
  const error = useWorkbenchSelector((s) => s.error);
  const errorOp = useWorkbenchSelector((s) => s.errorOp);
  const notice = useWorkbenchSelector((s) => s.notice);
  const catalogError = useWorkbenchSelector((s) => s.catalogError);
  const unknown = useWorkbenchSelector(selectors.unknown);
  const operations = useWorkbenchSelector((s) => s.operations);
  const unknownSessionIds = Object.values(operations)
    .filter(
      (i) =>
        i.status === "unknown" &&
        "workspaceId" in i.operation &&
        i.operation.workspaceId === selection.workspaceId &&
        "sessionId" in i.operation,
    )
    .map((i) => ("sessionId" in i.operation ? i.operation.sessionId : ""));
  const retainedCount = Object.values(operations).filter(
    (i) => i.hostHeld,
  ).length;
  const resourceRecovery =
    recovery?.resources.filter(
      (r) => r.workspaceId === selection.workspaceId,
    ) ?? [];
  const storeReason =
    recovery?.store.state === "recovery_required"
      ? recovery.store.reason
      : null;
  const recoveryReasons = [
    ...new Set([
      ...(storeReason ? [storeReason] : []),
      ...resourceRecovery.map((r) => r.reason),
    ]),
  ];
  const workbench = {
    ...actions,
    error,
    notice,
    catalogError,
    unknown,
    unknownSessionIds,
  };
  const mutate = actions.mutate;
  useEffect(() => {
    if (!error || composerOperation(errorOp) || !transientRejection(error))
      return;
    const timer = setTimeout(actions.clearError, 10000);
    return () => clearTimeout(timer);
  }, [error, errorOp, actions]);
  const key = selectionKey(selection.workspaceId, selection.sessionId);
  const { wide, navigation, panel, panelWidth } = useWorkbenchSelector(
    selectors.layout,
  );
  const setNavigation = (value: boolean | ((previous: boolean) => boolean)) =>
    actions.layout({
      navigation:
        typeof value === "function"
          ? value(store.getState().layout.navigation)
          : value,
    });
  const setPanel = (panel: Panel | null) =>
    panel ? actions.openPanel(panel) : actions.closePanel();
  const setPanelWidth = (panelWidth: number) => actions.layout({ panelWidth });
  const [createOpen, setCreateOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  const [worktreeBranch, setWorktreeBranch] = useState("");
  const [worktreeBase, setWorktreeBase] = useState("HEAD");
  const [worktreePath, setWorktreePath] = useState("");
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const [worktreeMessage, setWorktreeMessage] = useState("");
  // Physical delete: reasons are shown first; force needs a second explicit click.
  const [deleteReasons, setDeleteReasons] = useState<string[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importPath, setImportPath] = useState("");
  const navigationButton = useRef<HTMLButtonElement>(null);
  const panelButton = useRef<HTMLButtonElement>(null);
  const createInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const switcherButton = useRef<HTMLButtonElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const settingsRow = useRef<HTMLButtonElement>(null);
  const sheetReturn = useRef<HTMLElement | null>(null);
  // First prompt per session whose stored title is still a placeholder.
  const [derivedTitles, setDerivedTitles] = useState<Record<string, string>>(
    {},
  );
  const drag = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 900px)");
    const threeColumns = window.matchMedia("(min-width: 1200px)");
    const resize = () => {
      actions.layout({
        wide: media.matches,
        navigation: media.matches && (!panel || threeColumns.matches),
      });
    };
    media.addEventListener("change", resize);
    threeColumns.addEventListener("change", resize);
    return () => {
      media.removeEventListener("change", resize);
      threeColumns.removeEventListener("change", resize);
    };
  }, [panel, actions]);
  useEffect(() => {
    if (createOpen) createInput.current?.focus();
  }, [createOpen]);
  useEffect(() => {
    if (!importOpen) return;
    // Let the menu's focus restoration settle before focusing the field.
    const frame = requestAnimationFrame(() => importInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [importOpen]);
  const workspace = lists?.workspaces.find(
    (item) => item.id === selection.workspaceId,
  );
  const session = snapshot?.sessions.find(
    (item) =>
      item.id === selection.sessionId &&
      item.workspaceId === selection.workspaceId,
  );
  const displaySessions = useMemo(
    () => withDisplayTitles(lists?.sessions ?? [], derivedTitles),
    [lists?.sessions, derivedTitles],
  );
  const displayTitle =
    displaySessions.find((item) => item.id === session?.id)?.title ??
    session?.title;
  const hasMessages = (snapshot?.messages.length ?? 0) > 0;
  const firstPrompt = (snapshot?.messages ?? []).find(
    (message) => message.role === "user" && message.text.trim(),
  )?.text;
  useEffect(() => {
    if (!session || !firstPrompt || !isPlaceholderTitle(session.title)) return;
    // Set once: the message window slides, the first prompt must not retitle.
    setDerivedTitles((previous) =>
      previous[session.id]
        ? previous
        : { ...previous, [session.id]: titleFromPrompt(firstPrompt) },
    );
  }, [session, firstPrompt]);
  const permissionIds = useMemo(
    () => [...new Set((snapshot?.permissions ?? []).map((p) => p.sessionId))],
    [snapshot?.permissions],
  );
  const connected = connection === "connected";
  // Sheets return focus here; narrow nav closes, so its opener is the target.
  const openSheet = (event: string, from: HTMLElement | null) => {
    sheetReturn.current = from;
    if (!wide) {
      setNavigation(false);
      sheetReturn.current = navigationButton.current;
    }
    window.dispatchEvent(new Event(event));
  };
  const newSession = () => {
    if (selection.workspaceId)
      void mutate(
        { type: "session.create", workspaceId: selection.workspaceId },
        true,
      );
  };
  const closeNavigation = () => {
    setNavigation(false);
    // The header toggle mounts once the sidebar is gone.
    requestAnimationFrame(() => navigationButton.current?.focus());
  };
  const closePanel = () => {
    setPanel(null);
    panelButton.current?.focus();
  };
  const openPanel = (next: Panel) => {
    actions.openPanel(next);
  };
  // The conversation menu links to the extension settings page.
  const openConversationPanel = (next: "files" | "extensions") =>
    next === "extensions"
      ? window.dispatchEvent(new Event(OPEN_EXTENSIONS_EVENT))
      : openPanel(next);
  const worktreeCall = async (
    request: WorktreeRequest,
  ): Promise<WorktreeResult> => {
    setWorktreeBusy(true);
    try {
      return await window.desktopBridge.worktree(request);
    } catch {
      return { ok: false, code: "RUNTIME_ERROR" };
    } finally {
      setWorktreeBusy(false);
    }
  };
  const createWorktree = async () => {
    if (!workspace) return;
    const result = await worktreeCall({
      type: "worktree.create",
      workspaceId: workspace.id,
      branch: worktreeBranch.trim(),
      base: worktreeBase.trim(),
      ...(worktreePath.trim() ? { path: worktreePath.trim() } : {}),
    });
    if (!result.ok) {
      setWorktreeMessage(`워크트리를 만들지 못했습니다 (${result.code})`);
      return;
    }
    setWorktreeMessage("");
    setWorktreeOpen(false);
    setWorktreeBranch("");
    setWorktreePath("");
    // Typed-path import registers the new worktree without a dialog.
    if (result.value.path)
      void mutate({ type: "workspace.import", path: result.value.path }, true);
  };
  const physicalDelete = async (force: boolean) => {
    if (!workspace) return;
    const result = await worktreeCall({
      type: "worktree.delete",
      workspaceId: workspace.id,
      ...(force ? { force: true } : {}),
    });
    if (result.ok) {
      setDeleteReasons(null);
      setWorktreeMessage("");
      void mutate(
        { type: "workspace.remove", workspaceId: workspace.id },
        true,
      );
    } else if (result.code === "UNSAFE") {
      setDeleteReasons(result.reasons ?? []);
    } else {
      setDeleteReasons(null);
      setWorktreeMessage(
        result.code === "NOT_DELETABLE"
          ? "가져온 폴더는 실제 삭제할 수 없습니다. 목록에서만 제거할 수 있습니다."
          : result.code === "CANCELLED"
            ? ""
            : `실제 삭제하지 못했습니다 (${result.code})`,
      );
    }
  };
  const maxPanelWidth = () =>
    Math.max(MIN_PANEL_WIDTH, Math.round(window.innerWidth * 0.6));
  const clampWidth = (value: number) =>
    Math.min(maxPanelWidth(), Math.max(MIN_PANEL_WIDTH, value));
  const navigationContent = (
    <div className={styles.navigationBody}>
      <div className={styles.workspaceSelector}>
        <ActionMenu
          label={`작업 공간 전환: ${workspace?.name ?? "선택 없음"}`}
          title="작업 공간 전환"
          triggerRef={switcherButton}
          align="start"
          className={styles.switcher ?? ""}
          contentClassName={styles.switcherMenu ?? ""}
          trigger={
            <>
              <Folder size={16} aria-hidden="true" />
              <span className={styles.switcherName}>
                {workspace?.name ?? "작업 공간 선택"}
              </span>
              <ChevronDown size={14} aria-hidden="true" />
            </>
          }
          items={[
            ...(lists?.workspaces ?? []).map((item) => ({
              label: `${item.name}${item.branch ? ` · ${item.branch}` : ""}`,
              checked: item.id === selection.workspaceId,
              value: item.id,
              onSelect: () => {
                if (item.id === selection.workspaceId) return;
                workbench.select(
                  item.id,
                  sessionSuccessor(lists?.sessions ?? [], item.id),
                );
                if (!wide) closeNavigation();
              },
            })),
            { separator: true as const },
            {
              label: "폴더 열기…",
              disabled: pending || globalDisabled,
              onSelect: () => {
                void mutate({ type: "workspace.import" }, true);
              },
            },
            {
              label: "경로로 열기…",
              disabled: pending || globalDisabled,
              onSelect: () => setImportOpen(true),
            },
            {
              label: "새 작업 공간",
              disabled: pending || globalDisabled,
              onSelect: () => setCreateOpen(true),
            },
            {
              label: "새 워크트리…",
              disabled: !workspace || pending || globalDisabled,
              onSelect: () => setWorktreeOpen(true),
            },
            { separator: true as const },
            {
              label: "저장 위치와 보관 정보",
              disabled: !workspace,
              onSelect: () => setLocationOpen(true),
            },
          ]}
        />
        <ActionMenu
          label="작업 공간 관리"
          title="작업 공간 관리"
          className={styles.iconButton ?? ""}
          trigger={<MoreHorizontal size={18} />}
          items={[
            {
              label: `‘${displayTitle ?? "세션"}’ 대화 기록 삭제…`,
              danger: true,
              disabled:
                !selection.workspaceId ||
                !selection.sessionId ||
                pending ||
                resourceDisabled,
              onSelect: () => {
                if (selection.workspaceId && selection.sessionId)
                  void mutate(
                    {
                      type: "session.remove",
                      workspaceId: selection.workspaceId,
                      sessionId: selection.sessionId,
                      requestId: crypto.randomUUID(),
                    },
                    true,
                  );
              },
            },
            { separator: true as const },
            {
              label: "실제 삭제… · 디스크에서 폴더 삭제",
              danger: true,
              disabled:
                !workspace ||
                pending ||
                worktreeBusy ||
                resourceDisabled ||
                Boolean(
                  lists?.sessions.some(
                    (item) =>
                      item.workspaceId === workspace?.id &&
                      item.status !== "idle",
                  ),
                ),
              onSelect: () => void physicalDelete(false),
            },
            {
              label: "목록에서 제거 · 파일 유지",
              danger: true,
              disabled:
                !workspace ||
                pending ||
                resourceDisabled ||
                Boolean(
                  lists?.sessions.some(
                    (item) =>
                      item.workspaceId === workspace?.id &&
                      item.status !== "idle",
                  ),
                ),
              onSelect: () => {
                if (workspace)
                  void mutate(
                    { type: "workspace.remove", workspaceId: workspace.id },
                    true,
                  );
              },
            },
          ]}
        />
        {wide && (
          <Button
            size="compact"
            className={styles.iconButton}
            onClick={closeNavigation}
            aria-label="탐색 닫기"
            title="탐색 닫기"
          >
            <PanelLeft size={18} />
          </Button>
        )}
      </div>
      {worktreeMessage && <p role="alert">{worktreeMessage}</p>}
      {deleteReasons && (
        <div
          className={styles.createFolder}
          role="alertdialog"
          aria-label="실제 삭제 경고"
        >
          <p>삭제하면 되돌릴 수 없는 작업이 있습니다.</p>
          <ul>
            {deleteReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <div className={styles.formActions}>
            <Button
              intent="primary"
              disabled={worktreeBusy}
              onClick={() => void physicalDelete(true)}
            >
              위험을 알고 강제로 삭제
            </Button>
            <Button onClick={() => setDeleteReasons(null)}>취소</Button>
          </div>
        </div>
      )}
      {worktreeOpen && (
        <form
          className={styles.createFolder}
          onSubmit={(event) => {
            event.preventDefault();
            void createWorktree();
          }}
        >
          <label>
            새 브랜치 이름
            <Input
              value={worktreeBranch}
              maxLength={100}
              required
              onChange={(event) => setWorktreeBranch(event.target.value)}
              placeholder="feature/my-change"
            />
          </label>
          <label>
            기준 ref
            <Input
              value={worktreeBase}
              maxLength={100}
              required
              onChange={(event) => setWorktreeBase(event.target.value)}
            />
          </label>
          <label>
            위치 (선택, 절대 경로)
            <Input
              value={worktreePath}
              maxLength={1024}
              onChange={(event) => setWorktreePath(event.target.value)}
              placeholder="비우면 Documents/OhMyOwnCode 아래 자동 생성"
            />
          </label>
          <div className={styles.formActions}>
            <Button
              intent="primary"
              type="submit"
              disabled={pending || globalDisabled || worktreeBusy}
            >
              워크트리 만들기
            </Button>
            <Button type="button" onClick={() => setWorktreeOpen(false)}>
              취소
            </Button>
          </div>
        </form>
      )}
      {workspace && (workspace.branch || workspace.writable === false) && (
        <p className={styles.muted} aria-label="작업 공간 상태">
          {workspace.branch ? `브랜치 ${workspace.branch}` : ""}
          {workspace.branch && workspace.writable === false ? " · " : ""}
          {workspace.writable === false ? "읽기 전용" : ""}
        </p>
      )}
      {importOpen && (
        <form
          className={styles.createFolder}
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              { type: "workspace.import", path: importPath.trim() },
              true,
            ).then((ok) => {
              if (ok) {
                setImportOpen(false);
                setImportPath("");
              }
            });
          }}
        >
          <label>
            폴더 경로
            <Input
              value={importPath}
              maxLength={2048}
              onChange={(event) => setImportPath(event.target.value)}
              placeholder="/Users/me/project"
              ref={importInput}
            />
          </label>
          <p>선택기와 같은 신뢰 확인을 거칩니다.</p>
          <div className={styles.formActions}>
            <Button
              intent="primary"
              type="submit"
              disabled={
                pending || globalDisabled || !importPath.trim().startsWith("/")
              }
            >
              경로로 가져오기
            </Button>
            <Button type="button" onClick={() => setImportOpen(false)}>
              취소
            </Button>
          </div>
        </form>
      )}
      {createOpen && (
        <form
          className={styles.createFolder}
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              {
                type: "workspace.create",
                ...(folderName.trim() ? { name: folderName.trim() } : {}),
              },
              true,
            ).then((ok) => {
              if (ok) {
                setCreateOpen(false);
                setFolderName("");
              }
            });
          }}
        >
          <label>
            폴더 이름 (선택)
            <Input
              ref={createInput}
              value={folderName}
              maxLength={100}
              onChange={(event) => setFolderName(event.target.value)}
              placeholder="비우면 자동 이름"
            />
          </label>
          <p>Documents에 새 관리 폴더를 만듭니다.</p>
          <div className={styles.formActions}>
            <Button
              intent="primary"
              type="submit"
              disabled={pending || globalDisabled}
            >
              작업 공간 만들기
            </Button>
            <Button type="button" onClick={() => setCreateOpen(false)}>
              취소
            </Button>
          </div>
        </form>
      )}
      <Button
        className={`${styles.newSession} new-session`}
        disabled={!workspace || pending || !connected || resourceDisabled}
        onClick={newSession}
      >
        <SquarePen size={16} aria-hidden="true" />새 세션
      </Button>
      <section
        className={styles.sessionGroup}
        aria-label="세션 검색과 최근 세션"
      >
        {workspace ? (
          <SessionNavigation
            key={workspace.id}
            sessions={displaySessions}
            workspaceId={workspace.id}
            selectedId={selection.sessionId}
            disabled={!connected || resourceDisabled}
            pending={pending}
            unknownIds={workbench.unknownSessionIds}
            permissionIds={permissionIds}
            mutate={mutate}
            select={(id) => {
              workbench.select(workspace.id, id);
              if (!wide) closeNavigation();
            }}
          />
        ) : (
          <p className={styles.muted}>작업 공간을 선택하세요.</p>
        )}
      </section>
      <Button
        ref={settingsRow}
        className={styles.settingsRow}
        onClick={() => openSheet(OPEN_SETTINGS_EVENT, settingsRow.current)}
      >
        <Settings size={16} aria-hidden="true" />
        설정
      </Button>
    </div>
  );
  const noWorkspace = <p className={styles.muted}>작업 공간을 선택하세요.</p>;
  const panelContent = (
    <>
      <SidePanel
        panel={panel ?? "files"}
        onSelect={setPanel}
        onClose={wide ? closePanel : undefined}
        fill={panel === "terminal" || panel === "preview"}
      >
        {!selection.workspaceId ? (
          noWorkspace
        ) : panel === "work" ? (
          <>
            <PlansPanel
              key={key}
              workspaceId={selection.workspaceId}
              sessionId={selection.sessionId}
            />
            <ActivityPanel
              workspaceId={selection.workspaceId}
              sessionId={selection.sessionId}
            />
          </>
        ) : panel === "terminal" ? (
          <TerminalPanel key={key} workspaceId={selection.workspaceId} />
        ) : panel === "preview" ? (
          <PreviewPanel key={key} workspaceId={selection.workspaceId} />
        ) : panel === "changes" ? (
          <ChangesPanel key={key} workspaceId={selection.workspaceId} />
        ) : (
          <FileExplorer key={key} workspaceId={selection.workspaceId} />
        )}
      </SidePanel>
      {!wide && (
        <Button className={styles.returnButton} onClick={closePanel}>
          대화로 돌아가기
        </Button>
      )}
    </>
  );
  return (
    <main
      className={`${styles.workbench} workbench ${navigation ? "navigation-open" : ""} ${panel ? "detail-open" : ""}`}
      style={
        { "--detail-width": `${clampWidth(panelWidth)}px` } as CSSProperties
      }
    >
      {wide && navigation && (
        <aside
          className={`${styles.navigation} navigation`}
          aria-label="작업 공간과 세션"
          onKeyDown={(event) => {
            if (
              event.key === "Escape" &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229 &&
              !event.defaultPrevented
            ) {
              event.preventDefault();
              closeNavigation();
            }
          }}
        >
          {navigationContent}
        </aside>
      )}
      {!wide && (
        <ModalSheet
          open={navigation}
          onOpenChange={setNavigation}
          title="작업 공간과 세션"
          side="left"
          flush
          returnFocusRef={navigationButton}
        >
          {navigationContent}
        </ModalSheet>
      )}
      <section
        className={`${styles.mainPane} main-pane`}
        aria-label="대화 작업 공간"
      >
        <header className={`${styles.header} workbench-header`}>
          {(!wide || !navigation) && (
            <Button
              ref={navigationButton}
              size="compact"
              className={styles.iconButton}
              aria-expanded={navigation}
              aria-label="작업 공간 탐색 열기"
              title="작업 공간 탐색"
              onClick={() => {
                setNavigation((value) => !value);
                if (panel) setPanel(null);
              }}
            >
              <PanelLeft size={18} />
            </Button>
          )}
          <div className={styles.sessionHeading}>
            {session && hasMessages && (
              <>
                <strong title={displayTitle}>{displayTitle}</strong>
                {workspace && (
                  <span className={styles.context}>
                    {workspace.name}
                    {workspace.branch ? ` · ${workspace.branch}` : ""}
                  </span>
                )}
              </>
            )}
            <span
              className={styles.runtimeState}
              data-connection={connection}
              role="status"
              hidden={connected}
            >
              {states[connection]}
            </span>
          </div>
          <CommandPalette />
          <SettingsHost
            returnFocusRef={sheetReturn}
            fallbackFocusRef={navigationButton}
            session={session && { id: session.id, title: session.title }}
            messages={snapshot?.messages ?? []}
          />
          <NotificationCenter badgeOnly />
          <Button
            size="compact"
            className={styles.iconButton}
            aria-label="터미널 패널"
            title="터미널"
            aria-pressed={panel === "terminal"}
            onClick={() =>
              panel === "terminal" ? closePanel() : openPanel("terminal")
            }
          >
            <SquareTerminal size={18} />
          </Button>
          <Button
            ref={panelButton}
            size="compact"
            className={styles.iconButton}
            aria-label="보조 패널"
            title="보조 패널"
            aria-expanded={Boolean(panel)}
            onClick={() =>
              panel ? closePanel() : openPanel(hasChanges ? "changes" : "files")
            }
          >
            <PanelRight size={18} />
          </Button>
          <ActionMenu
            label="더 보기"
            title="더 보기"
            triggerRef={moreButton}
            className={styles.iconButton ?? ""}
            trigger={<MoreHorizontal size={18} />}
            items={[
              {
                label: "알림",
                icon: <Bell size={16} />,
                onSelect: () =>
                  openSheet(OPEN_NOTIFICATIONS_EVENT, moreButton.current),
              },
              {
                label: "자동화",
                icon: <Clock size={16} />,
                onSelect: () =>
                  openSheet(OPEN_AUTOMATION_EVENT, moreButton.current),
              },
              {
                label: "데이터·내보내기",
                icon: <Database size={16} />,
                onSelect: () => openSheet(OPEN_DATA_EVENT, moreButton.current),
              },
              // The sidebar footer owns 설정 while the sidebar is docked.
              ...(wide && navigation
                ? []
                : [
                    {
                      label: "설정",
                      icon: <Settings size={16} />,
                      onSelect: () =>
                        openSheet(OPEN_SETTINGS_EVENT, moreButton.current),
                    },
                  ]),
            ]}
          />
        </header>
        {recoveryReasons.length > 0 && (
          <div
            className={`${styles.statusLine} ${styles.recovery} recovery-state`}
            role="status"
            aria-label="저장소 복구 상태"
            data-recovery-state={
              storeReason ? "recovery_required" : "unavailable"
            }
          >
            {recoveryReasons.map((reason) => (
              <p key={reason} data-recovery-reason={reason}>
                {recoveryMessages[reason]}
              </p>
            ))}
          </div>
        )}
        {retainedCount > 0 && (
          <div
            className={`${styles.statusLine} retained-operations`}
            role="status"
            aria-label="보관된 요청 확인"
            data-retained-count={retainedCount}
          >
            이전 요청 {retainedCount}개의 결과 확인이 필요합니다. 자동으로 다시
            실행하지 않습니다.
          </div>
        )}
        {workbench.error && !composerOperation(errorOp) ? (
          <div className={`${styles.statusLine} ${styles.error}`} role="alert">
            <span data-reject-notice={workbench.error}>
              {rejectionMessage(workbench.error)}
            </span>
            <Button onClick={workbench.clearError}>닫기</Button>
          </div>
        ) : (
          snapshot?.error && (
            <div
              className={`${styles.statusLine} ${styles.error}`}
              role="alert"
            >
              요청을 완료하지 못했습니다. 연결과 현재 상태를 다시 확인하세요.
            </div>
          )
        )}
        {!connected && (
          <div className={styles.statusLine}>
            <span>연결 확인은 실행 요청을 재전송하지 않습니다.</span>
            <Button
              disabled={connection === "loading"}
              onClick={workbench.refresh}
            >
              연결 다시 확인
            </Button>
          </div>
        )}
        {(workbench.unknown || session?.status === "unknown") && (
          <div className={styles.statusLine} role="status">
            요청 또는 실행 상태가 불명확하여 새 전송을 막았습니다. 실제 결과를
            확인하세요.
          </div>
        )}
        {selection.workspaceId && selection.sessionId ? (
          <Conversation
            key={key}
            workspaceId={selection.workspaceId}
            sessionId={selection.sessionId}
            messages={snapshot?.messages ?? []}
            permissions={snapshot?.permissions ?? []}
            catalog={catalog}
            status={session?.status ?? "unknown"}
            executionAvailable={
              executionAvailable && Boolean(workspace && session)
            }
            disabled={
              !connected ||
              resourceDisabled ||
              !session ||
              workbench.unknown ||
              session.status === "unknown" ||
              session.status === "unavailable" ||
              Boolean(session.archived)
            }
            archived={Boolean(session?.archived)}
            permissionMode={session?.permissionMode ?? "ask"}
            pending={pending}
            mutate={mutate}
            openPanel={openConversationPanel}
            newSession={newSession}
            workspaceName={workspace?.name}
            workspacePath={workspace?.path}
            newSessionDisabled={
              !workspace || pending || !connected || resourceDisabled
            }
          />
        ) : (
          <div className={`${styles.noSession} no-session`}>
            <h1>
              {workspace
                ? "어떤 작업을 시작할까요?"
                : "작업 공간을 준비하고 있습니다"}
            </h1>
            <p>
              {workspace
                ? "새 세션에서 작업을 시작하세요."
                : "연결되면 작업 공간이 표시됩니다."}
            </p>
            <Button
              intent="primary"
              className={styles.primaryButton}
              disabled={!workspace || pending || !connected || resourceDisabled}
              onClick={newSession}
            >
              새 세션
            </Button>
          </div>
        )}
      </section>
      {wide && panel && (
        <>
          <div
            className={styles.separator}
            role="separator"
            tabIndex={0}
            aria-label="상세 패널 너비"
            aria-orientation="vertical"
            aria-valuemin={MIN_PANEL_WIDTH}
            aria-valuemax={maxPanelWidth()}
            aria-valuenow={clampWidth(panelWidth)}
            aria-valuetext={`${clampWidth(panelWidth)}픽셀`}
            onDoubleClick={() => setPanelWidth(DEFAULT_PANEL_WIDTH)}
            onKeyDown={(event) => {
              const values: Record<string, number> = {
                ArrowLeft: clampWidth(panelWidth) + 10,
                ArrowRight: clampWidth(panelWidth) - 10,
                Home: MIN_PANEL_WIDTH,
                End: maxPanelWidth(),
                Enter: DEFAULT_PANEL_WIDTH,
              };
              if (event.key in values) {
                event.preventDefault();
                setPanelWidth(clampWidth(values[event.key]!));
              }
            }}
            onPointerDown={(event) => {
              drag.current = {
                x: event.clientX,
                width: clampWidth(panelWidth),
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (drag.current)
                setPanelWidth(
                  clampWidth(
                    drag.current.width + drag.current.x - event.clientX,
                  ),
                );
            }}
            onPointerUp={(event) => {
              drag.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          />
          <aside
            className={`${styles.detailPanel} detail-panel`}
            aria-label="보조 패널"
          >
            {panelContent}
          </aside>
        </>
      )}
      {!wide && (
        <ModalSheet
          open={Boolean(panel)}
          onOpenChange={(open) => {
            if (!open) closePanel();
          }}
          title="보조 패널"
          flush
          returnFocusRef={panelButton}
        >
          {panelContent}
        </ModalSheet>
      )}
      <ModalSheet
        open={locationOpen}
        onOpenChange={setLocationOpen}
        title="저장 위치와 보관 정보"
        returnFocusRef={switcherButton}
      >
        <div className={styles.locationInfo}>
          <h3>{workspace?.name}</h3>
          <dl>
            <dt>전체 경로</dt>
            <dd>{workspace?.path}</dd>
            <dt>종류</dt>
            <dd>
              {workspace?.kind === "repository"
                ? "저장소"
                : workspace?.kind === "worktree"
                  ? "워크트리"
                  : "폴더"}
            </dd>
            <dt>신뢰</dt>
            <dd>{workspace?.trusted ? "확인됨" : "세션 생성 시 확인"}</dd>
          </dl>
          <p
            data-storage-durability={
              workspace?.temporary ? "temporary" : "durable"
            }
          >
            {workspace?.temporary
              ? "임시 · 이번 앱 실행에서만 유지됩니다."
              : "계속 보관 · 앱을 종료해도 이 위치에 유지됩니다."}
          </p>
          {!workspace?.temporary && (
            <p>
              새 관리 폴더는 Documents에 만들며, 가져온 폴더는 원래 위치를
              유지합니다.
            </p>
          )}
          {resourceRecovery.map((r) => (
            <p
              key={selectionKey(r.workspaceId, r.sessionId)}
              data-recovery-reason={r.reason}
            >
              {recoveryMessages[r.reason]}
            </p>
          ))}
          <p>가져오거나 생성한 폴더의 파일은 삭제하지 않습니다.</p>
        </div>
      </ModalSheet>
    </main>
  );
}
