import { useCallback, useEffect, useState } from "react";
import { Button, ModalSheet } from "@workbench/ui";
import { Database } from "lucide-react";
import {
  RETENTION_OPTIONS,
  WIPE_WORD,
  callData,
  type ArchiveInfo,
  type ExportDoc,
  type ExportSummary,
} from "../../shared/data-transfer/index.js";
import type { WorkbenchMessage } from "../../shared/api/index.js";
import styles from "./data.module.css";

type Due = { id: string; at: string; title: string };
const ERR: Record<string, string> = {
  WRONG_FORMAT: "내보내기 형식이 아닙니다.",
  UNSUPPORTED_VERSION: "지원하지 않는 버전입니다.",
  MALFORMED: "파일 내용이 올바르지 않습니다.",
  TOO_LARGE: "파일이 너무 큽니다.",
  TOO_MANY: "가져온 기록이 너무 많습니다. 먼저 일부를 삭제하세요.",
  CONFIRM_MISMATCH: "확인 단어가 일치하지 않습니다.",
};
const why = (code: string) => ERR[code] ?? `실패했습니다 (${code}).`;
const day = (iso: string) => iso.slice(0, 10);

function Export({
  session,
  messages,
}: {
  session: { id: string; title: string } | undefined;
  messages: WorkbenchMessage[];
}) {
  const [outputs, setOutputs] = useState(false);
  const [summary, setSummary] = useState<ExportSummary>();
  const [note, setNote] = useState("");
  const payload = useCallback(
    () => ({
      session: { id: session?.id ?? "", title: session?.title ?? "" },
      messages,
      includeToolOutputs: outputs,
    }),
    [session, messages, outputs],
  );
  // Streaming grows the last message's text without changing its id.
  const lastLength = messages.at(-1)?.text.length;
  useEffect(() => {
    setSummary(undefined);
  }, [session?.id, outputs, messages.length, messages.at(-1)?.id, lastLength]);
  const preview = async () => {
    const r = await callData<ExportSummary>({
      type: "export.preview",
      ...payload(),
    } as never);
    if (r.ok) setSummary(r.value);
    else setNote(why(r.code));
  };
  const save = async () => {
    const r = await callData<{ saved: boolean; name?: string }>({
      type: "export.save",
      ...payload(),
    } as never);
    setNote(
      !r.ok
        ? why(r.code)
        : r.value.saved
          ? `저장했습니다: ${r.value.name}`
          : "저장을 취소했습니다.",
    );
  };
  return (
    <section className={styles.section}>
      <h3>현재 대화 내보내기</h3>
      <p className={styles.muted}>
        화면에 표시된 최근 메시지만 내보냅니다. 자격 증명처럼 보이는 값과 홈
        경로는 기본으로 제거됩니다.
      </p>
      <label>
        <input
          type="checkbox"
          checked={outputs}
          onChange={(e) => setOutputs(e.target.checked)}
        />{" "}
        도구 출력 포함
      </label>
      <div className={styles.row}>
        <Button disabled={!session} onClick={() => void preview()}>
          요약 확인
        </Button>
        <Button disabled={!summary} onClick={() => void save()}>
          파일로 저장
        </Button>
      </div>
      {summary && (
        <p role="status">
          메시지 {summary.messages}개, 도구 호출 {summary.tools}개
          {summary.toolOutputsIncluded
            ? ` (출력 ${summary.toolOutputs}개 포함)`
            : " (도구 출력 제외)"}
          . 제거됨: 자격 증명 {summary.redactions.secrets}건, 홈 경로{" "}
          {summary.redactions.home}건
          {summary.redactions.envOutputs > 0
            ? `, .env 출력 ${summary.redactions.envOutputs}건`
            : ""}
          .
        </p>
      )}
      {note && <p role="status">{note}</p>}
    </section>
  );
}

