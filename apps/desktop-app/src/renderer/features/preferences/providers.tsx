import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Field,
  Input,
  Notice,
  Row,
  Section,
  Select,
} from "@workbench/ui";
import {
  selectors,
  useWindowWorkbench,
  useWorkbenchSelector,
} from "../../entities/workbench/index.js";
import {
  callProvider,
  loadDefaultModel,
  parseProviderList,
  providerErrorText,
  saveDefaultModel,
  type ProviderList,
  type ProviderRequest,
} from "../../shared/providers/index.js";
import styles from "./preferences.module.css";

// "모델": the key lives only in the uncontrolled input and in one IPC call.
// A future "OpenCode Zen" provider is just another row of the provider list.
export function ProviderSettings({ onSaved }: { onSaved?: () => void }) {
  const { actions } = useWindowWorkbench();
  const catalog = useWorkbenchSelector(selectors.catalog);
  const [list, setList] = useState<ProviderList>();
  const [selected, setSelected] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingLocal, setEditingLocal] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [defaultModel, setDefaultModel] = useState(() => loadDefaultModel());
  const key = useRef<HTMLInputElement>(null);
  const base = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    const fail = (code: string) => {
      setOffline(code === "UNAVAILABLE");
      setError(code === "UNAVAILABLE" ? "" : providerErrorText(code));
    };
    const result = await callProvider<unknown>({ type: "provider.list" });
    if (!result.ok) return fail(result.code);
    setOffline(false);
    setList(parseProviderList(result.value));
  }, []);
  // Opening the page also refreshes the model catalog (local discovery can finish after first load).
  useEffect(() => {
    void load();
    actions.refresh();
  }, [load, actions]);
  useEffect(() => {
    if (adding) key.current?.focus();
  }, [adding]);
  const run = async (request: ProviderRequest, done: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    const result = await callProvider<unknown>(request);
    setBusy(false);
    if (!result.ok) {
      setOffline(result.code === "UNAVAILABLE");
      setError(
        result.code === "UNAVAILABLE" ? "" : providerErrorText(result.code),
      );
      return false;
    }
    setOffline(false);
    setNotice(done);
    await load();
    actions.refresh();
    return true;
  };
  const selectedId = selected || list?.providers[0]?.id || "";
  const connect = async () => {
    const value = key.current?.value ?? "";
    if (!selectedId) return;
    if (
      await run(
        { type: "provider.connect", id: selectedId, key: value },
        "API 키를 설정했습니다.",
      )
    ) {
      if (key.current) key.current.value = "";
      setAdding(false);
    }
  };
  const models =
    catalog?.models.status === "available" ? catalog.models.entries : [];
  const down = offline;
  return (
    <>
      {down && (
        <Notice
          tone="danger"
          action={
            <Button size="compact" onClick={() => void load()}>
              다시 시도
            </Button>
          }
        >
          런타임에 연결되지 않았습니다.
        </Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}
      <Section title="제공자">
        <ul className={styles.rowList}>
          {/* Only connected providers are rows; every other integration is
              reachable through 제공자 추가 (the list holds hundreds). */}
          {list?.providers
            .filter((p) => p.connected)
            .map((p) => (
              <li key={p.id} className={styles.itemRow}>
                <span className={styles.initial} aria-hidden="true">
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <span className={styles.itemText}>
                  <span className={styles.itemName}>{p.name}</span>
                  <span className={styles.itemMeta}>
                    {p.connected
                      ? p.source === "env"
                        ? "연결됨 · 환경 변수"
                        : "연결됨"
                      : "키 필요"}
                  </span>
                </span>
                {p.source === "credential" && (
                  <span className={styles.itemActions}>
                    <Button
                      size="compact"
                      disabled={busy || down}
                      aria-label={`${p.name} 키 교체`}
                      onClick={() => {
                        setSelected(p.id);
                        setAdding(true);
                      }}
                    >
                      키 교체
                    </Button>
                    <Button
                      size="compact"
                      className={styles.dangerText ?? ""}
                      disabled={busy || down}
                      aria-label={`${p.name} 연결 해제`}
                      onClick={() =>
                        void run(
                          { type: "provider.remove", id: p.id },
                          "API 키를 제거했습니다.",
                        )
                      }
                    >
                      연결 해제
                    </Button>
                  </span>
                )}
              </li>
            ))}
          <li className={styles.itemRow}>
            <span className={styles.initial} aria-hidden="true">
              L
            </span>
            <span className={styles.itemText}>
              <span className={styles.itemName}>LM Studio</span>
              <span className={styles.itemMeta}>
                {list?.local.baseUrl || "주소 없음"}
              </span>
            </span>
            <span className={styles.itemActions}>
              <Button
                size="compact"
                disabled={busy || down || !list}
                aria-label="LM Studio 주소 수정"
                onClick={() => setEditingLocal(true)}
              >
                수정
              </Button>
            </span>
          </li>
        </ul>
        {editingLocal && (
          <div className={styles.addCard}>
            <Field label="로컬 제공자 주소">
              {(c) => (
                <Input
                  {...c}
                  key={list?.local.baseUrl}
                  ref={base}
                  placeholder="localhost:1234/v1"
                  defaultValue={list?.local.baseUrl}
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </Field>
            <div className={styles.cardActions}>
              <Button onClick={() => setEditingLocal(false)}>취소</Button>
              <Button
                intent="primary"
                disabled={busy || !list}
                onClick={() =>
                  void run(
                    {
                      type: "provider.local",
                      baseUrl: base.current?.value.trim() ?? "",
                    },
                    "로컬 제공자 주소를 저장했습니다. 앱을 다시 시작하면 적용됩니다.",
                  ).then((ok) => ok && setEditingLocal(false))
                }
              >
                저장
              </Button>
            </div>
          </div>
        )}
        {adding ? (
          <div className={styles.addCard}>
            <Field label="제공자">
              {(c) => (
                <Select
                  {...c}
                  wrapperClassName={styles.fullWidth ?? ""}
                  value={selectedId}
                  onChange={(event) => setSelected(event.target.value)}
                >
                  {list?.providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.connected ? " (설정됨)" : ""}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="API 키">
              {(c) => (
                <Input
                  {...c}
                  ref={key}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </Field>
            <div className={styles.cardActions}>
              <Button onClick={() => setAdding(false)}>취소</Button>
              <Button
                intent="primary"
                disabled={busy || !list}
                onClick={() => void connect()}
              >
                저장
              </Button>
            </div>
          </div>
        ) : (
          <Button
            className={styles.addButton ?? ""}
            disabled={busy || down || !list}
            onClick={() => setAdding(true)}
          >
            제공자 추가
          </Button>
        )}
      </Section>
      <Section title="기본 모델">
        <Row label="기본 모델" htmlFor="pref-default-model">
          <Select
            id="pref-default-model"
            disabled={down}
            value={defaultModel}
            onChange={(event) => {
              setDefaultModel(event.target.value);
              saveDefaultModel(event.target.value);
              onSaved?.();
            }}
          >
            <option value="">런타임이 결정</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Row>
      </Section>
    </>
  );
}
