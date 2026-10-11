import { useCallback, useEffect, useRef, useState } from "react";
import {
  selectors,
  useWindowWorkbench,
  useWorkbenchSelector,
} from "../../entities/workbench/index.js";
import {
  CHECK_KINDS,
  appendFinding,
  approvalState,
  callPlans,
  checkStale,
  checkUnverified,
  scanPlanLines,
  executionMessage,
  parseChecklist,
  parseFindings,
  setFindingStatus,
  sha256Hex,
  summarizeFindings,
  toggleChecklistItem,
  verificationSummary,
  workspaceFingerprint,
  type CheckKind,
  type FindingAuthor,
  type PlansList,
  type Resolver,
} from "../../shared/plans/index.js";
import {
  announceTerminalStarted,
  callTerminal,
  type TerminalInfo,
} from "../../shared/terminal/index.js";
import type { ProjectActions } from "../../shared/project-actions/index.js";
import styles from "./plans.module.css";

const POLL_MS = 1000;
const IDLE_POLL_MS = 5000;
const errors: Record<string, string> = {
  STALE: "계획 파일이 바뀌었습니다. 다시 불러온 뒤 시도하세요.",
  NOT_APPROVED: "승인된 현재 버전이 없습니다.",
  NOT_FOUND: "작업 공간 또는 계획 파일을 찾을 수 없습니다.",
  NOT_A_SCRIPT_RUN: "프로젝트 스크립트 실행만 검증으로 기록할 수 있습니다.",
  TOO_LARGE: "계획 파일은 64KiB 이하여야 합니다.",
  EXISTS: "같은 이름의 계획이 너무 많습니다.",
  UNKNOWN_SCRIPT: "package.json에 없는 스크립트입니다.",
  LIMIT_REACHED: "터미널을 더 만들 수 없습니다.",
};
const checkLabels = {
  "not-run": "미실행",
  running: "실행 중",
  passed: "통과",
  failed: "실패",
};
const summaryLabels = {
  none: "검증 기록 없음",
  running: "검증 실행 중",
  stale: "재검증 필요",
  failed: "검증 실패",
  passed: "검증 통과",
  unverified: "통과 · 변경 파일 내용 확인 불가, 재검증 필요",
  pending: "검증 미완료",
};
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const authorLabels = { implementer: "구현자", reviewer: "독립 리뷰어" };

