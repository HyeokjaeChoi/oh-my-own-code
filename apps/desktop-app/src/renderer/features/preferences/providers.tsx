import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@workbench/ui";
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
  sourceText,
  type ProviderList,
  type ProviderRequest,
} from "../../shared/providers/index.js";
import styles from "./preferences.module.css";

// "모델 제공자": the key lives only in the uncontrolled input and in one IPC call.
export function ProviderSettings() {
  const { actions } = useWindowWorkbench();
  const catalog = useWorkbenchSelector(selectors.catalog);
  const [list, setList] = useState<ProviderList>();
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [defaultModel, setDefaultModel] = useState(() => loadDefaultModel());
  const key = useRef<HTMLInputElement>(null);
  const base = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    const result = await callProvider<unknown>({ type: "provider.list" });
    if (!result.ok) return setError(providerErrorText(result.code));
    setList(parseProviderList(result.value));
  }, []);
  // Opening the sheet also refreshes the model catalog (local discovery can finish after first load).
  useEffect(() => {
    void load();
    actions.refresh();
  }, [load, actions]);
  const run = async (request: ProviderRequest, done: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    const result = await callProvider<unknown>(request);
    setBusy(false);
    if (!result.ok) {
      setError(providerErrorText(result.code));
      return false;
    }
    setNotice(done);
    await load();
    actions.refresh();
    return true;
  };
  const connect = async () => {
    const value = key.current?.value ?? "";
    const id = selected || list?.providers[0]?.id;
    if (!id) return;
    if (
      await run(
        { type: "provider.connect", id, key: value },
        "API 키를 설정했습니다.",
      )
    )
      if (key.current) key.current.value = "";
  };
  const models =
    catalog?.models.status === "available" ? catalog.models.entries : [];
  return (
    <section aria-label="모델 제공자">
      <h3 className={styles.subheading}>모델 제공자</h3>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {list?.providers
        .filter((p) => p.connected)
        .map((p) => (
          <div key={p.id} className={styles.providerRow}>
            <span>
              {p.name} · <small>{sourceText(p)}</small>
            </span>
            {p.source === "credential" && (
              <span>
                <Button
                  size="compact"
                  disabled={busy}
                  onClick={() => {
                    setSelected(p.id);
                    key.current?.focus();
                  }}
                >
                  키 교체
                </Button>
                <Button
                  size="compact"
                  intent="danger"
                  disabled={busy}
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
          </div>
        ))}
      <div className={styles.providerForm}>
        <select
          aria-label="제공자 선택"
          value={selected || list?.providers[0]?.id || ""}
          onChange={(event) => setSelected(event.target.value)}
        >
          {list?.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.connected ? " (설정됨)" : ""}
            </option>
          ))}
        </select>
        <input
          ref={key}
          type="password"
          aria-label="API 키"
          placeholder="API 키"
          autoComplete="off"
          spellCheck={false}
        />
        <Button
          intent="primary"
          disabled={busy || !list}
          onClick={() => void connect()}
        >
          키 저장
        </Button>
      </div>
      <div className={styles.providerForm}>
        <input
          key={list?.local.baseUrl}
          ref={base}
          aria-label="로컬 제공자 주소"
          placeholder="LM Studio 주소 (예: http://127.0.0.1:1234/v1)"
          defaultValue={list?.local.baseUrl}
          autoComplete="off"
          spellCheck={false}
        />
        <Button
          disabled={busy || !list}
          onClick={() =>
            void run(
              {
                type: "provider.local",
                baseUrl: base.current?.value.trim() ?? "",
              },
              "로컬 제공자 주소를 저장했습니다. 앱을 다시 시작하면 적용됩니다.",
            )
          }
        >
          주소 저장
        </Button>
      </div>
      <label className={styles.field}>
        <span>기본 모델</span>
        <select
          aria-label="기본 모델"
          value={defaultModel}
          onChange={(event) => {
            setDefaultModel(event.target.value);
            saveDefaultModel(event.target.value);
          }}
        >
          <option value="">Native에서 결정</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
