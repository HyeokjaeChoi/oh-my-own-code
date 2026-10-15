import { useCallback, useEffect, useState } from "react";
import { Button, ModalSheet } from "@workbench/ui";
import { Clock } from "lucide-react";
import {
  selectors,
  useWorkbenchSelector,
} from "../../entities/workbench/index.js";
import {
  AUTOMATION_LIMITS,
  MODE_LABELS,
  PERMISSION_MODES,
  callAutomation,
  describeSchedule,
  type AutomationList,
  type JobInput,
  type JobView,
  type PermissionMode,
} from "../../shared/automation/index.js";
import { OPEN_AUTOMATION_EVENT } from "../../shared/palette/index.js";
import type { ProjectActions } from "../../shared/project-actions/index.js";
import { callTerminal } from "../../shared/terminal/index.js";
import styles from "./automation.module.css";

const RESULT = {
  ok: "성공",
  failed: "실패",
  skipped: "건너뜀",
  timeout: "시간 초과(2시간)",
  missed: "놓침(앱 꺼짐, 재실행 안 함)",
};
const errors: Record<string, string> = {
  LIMIT_REACHED: "작업 개수 한도에 도달했습니다.",
  NOT_FOUND: "작업을 찾을 수 없습니다.",
  STORE_BLOCKED:
    "저장된 자동화 파일을 읽지 못해 변경할 수 없습니다. 앱 데이터 폴더를 확인하세요.",
  INVALID_REQUEST: "입력값이 올바르지 않습니다.",
};
const time = (ms: number) => new Date(ms).toLocaleString();

type Form = {
  name: string;
  workspaceId: string;
  kind: "prompt" | "script";
  prompt: string;
  script: string;
  mode: "every" | "daily";
  every: number;
  daily: string;
  permissionMode: PermissionMode;
};
const toForm = (j: JobView): Form => ({
  name: j.name,
  workspaceId: j.target.workspaceId,
  kind: j.target.kind,
  prompt: j.target.kind === "prompt" ? j.target.prompt : "",
  script: j.target.kind === "script" ? j.target.script : "",
  mode: "every" in j.schedule ? "every" : "daily",
  every: "every" in j.schedule ? j.schedule.every : 60,
  daily: "daily" in j.schedule ? j.schedule.daily : "09:00",
  permissionMode: j.permissionMode ?? "read_plan",
});
const toInput = (f: Form): JobInput => ({
  name: f.name,
  target:
    f.kind === "prompt"
      ? { workspaceId: f.workspaceId, kind: "prompt", prompt: f.prompt }
      : { workspaceId: f.workspaceId, kind: "script", script: f.script },
  schedule: f.mode === "every" ? { every: f.every } : { daily: f.daily },
  permissionMode: f.kind === "prompt" ? f.permissionMode : null,
});

function JobForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Form;
  onSave: (job: JobInput) => void;
  onCancel: () => void;
}) {
  const lists = useWorkbenchSelector(selectors.lists);
  const [f, setF] = useState(initial);
  const [scripts, setScripts] = useState<string[]>([]);
  const set = (patch: Partial<Form>) => setF((c) => ({ ...c, ...patch }));
  useEffect(() => {
    if (f.kind !== "script" || !f.workspaceId) return;
    let stale = false;
    void callTerminal<ProjectActions>({
      type: "terminal.scripts",
      workspaceId: f.workspaceId,
    }).then(
      (r) =>
        !stale && setScripts(r.ok ? r.value.scripts.map((s) => s.name) : []),
    );
    return () => {
      stale = true;
    };
  }, [f.kind, f.workspaceId]);
  const everyOk =
    f.mode === "daily" ||
    (Number.isInteger(f.every) && f.every >= AUTOMATION_LIMITS.minEveryMinutes);
  const valid =
    f.name.trim() &&
    f.workspaceId &&
    everyOk &&
    (f.kind === "prompt" ? f.prompt.trim() : f.script);
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(toInput(f));
      }}
    >
      <label>
        이름
        <input
          value={f.name}
          maxLength={80}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <fieldset>
        <legend>대상</legend>
        <label>
          작업 공간
          <select
            value={f.workspaceId}
            onChange={(e) => set({ workspaceId: e.target.value })}
          >
            <option value="">선택</option>
            {lists.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          종류
          <select
            value={f.kind}
            onChange={(e) => set({ kind: e.target.value as Form["kind"] })}
          >
            <option value="prompt">새 세션에 고정 프롬프트 전송</option>
            <option value="script">package.json 스크립트 실행</option>
          </select>
        </label>
        {f.kind === "prompt" ? (
          <label>
            프롬프트
            <textarea
              rows={3}
              maxLength={AUTOMATION_LIMITS.prompt}
              value={f.prompt}
              onChange={(e) => set({ prompt: e.target.value })}
            />
          </label>
        ) : (
          <label>
            스크립트
            <select
              value={f.script}
              onChange={(e) => set({ script: e.target.value })}
            >
              <option value="">선택</option>
              {scripts.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
      </fieldset>
      <fieldset>
        <legend>일정 (앱이 켜져 있을 때만 실행)</legend>
        <label>
          방식
          <select
            value={f.mode}
            onChange={(e) => set({ mode: e.target.value as Form["mode"] })}
          >
            <option value="every">N분마다</option>
            <option value="daily">매일 정해진 시각</option>
          </select>
        </label>
        {f.mode === "every" ? (
          <label>
            분 간격 ({AUTOMATION_LIMITS.minEveryMinutes} 이상)
            <input
              type="number"
              min={AUTOMATION_LIMITS.minEveryMinutes}
              value={f.every}
              onChange={(e) => set({ every: Number(e.target.value) })}
            />
          </label>
        ) : (
          <label>
            시각
            <input
              type="time"
              value={f.daily}
              onChange={(e) => set({ daily: e.target.value })}
            />
          </label>
        )}
      </fieldset>
      {f.kind === "prompt" ? (
        <>
          <label>
            권한
            <select
              value={f.permissionMode}
              onChange={(e) =>
                set({ permissionMode: e.target.value as PermissionMode })
              }
            >
              {PERMISSION_MODES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <p className={styles.hint}>
            프롬프트 작업은 새 세션을 만들고 위 권한 모드를 적용한 뒤
            전송합니다.
          </p>
        </>
      ) : (
        <p className={styles.hint}>스크립트는 셸 권한으로 실행됩니다</p>
      )}
      <div className={styles.row}>
        <Button type="submit" disabled={!valid}>
          저장
        </Button>
        <Button type="button" onClick={onCancel}>
          취소
        </Button>
      </div>
    </form>
  );
}

const blank: Form = {
  name: "",
  workspaceId: "",
  kind: "prompt",
  prompt: "",
  script: "",
  mode: "every",
  every: 60,
  daily: "09:00",
  permissionMode: "read_plan",
};

export function AutomationButton({
  hideTrigger = false,
}: {
  hideTrigger?: boolean;
}) {
  const lists = useWorkbenchSelector(selectors.lists);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AutomationList>();
  const [editing, setEditing] = useState<{ id?: string; form: Form }>();
  const [error, setError] = useState<string>();
  const refresh = useCallback(async () => {
    const r = await callAutomation<AutomationList>({ type: "automation.list" });
    if (r.ok) setData(r.value);
  }, []);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_AUTOMATION_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_AUTOMATION_EVENT, onOpen);
  }, []);
  useEffect(() => {
    if (!open) return;
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [open, refresh]);
  const act = async (request: Parameters<typeof callAutomation>[0]) => {
    const r = await callAutomation(request);
    setError(
      r.ok ? undefined : (errors[r.code] ?? "요청을 처리하지 못했습니다."),
    );
    if (r.ok) setEditing(undefined);
    await refresh();
  };
  const wsName = (id: string) =>
    lists.workspaces.find((w) => w.id === id)?.name ?? "(등록 해제됨)";
  return (
    <>
      {!hideTrigger && (
        <Button
          size="compact"
          aria-label="자동화"
          title="자동화"
          onClick={() => setOpen(true)}
        >
          <Clock size={18} />
        </Button>
      )}
      <ModalSheet open={open} onOpenChange={setOpen} title="자동화">
        {error && <p role="alert">{error}</p>}
        {data?.storeError && (
          <p role="alert">
            저장된 자동화 파일을 읽지 못해 저장을 중단했습니다. 앱 데이터 폴더를
            확인하세요.
          </p>
        )}
        {data?.recovered && (
          <p role="status">
            {data.recovered.count === 0
              ? `저장 파일 전체를 ${data.recovered.backup}에 보관했습니다.`
              : `저장 파일의 손상된 항목 ${data.recovered.count}개를 ${data.recovered.backup}에 따로 보관했습니다.`}
          </p>
        )}
        {editing ? (
          <JobForm
            initial={editing.form}
            onCancel={() => setEditing(undefined)}
            onSave={(job) =>
              void act(
                editing.id
                  ? { type: "automation.update", jobId: editing.id, job }
                  : { type: "automation.create", job },
              )
            }
          />
        ) : (
          <>
            <Button onClick={() => setEditing({ form: blank })}>
              작업 추가
            </Button>
            <p className={styles.hint}>
              앱이 켜져 있는 동안에만 실행됩니다. 꺼져 있던 시간의 실행은
              &apos;놓침&apos;으로만 표시하고 다시 실행하지 않습니다.
            </p>
            {!data?.jobs.length && <p>등록된 작업이 없습니다.</p>}
            <ul className={styles.jobs}>
              {data?.jobs.map((j) => (
                <li key={j.id}>
                  <strong>{j.name}</strong>{" "}
                  <small>
                    {j.enabled ? (j.running ? "실행 중" : "활성") : "일시정지"}
                  </small>
                  <dl className={styles.facts}>
                    <dt>대상</dt>
                    <dd>
                      {wsName(j.target.workspaceId)} ·{" "}
                      {j.target.kind === "prompt"
                        ? "새 세션에 프롬프트 전송"
                        : `스크립트 ${j.target.script}`}
                    </dd>
                    <dt>일정</dt>
                    <dd>
                      {describeSchedule(j.schedule)}
                      {j.nextAt ? ` · 다음 ${time(j.nextAt)}` : ""}
                    </dd>
                    <dt>권한</dt>
                    <dd>
                      {j.permissionMode
                        ? MODE_LABELS[j.permissionMode]
                        : "셸 권한으로 실행"}
                    </dd>
                  </dl>
                  <div className={styles.row}>
                    <Button
                      size="compact"
                      onClick={() =>
                        void act({
                          type: "automation.setEnabled",
                          jobId: j.id,
                          enabled: !j.enabled,
                        })
                      }
                    >
                      {j.enabled ? "일시정지" : "재개"}
                    </Button>
                    <Button
                      size="compact"
                      disabled={j.running}
                      onClick={() =>
                        void act({ type: "automation.runNow", jobId: j.id })
                      }
                    >
                      지금 실행
                    </Button>
                    <Button
                      size="compact"
                      onClick={() => setEditing({ id: j.id, form: toForm(j) })}
                    >
                      편집
                    </Button>
                    <Button
                      size="compact"
                      onClick={() =>
                        void act({ type: "automation.remove", jobId: j.id })
                      }
                    >
                      삭제
                    </Button>
                  </div>
                  <ul className={styles.history} aria-label="실행 기록">
                    {j.history.map((h) => (
                      <li key={h.id}>
                        {time(h.scheduledAt)}
                        {h.count && h.count > 1
                          ? ` ~ ${time(h.last ?? h.scheduledAt)} (${h.count}건)`
                          : ""}{" "}
                        — {RESULT[h.result]} {h.reason}
                      </li>
                    ))}
                    {!j.history.length && <li>기록 없음</li>}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )}
      </ModalSheet>
    </>
  );
}