export function PlansPanel({
  workspaceId,
  sessionId,
}: {
  workspaceId: string;
  sessionId?: string | undefined;
}) {
  const { actions, store } = useWindowWorkbench();
  const draft = useWorkbenchSelector(selectors.workspaceFileDraft);
  const git = useWorkbenchSelector((s) => s.gitReview.observation);
  const canSave = useWorkbenchSelector(selectors.canSaveWorkspaceFile);
  const [list, setList] = useState<PlansList>();
  const [path, setPath] = useState<string>();
  const [title, setTitle] = useState("");
  const [extra, setExtra] = useState("");
  const [raw, setRaw] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [fp, setFp] = useState<string>();
  const [project, setProject] = useState<ProjectActions>();
  const [kind, setKind] = useState<CheckKind>("test");
  const [script, setScript] = useState("");
  const [finding, setFinding] = useState("");
  const [author, setAuthor] = useState<FindingAuthor>("reviewer");
  const busy = useRef(false);
  const fail = (code: string) =>
    setError(errors[code] ?? "계획 요청을 처리하지 못했습니다.");

  const refresh = useCallback(async () => {
    const r = await callPlans<PlansList>({ type: "plans.list", workspaceId });
    if (r.ok) setList(r.value);
    else setError(errors[r.code] ?? "계획 목록을 불러오지 못했습니다.");
    return r.ok ? r.value : undefined;
  }, [workspaceId]);

  const fingerprint =
    git?.status === "available"
      ? workspaceFingerprint(git.repository, git.files)
      : undefined;
  // Status letters cannot tell whether a changed file was edited again, so a
  // dirty tree never counts as verified by a past run.
  const dirtyTree = git?.status === "available" && git.files.length > 0;
  useEffect(() => {
    let live = true;
    if (!fingerprint) setFp(undefined);
    else void sha256Hex(fingerprint).then((h) => live && setFp(h));
    return () => {
      live = false;
    };
  }, [fingerprint]);

  useEffect(() => {
    void refresh();
    void actions.observeGitReview();
    void callTerminal<ProjectActions>({
      type: "terminal.scripts",
      workspaceId,
    }).then((r) => r.ok && setProject(r.value));
  }, [workspaceId, refresh, actions]);
  const running = list?.checks.some((c) => c.status === "running");
  // Re-observe while the panel is open (not only while a check runs).
  useEffect(() => {
    const timer = setInterval(
      () => {
        void refresh();
        void actions.observeGitReview();
      },
      running ? POLL_MS : IDLE_POLL_MS,
    );
    return () => clearInterval(timer);
  }, [running, refresh, actions]);

  const open = async (next: string) => {
    setPath(next);
    setRaw(false);
    setNote(undefined);
    await actions.readWorkspaceFile(next);
  };
  const loaded =
    path !== undefined &&
    draft.observation?.path === path &&
    draft.read?.status === "available";
  const text = loaded ? draft.text : "";
  const dirty = loaded && draft.text !== draft.baseline;
  const plan = list?.plans.find((p) => p.path === path);
  const approvals = (list?.approvals ?? []).filter((a) => a.path === path);
  const approval =
    plan && !dirty
      ? approvalState(approvals, plan.path, plan.sha256)
      : undefined;
  const links = (list?.links ?? []).filter((l) => l.path === path);
  const checks = (list?.checks ?? []).filter((c) => c.path === path);
  const current = {
    planSha: plan?.sha256 ?? "",
    fingerprint: fp,
    dirty: dirtyTree,
  };
  const checklist = parseChecklist(text);
  const findings = parseFindings(text);
  const summary = summarizeFindings(findings);
  const crlf = text.includes("\r");

  // Edits go through the workspace file draft/save path (version-checked), then re-read for a fresh base.
  const persist = async (next: string | undefined) => {
    if (next === undefined || busy.current || !path) return;
    busy.current = true;
    setError(undefined);
    try {
      actions.editWorkspaceFile(next);
      if (!(await actions.saveWorkspaceFile()))
        setError("저장하지 못했습니다. 파일 패널에서 상태를 확인하세요.");
      await actions.readWorkspaceFile(path);
      await refresh();
    } finally {
      busy.current = false;
    }
  };
  const saveRaw = async () => {
    if (!path || busy.current) return;
    busy.current = true;
    try {
      if (!(await actions.saveWorkspaceFile()))
        setError("저장하지 못했습니다. 파일 패널에서 상태를 확인하세요.");
      await actions.readWorkspaceFile(path);
      await refresh();
    } finally {
      busy.current = false;
    }
  };
  const call = async (
    request: Parameters<typeof callPlans>[0],
  ): Promise<PlansList | undefined> => {
    setError(undefined);
    const r = await callPlans<PlansList & { created?: string }>(request);
    if (!r.ok) {
      fail(r.code);
      return undefined;
    }
    setList(r.value);
    return r.value;
  };
  const create = async () => {
    const v = await call({ type: "plans.create", workspaceId, title });
    const created = (v as { created?: string } | undefined)?.created;
    if (created) {
      setTitle("");
      await open(created);
    }
  };
  // Approve exactly the bytes on screen: hash the displayed baseline (same UTF-8
  // bytes as the host hashes) and require it to equal the file's current hash.
  const approve = async () => {
    if (!plan || dirty || !loaded) return;
    const shown = await sha256Hex(draft.baseline ?? "");
    if (shown !== plan.sha256) {
      setError(
        "화면의 계획이 파일과 다릅니다. 다시 불러왔습니다. 확인 후 승인하세요.",
      );
      await actions.readWorkspaceFile(plan.path);
      await refresh();
      return;
    }
    await call({
      type: "plans.approve",
      workspaceId,
      path: plan.path,
      sha256: shown,
    });
  };
  const execute = async () => {
    if (!plan || approval?.state !== "approved" || !sessionId) return;
    const v = await call({
      type: "plans.link",
      workspaceId,
      path: plan.path,
      sha256: plan.sha256,
      sessionId,
    });
    if (!v) return;
    const sent = await actions.sendMessageToSession(
      workspaceId,
      sessionId,
      executionMessage({
        path: plan.path,
        sha256: plan.sha256,
        version: approval.version,
      }),
    );
    setNote(
      sent
        ? "승인된 계획을 현재 세션에 보냈습니다."
        : "연결은 기록했지만 메시지를 보내지 못했습니다. 입력창과 세션 상태를 확인하세요.",
    );
  };
  const runCheck = async () => {
    if (!plan || !script) return;
    setError(undefined);
    await actions.observeGitReview();
    // Recompute from the refreshed observation, not the pre-refresh `fp`.
    const obs = store.getState().gitReview.observation;
    const freshFp =
      obs?.status === "available"
        ? await sha256Hex(workspaceFingerprint(obs.repository, obs.files)!)
        : undefined;
    const started = await callTerminal<TerminalInfo>({
      type: "terminal.start",
      workspaceId,
      script,
    });
    if (!started.ok) return fail(started.code);
    announceTerminalStarted(started.value.terminalId);
    await call({
      type: "plans.check",
      workspaceId,
      path: plan.path,
      kind,
      terminalId: started.value.terminalId,
      ...(freshFp ? { fingerprint: freshFp } : {}),
    });
  };
  const addFindings = () => {
    let next = text;
    for (const line of finding.split("\n")) {
      const body = line.replace(/^\s*(?:[-*]\s+(?:\[[ xX]\]\s+)?)?/, "").trim();
      if (!body) continue;
      next = appendFinding(next, { author, text: body }) ?? next;
    }
    if (next !== text) {
      setFinding("");
      void persist(next);
    }
  };

  const rows = text.split(/\r?\n/);
  const itemByLine = new Map(checklist.items.map((i) => [i.line, i]));
  const scanned = scanPlanLines(text);

  return (
    <section className={styles.panel} aria-label="계획과 검증">
      <h2>계획</h2>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.input}>
        <input
          aria-label="새 계획 제목"
          placeholder="새 계획 제목"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button disabled={!title.trim()} onClick={() => void create()}>
          만들기
        </button>
      </div>
      <p className={styles.muted}>
        내용은 에이전트에게 .omoc/plans/*.md 로 작성하도록 요청해도 됩니다.
      </p>
      <ul className={styles.list}>
        {(list?.plans ?? []).map((p) => {
          const st = approvalState(
            (list?.approvals ?? []).filter((a) => a.path === p.path),
            p.path,
            p.sha256,
          );
          return (
            <li key={p.path}>
              <button
                aria-pressed={p.path === path}
                onClick={() => void open(p.path)}
              >
                {p.path.replace(/^\.omoc\/plans\//, "")}
              </button>{" "}
              <span className={styles.badge}>
                {st.state === "approved"
                  ? `승인됨 v${st.version}`
                  : st.state === "stale"
                    ? "승인 후 변경됨"
                    : "미승인"}
              </span>
            </li>
          );
        })}
      </ul>
      <div className={styles.input}>
        <input
          aria-label="다른 Markdown 경로"
          placeholder="docs/plan.md"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
        />
        <button
          disabled={!extra.trim().endsWith(".md")}
          onClick={() => void open(extra.trim())}
        >
          열기
        </button>
      </div>

      {path && (
        <>
          <h3>{path}</h3>
          {!loaded && <p className={styles.muted}>계획을 불러오는 중…</p>}
          {loaded && (
            <>
              <p>
                진행 {checklist.done}/{checklist.total}
                {dirty && <span className={styles.warn}> · 저장 안 됨</span>}
              </p>
              <div className={styles.input}>
                <button onClick={() => setRaw(!raw)} aria-pressed={raw}>
                  {raw ? "보기" : "원문 편집"}
                </button>
                {raw && (
                  <button disabled={!canSave} onClick={() => void saveRaw()}>
                    저장
                  </button>
                )}
              </div>
              {raw ? (
                crlf ? (
                  <p className={styles.muted}>
                    CRLF 파일은 파일 패널의 편집기에서 수정하세요.
                  </p>
                ) : (
                  <textarea
                    className={styles.raw}
                    aria-label="계획 원문"
                    spellCheck={false}
                    value={draft.text}
                    onChange={(e) => actions.editWorkspaceFile(e.target.value)}
                  />
                )
              ) : (
                <div>
                  {rows.map((row, line) => {
                    const reviewSection = scanned[line]?.review ?? false;
                    const h =
                      !scanned[line]?.inFence &&
                      /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(row);
                    const item = itemByLine.get(line);
                    if (item)
                      return (
                        <label key={line} className={styles.check}>
                          <input
                            type="checkbox"
                            checked={item.checked}
                            onChange={() =>
                              void persist(toggleChecklistItem(text, line))
                            }
                          />
                          <span>{item.text || "(비어 있음)"}</span>
                        </label>
                      );
                    if (reviewSection && !h && row.trim()) return null;
                    return h ? (
                      <p key={line} className={styles.heading}>
                        {h[2]}
                      </p>
                    ) : (
                      row.trim() && (
                        <p key={line} className={styles.line}>
                          {row}
                        </p>
                      )
                    );
                  })}
                </div>
              )}

              <div className={styles.section}>
                <h4>승인과 실행</h4>
                <p>
                  {approval?.state === "approved"
                    ? `승인됨 v${approval.version}`
                    : approval?.state === "stale"
                      ? `승인 후 변경됨 (마지막 승인 v${approval.version}) — 다시 승인하세요`
                      : dirty
                        ? "저장 후 승인할 수 있습니다."
                        : "아직 승인하지 않았습니다."}
                </p>
                <div className={styles.input}>
                  <button
                    disabled={dirty || approval?.state === "approved"}
                    onClick={() => void approve()}
                  >
                    승인
                  </button>
                  <button
                    disabled={approval?.state !== "approved" || !sessionId}
                    onClick={() => void execute()}
                    title="승인된 버전의 경로와 해시를 현재 세션에 보냅니다"
                  >
                    실행
                  </button>
                </div>
                {note && <p role="status">{note}</p>}
                {links.length > 0 && (
                  <ul className={styles.list}>
                    {links.map((l, i) => (
                      <li key={i}>
                        v{l.version} → 세션 {l.sessionId.slice(0, 8)} ·{" "}
                        {l.sha256.slice(0, 8)}
                        {plan && l.sha256 !== plan.sha256 && (
                          <span className={styles.warn}> · 이후 변경됨</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className={styles.section}>
                <h4>
                  검증{" "}
                  <span className={styles.badge}>
                    {summaryLabels[verificationSummary(checks, current)]}
                  </span>
                </h4>
                <p className={styles.muted}>
                  상태는 앱이 실행한 스크립트의 종료 코드로만 기록됩니다.
                  에이전트의 완료 보고는 반영되지 않습니다.
                </p>
                {checks.length > 0 && (
                  <ul className={styles.list}>
                    {checks.map((c) => (
                      <li key={c.id}>
                        {c.kind} · <code>{c.command}</code> ·{" "}
                        {checkLabels[c.status]}
                        {(c.status === "passed" || c.status === "failed") &&
                          ` (${clock(c.finishedAt ?? c.startedAt)} 기준)`}
                        {checkUnverified(c, current) && (
                          <span className={styles.warn}>
                            {" "}
                            · 재검증 필요 (변경 파일 내용 확인 불가)
                          </span>
                        )}
                        {c.status === "failed" &&
                          ` (종료 코드 ${c.exitCode ?? "신호"})`}
                        {checkStale(c, current) && (
                          <span className={styles.warn}> · 재검증 필요</span>
                        )}{" "}
                        <small className={styles.muted}>{c.source}</small>
                      </li>
                    ))}
                  </ul>
                )}
                {project && project.scripts.length > 0 ? (
                  <div className={styles.input}>
                    <select
                      aria-label="검증 종류"
                      value={kind}
                      onChange={(e) => setKind(e.target.value as CheckKind)}
                    >
                      {CHECK_KINDS.map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                    <select
                      aria-label="검증 스크립트"
                      value={script}
                      onChange={(e) => setScript(e.target.value)}
                    >
                      <option value="">스크립트 선택</option>
                      {project.scripts.map((s) => (
                        <option key={s.name} value={s.name}>
                          {project.packageManager} run {s.name}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={!script || dirty}
                      onClick={() => void runCheck()}
                    >
                      실행하고 기록
                    </button>
                  </div>
                ) : (
                  <p className={styles.muted}>
                    package.json 스크립트가 없습니다.
                  </p>
                )}
              </div>

              <div className={styles.section}>
                <h4>리뷰 결과</h4>
                <p>
                  미해결 {summary.open} · 해결 {summary.resolved} · 리뷰어
                  재확인 대기 {summary.awaitingRecheck}
                </p>
                <ul className={styles.list}>
                  {findings.map((f) => (
                    <li key={f.line}>
                      <span className={styles.badge}>
                        {authorLabels[f.author]}
                      </span>{" "}
                      {f.text}{" "}
                      {f.status === "open" ? (
                        <>
                          {(
                            ["user", "implementer", "reviewer"] as Resolver[]
                          ).map((who) => (
                            <button
                              key={who}
                              onClick={() =>
                                void persist(
                                  setFindingStatus(
                                    text,
                                    f.line,
                                    "resolved",
                                    who,
                                  ),
                                )
                              }
                            >
                              {who === "user"
                                ? "내가 해결 확인"
                                : who === "implementer"
                                  ? "구현자가 수정함"
                                  : "리뷰어가 확인"}
                            </button>
                          ))}
                        </>
                      ) : (
                        <>
                          <small>
                            해결(
                            {authorLabels[f.resolvedBy as FindingAuthor] ??
                              "사용자"}
                            )
                            {f.author === "reviewer" &&
                              f.resolvedBy === "implementer" &&
                              " · 리뷰어 재확인 필요"}
                          </small>{" "}
                          <button
                            onClick={() =>
                              void persist(
                                setFindingStatus(text, f.line, "open"),
                              )
                            }
                          >
                            다시 열기
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                <p className={styles.muted}>
                  독립 리뷰어는 하위 세션 위임으로 실행하고, 최종 답변을 아래에
                  붙여넣어 추가하세요. 자동으로 해결 처리되지 않습니다.
                </p>
                <select
                  aria-label="결과 작성자"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value as FindingAuthor)}
                >
                  <option value="reviewer">독립 리뷰어</option>
                  <option value="implementer">구현자</option>
                </select>
                <textarea
                  className={styles.raw}
                  aria-label="리뷰 결과 붙여넣기"
                  placeholder="한 줄에 하나씩"
                  value={finding}
                  onChange={(e) => setFinding(e.target.value)}
                />
                <button
                  disabled={!finding.trim() || dirty}
                  onClick={addFindings}
                >
                  결과 추가
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
