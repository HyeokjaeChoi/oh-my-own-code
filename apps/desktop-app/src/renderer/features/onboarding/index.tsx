import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Field, Input, Notice } from "@workbench/ui";
import {
  selectors,
  useWindowWorkbench,
  useWorkbenchSelector,
} from "../../entities/workbench/index.js";
import { openSettingsPage } from "../../shared/palette/index.js";
import {
  callProvider,
  findFreeRouter,
  parseProviderList,
  providerErrorText,
  saveDefaultModel,
  type ProviderList,
} from "../../shared/providers/index.js";
import styles from "./onboarding.module.css";

const KEYS_URL = "https://openrouter.ai/keys";
// The catalog read after connecting may lag the credential; give up after this.
const CATALOG_WAIT_MS = 20_000;

// Provider connection state, re-read whenever the model catalog changes (a key
// saved in Settings refreshes it). Undefined until known, so nothing flashes.
// Callers that load in the same tick (conversation + settings) share one IPC call.
let inflight: Promise<ProviderList | undefined> | undefined;
function readProviderList() {
  inflight ??= callProvider<unknown>({ type: "provider.list" })
    .then((result) => (result.ok ? parseProviderList(result.value) : undefined))
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}
export function useProviderList(): ProviderList | undefined {
  const catalog = useWorkbenchSelector(selectors.catalog);
  const [list, setList] = useState<ProviderList>();
  const load = useCallback(async () => {
    const next = await readProviderList();
    if (next) setList(next);
  }, []);
  useEffect(() => {
    void load();
  }, [load, catalog]);
  return list;
}

// "No provider connected" for the settings default tab: false while unknown.
export const noProviderConnected = (list: ProviderList | undefined) =>
  list !== undefined && !list.providers.some((p) => p.connected);

// The existing safe external-open path (Main validates http(s) and opens the
// default browser); a failure only means the link did nothing.
const openKeysPage = () =>
  void window.desktopBridge
    .preview({ type: "preview.openExternal", url: KEYS_URL })
    .catch(() => {});

type Phase = "idle" | "busy" | "done" | "stalled";

// Empty-state card for a profile with no provider: one OpenRouter key buys the
// free models. The key lives in the uncontrolled input and one provider.connect
// call (the same operation as Settings); it is never stored or logged here.
export function FirstRunCard({ onVerified }: { onVerified?: () => void }) {
  const { actions } = useWindowWorkbench();
  const catalog = useWorkbenchSelector(selectors.catalog);
  const key = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [fieldError, setFieldError] = useState("");
  const [notice, setNotice] = useState("");
  const [waiting, setWaiting] = useState(false);

  // After a verified connect, wait for the catalog to list the free router,
  // select it as the composer model and remember it as the default.
  const router = findFreeRouter(catalog?.models);
  useEffect(() => {
    if (!waiting) return;
    if (router) {
      setWaiting(false);
      actions.options({ model: router.id });
      saveDefaultModel(router.id);
      setPhase("done");
      return;
    }
    const timer = setTimeout(() => {
      // Connected, but no model list yet: never show the key form again.
      setWaiting(false);
      setPhase("stalled");
    }, CATALOG_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting, router, actions]);

  const submit = async () => {
    const value = key.current?.value ?? "";
    if (!value.trim()) {
      setFieldError("API 키를 입력하세요.");
      key.current?.focus();
      return;
    }
    setPhase("busy");
    setFieldError("");
    setNotice("");
    const result = await callProvider<unknown>({
      type: "provider.connect",
      id: "openrouter",
      key: value.trim(),
    });
    if (key.current) key.current.value = "";
    if (!result.ok) {
      setPhase("idle");
      if (result.code === "UNAVAILABLE")
        setNotice(providerErrorText(result.code));
      else {
        setFieldError(providerErrorText(result.code));
        key.current?.focus();
      }
      return;
    }
    // Cheap verification: the credential must show up as a connection.
    const check = await callProvider<unknown>({ type: "provider.list" });
    const connected =
      check.ok &&
      parseProviderList(check.value).providers.some(
        (p) => p.id === "openrouter" && p.connected,
      );
    if (!connected) {
      setPhase("idle");
      setNotice(providerErrorText("UNAVAILABLE"));
      return;
    }
    // The list now reads "connected": the parent keeps this card on screen.
    onVerified?.();
    actions.refresh();
    setWaiting(true);
  };

  if (phase === "stalled")
    return (
      <div className={styles.card} data-first-run="stalled">
        <p className={styles.success} role="status">
          연결됨
        </p>
        <p className={styles.text}>
          모델 목록을 불러오지 못했습니다. 네트워크를 확인한 뒤 설정의 모델
          탭에서 다시 시도하세요.{" "}
          <button
            type="button"
            className={styles.link}
            onClick={() => openSettingsPage("models")}
          >
            설정 열기
          </button>
        </p>
      </div>
    );
  if (phase === "done")
    return (
      <div className={styles.card} data-first-run="done">
        <p className={styles.success} role="status">
          연결됨 · Free Models Router
        </p>
      </div>
    );
  const busy = phase === "busy" || waiting;
  return (
    <form
      className={styles.card}
      aria-labelledby="first-run-title"
      data-first-run="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) void submit();
      }}
    >
      <h2 id="first-run-title" className={styles.title}>
        무료 모델로 바로 시작
      </h2>
      <p className={styles.text}>
        OpenRouter 키 하나로 무료 모델을 바로 쓸 수 있습니다. 키는 이 기기에만
        저장됩니다.{" "}
        <button type="button" className={styles.link} onClick={openKeysPage}>
          키 발급
        </button>
      </p>
      {notice && <Notice tone="danger">{notice}</Notice>}
      <Field label="OpenRouter API 키" error={fieldError}>
        {(c) => (
          <Input
            {...c}
            ref={key}
            type="password"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        )}
      </Field>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.link}
          onClick={() => openSettingsPage("models")}
        >
          다른 제공자 연결
        </button>
        <Button intent="primary" type="submit" disabled={busy}>
          {busy ? "연결 중…" : "연결"}
        </Button>
      </div>
    </form>
  );
}