function Archives() {
  const [list, setList] = useState<ArchiveInfo[]>([]);
  const [open, setOpen] = useState<(ArchiveInfo & { doc: ExportDoc }) | null>(
    null,
  );
  const [note, setNote] = useState("");
  const reload = useCallback(async () => {
    const r = await callData<ArchiveInfo[]>({ type: "archives.list" });
    if (r.ok) setList(r.value);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const importFile = async () => {
    const r = await callData<{ imported: boolean }>({ type: "import.open" });
    setNote(
      !r.ok
        ? why(r.code)
        : r.value.imported
          ? "가져왔습니다."
          : "취소했습니다.",
    );
    await reload();
  };
  const view = async (id: string) => {
    const r = await callData<ArchiveInfo & { doc: ExportDoc }>({
      type: "archives.get",
      id,
    });
    if (r.ok) setOpen(r.value);
  };
  const remove = async (id: string) => {
    await callData({ type: "archives.remove", id });
    if (open?.id === id) setOpen(null);
    await reload();
  };
  return (
    <section className={styles.section}>
      <h3>가져온 기록 (읽기 전용)</h3>
      <p className={styles.muted}>
        가져온 기록은 보관용 사본이며 Native에서 다시 실행되지 않습니다.
      </p>
      <Button onClick={() => void importFile()}>파일 가져오기</Button>
      {note && <p role="status">{note}</p>}
      <ul className={styles.list}>
        {list.map((a) => (
          <li key={a.id}>
            {a.title || "(제목 없음)"} · 메시지 {a.messages}개 ·{" "}
            {day(a.exportedAt)}{" "}
            <Button size="compact" onClick={() => void view(a.id)}>
              보기
            </Button>{" "}
            <Button size="compact" onClick={() => void remove(a.id)}>
              삭제
            </Button>
          </li>
        ))}
      </ul>
      {open?.doc.sessions.map((s) => (
        <div key={s.meta.id} aria-label="가져온 기록 내용">
          <h4>{s.meta.title || s.meta.id}</h4>
          {s.messages.map((m) => (
            <p key={m.id} className={styles.transcript}>
              <strong>{m.role === "user" ? "사용자" : "어시스턴트"}</strong>
              {"\n"}
              {m.text}
              {m.tools?.map((t) => `\n[도구 ${t.name}: ${t.status}]`).join("")}
            </p>
          ))}
        </div>
      ))}
    </section>
  );
}

function Retention() {
  const [days, setDays] = useState(0);
  const [pending, setPending] = useState<{ days: number; due: Due[] }>();
  const [note, setNote] = useState("");
  useEffect(() => {
    void callData<{ days: number }>({ type: "retention.get" }).then(
      (r) => r.ok && setDays(r.value.days),
    );
  }, []);
  const choose = async (next: number) => {
    setNote("");
    if (next === 0) {
      setPending(undefined);
      const r = await callData({ type: "retention.set", days: 0 });
      if (r.ok) setDays(0);
      return;
    }
    const r = await callData<{ due: Due[] }>({
      type: "retention.preview",
      days: next,
    });
    if (r.ok) setPending({ days: next, due: r.value.due });
  };
  const apply = async () => {
    if (!pending) return;
    const r = await callData<{ removed: number }>({
      type: "retention.set",
      days: pending.days,
    });
    if (r.ok) {
      setDays(pending.days);
      setNote(`가져온 기록 ${r.value.removed}개를 삭제했습니다.`);
    } else setNote(why(r.code));
    setPending(undefined);
  };
  return (
    <section className={styles.section}>
      <h3>보관 기간</h3>
      <p className={styles.muted}>
        가져온 기록에만 적용됩니다. 시작 시와 매일 한 번 확인합니다. 작업 폴더의
        파일과 Native 대화는 삭제하지 않습니다.
      </p>
      <label>
        보관 기간{" "}
        <select
          value={pending?.days ?? days}
          onChange={(e) => void choose(Number(e.target.value))}
        >
          {RETENTION_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d === 0 ? "끔" : `${d}일`}
            </option>
          ))}
        </select>
      </label>
      {pending && (
        <div role="status">
          <p>
            {pending.days}일이 지난 가져온 기록 {pending.due.length}개가
            삭제됩니다.
          </p>
          <ul className={styles.list}>
            {pending.due.map((d) => (
              <li key={d.id}>
                {d.title || "(제목 없음)"} · {day(d.at)}
              </li>
            ))}
          </ul>
          <div className={styles.row}>
            <Button onClick={() => void apply()}>적용</Button>
            <Button onClick={() => setPending(undefined)}>취소</Button>
          </div>
        </div>
      )}
      {note && <p role="status">{note}</p>}
    </section>
  );
}

function Wipe() {
  const [root, setRoot] = useState("");
  const [word, setWord] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    void callData<{ root?: string }>({ type: "wipe.info" }).then(
      (r) => r.ok && setRoot(r.value.root ?? ""),
    );
  }, []);
  const run = async () => {
    const r = await callData<{ started: boolean }>({ type: "wipe.run", word });
    if (!r.ok) setNote(why(r.code));
    else if (!r.value.started) setNote("취소했습니다.");
  };
  return (
    <section className={styles.section}>
      <h3 className={styles.danger}>앱 데이터 삭제</h3>
      <p className={styles.muted}>
        삭제됨: {root || "앱 데이터 폴더"} 안의 모든 내용 — 워크스페이스 목록,
        저널, 계획(plans.json), 워크트리 링크, 가져온 기록, 설정, Native 대화
        기록 데이터.
      </p>
      <p className={styles.muted}>
        삭제되지 않음: 프로젝트·워크스페이스 폴더, Git 저장소, 앱이 만든
        Documents 아래 워크트리 폴더. 외부 보존 한계: 이미 OpenAI 등 외부
        제공자에 전송된 프롬프트·응답은 이 앱에서 삭제할 수 없습니다. 내보낸
        파일도 그대로 남습니다.
      </p>
      <div className={styles.row}>
        <label>
          확인을 위해 &quot;{WIPE_WORD}&quot; 입력{" "}
          <input value={word} onChange={(e) => setWord(e.target.value)} />
        </label>
        <Button disabled={word !== WIPE_WORD} onClick={() => void run()}>
          삭제 후 종료
        </Button>
      </div>
      {note && <p role="status">{note}</p>}
    </section>
  );
}

export function DataButton(props: {
  session: { id: string; title: string } | undefined;
  messages: WorkbenchMessage[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="compact"
        aria-label="데이터·내보내기"
        title="데이터·내보내기"
        onClick={() => setOpen(true)}
      >
        <Database size={18} />
      </Button>
      <ModalSheet open={open} onOpenChange={setOpen} title="데이터">
        <Export session={props.session} messages={props.messages} />
        <Archives />
        <Retention />
        <Wipe />
      </ModalSheet>
    </>
  );
}
