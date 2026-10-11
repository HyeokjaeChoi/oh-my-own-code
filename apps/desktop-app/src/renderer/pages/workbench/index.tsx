/* eslint-disable no-unused-vars -- Type parameter names describe callbacks; TypeScript unused checks remain enabled. */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ActionMenu, Button, ModalSheet } from "@workbench/ui";
import {
  Folder,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { ActivityPanel } from "../../widgets/activity/index.js";
import {
  SessionNavigation,
  sessionSuccessor,
} from "../../features/sessions/index.js";
import { PreferencesButton } from "../../features/preferences/index.js";
import { Conversation } from "../../widgets/conversation/index.js";
import { TerminalPanel } from "../../widgets/terminal/index.js";
import { CatalogPanel, FileExplorer } from "../../widgets/explorer/index.js";
import {
  selectors,
  recoveryMessages,
  useWorkbenchSelector,
  useWindowWorkbench,
  type Panel,
} from "../../entities/workbench/index.js";
import { selectionKey } from "../../shared/projection/index.js";
import styles from "./shell.module.css";

const panelLabels = {
  files: "파일",
  catalog: "확장·명령",
  activity: "활동",
  terminal: "터미널",
};
const states: Record<string, string> = {
  loading: "런타임 확인 중…",
  connected: "로컬 연결됨",
  disconnected: "연결 끊김",
  unavailable: "사용 불가",
};
export function Workbench() {
  const { actions, store } = useWindowWorkbench();
  const recovery = useWorkbenchSelector(selectors.recovery);
  const globalDisabled = useWorkbenchSelector(
    selectors.workspaceMutationDisabled,
  );
  const resourceDisabled = useWorkbenchSelector(selectors.mutationDisabled);
  const executionAvailable = useWorkbenchSelector(selectors.executionAvailable);
  const snapshot = useWorkbenchSelector(selectors.snapshot);
  const selection = useWorkbenchSelector(selectors.selection);
  const catalog = useWorkbenchSelector(selectors.catalog);
  const lists = useWorkbenchSelector(selectors.lists);
  const connection = useWorkbenchSelector((s) => s.connection);
  const pending = useWorkbenchSelector(selectors.pending);
  const error = useWorkbenchSelector((s) => s.error);
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
  const navigationButton = useRef<HTMLButtonElement>(null);
  const panelButton = useRef<HTMLButtonElement>(null);
  const createInput = useRef<HTMLInputElement>(null);
  const storageButton = useRef<HTMLButtonElement>(null);
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
  const workspace = lists?.workspaces.find(
    (item) => item.id === selection.workspaceId,
  );
  const session = snapshot?.sessions.find(
    (item) =>
      item.id === selection.sessionId &&
      item.workspaceId === selection.workspaceId,
  );
  const connected = connection === "connected";
  const newSession = () => {
    if (selection.workspaceId)
      void mutate(
        { type: "session.create", workspaceId: selection.workspaceId },
        true,
      );
  };
  const closeNavigation = () => {
    setNavigation(false);
    navigationButton.current?.focus();
  };
  const closePanel = () => {
    setPanel(null);
    panelButton.current?.focus();
  };
  const openPanel = (next: Panel) => {
    actions.openPanel(next);
  };
  const clampWidth = (value: number) => Math.min(420, Math.max(300, value));
  const navigationContent = (
    <div className={styles.navigationBody}>
      <div className={styles.workspaceSelector}>
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
        <Folder size={16} aria-hidden="true" />
        <label className={styles.srOnly} htmlFor="workspace-select">
          작업 공간
        </label>
        <select
          id="workspace-select"
          value={selection.workspaceId ?? ""}
          onChange={(event) => {
            const id = event.target.value;
            workbench.select(id, sessionSuccessor(lists?.sessions ?? [], id));
            if (!wide) closeNavigation();
          }}
        >
          {!workspace && <option value="">작업 공간 선택</option>}
          {lists?.workspaces.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <ActionMenu
          label="작업 공간 작업"
          trigger={<MoreHorizontal size={18} />}
          items={[
            {
              label: "폴더 가져오기",
              disabled: pending || globalDisabled,
              onSelect: () => {
                void mutate({ type: "workspace.import" }, true);
              },
            },
            {
              label: "새 작업 공간",
              disabled: pending || globalDisabled,
              onSelect: () => setCreateOpen(true),
            },
            {
              label: "작업 공간 위치·보관 정보",
              disabled: !workspace,
              onSelect: () => setLocationOpen(true),
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
      </div>
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
            <input
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
        <Plus size={16} aria-hidden="true" />새 세션
      </Button>
      <section
        className={styles.sessionGroup}
        aria-label="세션 검색과 최근 세션"
      >
        <h2>최근 세션</h2>
        {workspace ? (
          <SessionNavigation
            key={workspace.id}
            sessions={lists?.sessions ?? []}
            workspaceId={workspace.id}
            selectedId={selection.sessionId}
            disabled={!connected || resourceDisabled}
            pending={pending}
            unknownIds={workbench.unknownSessionIds}
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
      <div className={styles.secondaryActions} aria-label="작업 공간 관리">
        <Button
          size="compact"
          disabled={pending || globalDisabled}
          onClick={() => void mutate({ type: "workspace.import" }, true)}
        >
          <Folder size={16} aria-hidden="true" /> 폴더 가져오기
        </Button>
        <Button
          size="compact"
          className={styles.storageButton}
          ref={storageButton}
          disabled={!workspace}
          onClick={() => setLocationOpen(true)}
        >
          작업 공간 위치·보관 정보
        </Button>
      </div>
    </div>
  );
  const panelContent = (
    <>
      <div className={styles.panelHeading}>
        <div
          className={`${styles.panelTabs} panel-tabs`}
          aria-label="상세 패널 보기"
        >
          {(Object.keys(panelLabels) as Panel[]).map((item) => (
            <Button
              size="compact"
              key={item}
              aria-pressed={panel === item}
              onClick={() => setPanel(item)}
            >
              {panelLabels[item]}
            </Button>
          ))}
        </div>
        {wide && (
          <Button
            size="compact"
            className={styles.iconButton}
            title="너비 초기화"
            aria-label="상세 패널 너비 초기화"
            onClick={() => setPanelWidth(336)}
          >
            <RotateCcw size={16} />
          </Button>
        )}
        {wide && (
          <Button
            size="compact"
            className={styles.iconButton}
            aria-label="상세 패널 닫기"
            title="상세 패널 닫기"
            onClick={closePanel}
          >
            <X size={18} />
          </Button>
        )}
      </div>
      <div className={styles.panelContent}>
        {panel === "activity" ? (
          <ActivityPanel
            workspaceId={selection.workspaceId}
            sessionId={selection.sessionId}
          />
        ) : panel === "terminal" ? (
          selection.workspaceId ? (
            <TerminalPanel key={key} workspaceId={selection.workspaceId} />
          ) : (
            <p className={styles.muted}>작업 공간을 선택하세요.</p>
          )
        ) : panel === "catalog" ? (
          <CatalogPanel
            catalog={catalog}
            error={workbench.catalogError}
            refresh={workbench.refresh}
          />
        ) : selection.workspaceId ? (
          <FileExplorer key={key} workspaceId={selection.workspaceId} />
        ) : (
          <p className={styles.muted}>작업 공간을 선택하세요.</p>
        )}
      </div>
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
      style={{ "--detail-width": `${panelWidth}px` } as CSSProperties}
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
          <div className={styles.sessionHeading}>
            <strong title={session?.title ?? workspace?.name}>
              {session?.title ?? workspace?.name ?? "작업 공간"}
            </strong>
            <span className={styles.runtimeState} data-state={connection}>
              {states[connection]}
            </span>
          </div>
          <PreferencesButton />
          <Button
            ref={panelButton}
            size="compact"
            className={styles.iconButton}
            aria-label="파일·확장"
            title="파일·확장"
            aria-expanded={Boolean(panel)}
            onClick={() => (panel ? closePanel() : openPanel("files"))}
          >
            <PanelRight size={18} />
          </Button>
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
        {(workbench.error || snapshot?.error) && (
          <div className={`${styles.statusLine} ${styles.error}`} role="alert">
            요청을 완료하지 못했습니다. 연결과 현재 상태를 다시 확인하세요.
          </div>
        )}
        {workbench.notice && (
          <div className={styles.statusLine} role="status">
            {workbench.notice}
          </div>
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
            pending={pending}
            mutate={mutate}
            openPanel={openPanel}
            newSession={newSession}
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
            aria-valuemin={300}
            aria-valuemax={420}
            aria-valuenow={panelWidth}
            aria-valuetext={`${panelWidth}픽셀`}
            onDoubleClick={() => setPanelWidth(336)}
            onKeyDown={(event) => {
              const values: Record<string, number> = {
                ArrowLeft: panelWidth + 10,
                ArrowRight: panelWidth - 10,
                Home: 300,
                End: 420,
                Enter: 336,
              };
              if (event.key in values) {
                event.preventDefault();
                setPanelWidth(clampWidth(values[event.key]!));
              }
            }}
            onPointerDown={(event) => {
              drag.current = { x: event.clientX, width: panelWidth };
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
            aria-label="파일, 확장 및 활동"
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
          title="파일, 확장 및 활동"
          returnFocusRef={panelButton}
        >
          {panelContent}
        </ModalSheet>
      )}
      <ModalSheet
        open={locationOpen}
        onOpenChange={setLocationOpen}
        title="작업 공간 위치·보관 정보"
        returnFocusRef={storageButton}
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
