import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SyntheticSnapshot } from "@workbench/contracts/source";
import { AssistantTranscript } from "../../../widgets/session-workspace/ui/AssistantTranscript.js";
import {
  BridgeResponseError,
  heartbeatBridge,
  pairWithBridge,
  readSyntheticFixture,
  revokeBridge,
} from "../../../shared/api/read-synthetic-fixture.js";
import { projectSnapshotEvents } from "../../../entities/session/index.js";

type PageState =
  | { kind: "disconnected" }
  | { kind: "pairing" }
  | { kind: "pair_rejected"; message: string; focusCode: boolean }
  | { kind: "pair_outcome_unknown" }
  | { kind: "authenticated_loading" }
  | { kind: "connected" }
  | { kind: "read_failed" }
  | { kind: "heartbeat_failed"; busy: boolean }
  | { kind: "terminal_auth_failed" }
  | { kind: "revoking" }
  | { kind: "local_disconnect_unconfirmed" };

type FocusTarget =
  | "pairing"
  | "code"
  | "pair-progress"
  | "connection"
  | "connection-status"
  | "retry";

const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;

function trimAsciiWhitespace(value: string): string {
  return value.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, "");
}

function errorStatus(error: unknown): number | null {
  return error instanceof BridgeResponseError ? error.status : null;
}

function isCapabilityAuthFailure(error: unknown): boolean {
  return errorStatus(error) === 401;
}

function pairFailure(error: unknown): { message: string; focusCode: boolean } {
  if (!(error instanceof BridgeResponseError)) {
    return {
      message: "브리지 응답이 불확실합니다. 새 pairing code를 발급해 주세요.",
      focusCode: false,
    };
  }
  if (error.status >= 500) {
    return {
      message: "브리지 응답이 불확실합니다. 새 pairing code를 발급해 주세요.",
      focusCode: false,
    };
  }
  if (error.status === 400 && error.code === "REQUEST_INVALID") {
    return {
      message: "입력 형식이 올바르지 않습니다. 새 code를 확인해 주세요.",
      focusCode: true,
    };
  }
  if (error.status === 401 && error.code === "BOOTSTRAP_INVALID") {
    return {
      message:
        "code가 만료되었거나 이미 사용됐을 수 있습니다. 새 code를 입력하거나 터미널에서 pair를 입력해 발급하세요.",
      focusCode: true,
    };
  }
  if (error.status === 429 && error.code === "BOOTSTRAP_RATE_LIMITED") {
    return {
      message:
        "현재 code는 더 사용할 수 없습니다. 터미널에서 pair를 입력해 새 code를 발급하세요.",
      focusCode: false,
    };
  }
  return {
    message: "브리지 연결 설정을 확인해 주세요. code 값은 확인할 수 없습니다.",
    focusCode: false,
  };
}

export function WorkbenchPage() {
  const [state, setState] = useState<PageState>({ kind: "disconnected" });
  const [code, setCode] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SyntheticSnapshot | null>(null);
  const [focusIntent, setFocusIntent] = useState<FocusTarget | null>(null);
  const [announcement, setAnnouncement] = useState(
    "브리지 pairing이 필요합니다.",
  );

  const capabilityRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const requestIdRef = useRef(0);
  const operationRef = useRef<string | null>(null);
  const heartbeatInFlightRef = useRef(false);
  const heartbeatDueRef = useRef(false);
  const controllersRef = useRef(new Set<AbortController>());
  const requestTimeoutsRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const heartbeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const pairButtonRef = useRef<HTMLButtonElement>(null);
  const pairProgressRef = useRef<HTMLParagraphElement>(null);
  const pairingHeadingRef = useRef<HTMLHeadingElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const connectionHeadingRef = useRef<HTMLHeadingElement>(null);
  const connectionStatusRef = useRef<HTMLParagraphElement>(null);
  const retryButtonRef = useRef<HTMLButtonElement>(null);

  const projectedSnapshot = useMemo(
    () => (snapshot ? projectSnapshotEvents(snapshot) : null),
    [snapshot],
  );

  useEffect(() => {
    if (!focusIntent) return;
    const target = {
      pairing: pairingHeadingRef.current,
      code: codeInputRef.current,
      "pair-progress": pairProgressRef.current,
      connection: connectionHeadingRef.current,
      "connection-status": connectionStatusRef.current,
      retry: retryButtonRef.current,
    }[focusIntent];
    target?.focus();
    setFocusIntent(null);
  }, [focusIntent, state]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      capabilityRef.current = null;
      if (heartbeatTimerRef.current) clearTimeout(heartbeatTimerRef.current);
      heartbeatDueRef.current = false;
      for (const controller of controllersRef.current) controller.abort();
      for (const timeout of requestTimeoutsRef.current) clearTimeout(timeout);
      controllersRef.current.clear();
      requestTimeoutsRef.current.clear();
    };
  }, []);

  function clearHeartbeatTimer() {
    if (heartbeatTimerRef.current) clearTimeout(heartbeatTimerRef.current);
    heartbeatTimerRef.current = null;
  }

  function abortRequests() {
    for (const controller of controllersRef.current) controller.abort();
    controllersRef.current.clear();
    for (const timeout of requestTimeoutsRef.current) clearTimeout(timeout);
    requestTimeoutsRef.current.clear();
  }

  function createRequest() {
    const controller = new AbortController();
    controllersRef.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    requestTimeoutsRef.current.add(timeout);
    return {
      controller,
      dispose() {
        clearTimeout(timeout);
        requestTimeoutsRef.current.delete(timeout);
        controllersRef.current.delete(controller);
      },
    };
  }

  function current(generation: number, requestId?: number): boolean {
    return (
      mountedRef.current &&
      generationRef.current === generation &&
      (requestId === undefined || requestIdRef.current === requestId)
    );
  }

  function becomeTerminalAuthFailure() {
    generationRef.current += 1;
    requestIdRef.current += 1;
    clearHeartbeatTimer();
    heartbeatDueRef.current = false;
    capabilityRef.current = null;
    operationRef.current = null;
    heartbeatInFlightRef.current = false;
    abortRequests();
    setSnapshot(null);
    setCode("");
    setValidationError(null);
    setState({ kind: "terminal_auth_failed" });
    setAnnouncement(
      "브리지 자격이 만료되거나 폐기되어 연결을 종료했습니다. 새 pairing이 필요합니다.",
    );
    setFocusIntent("pairing");
  }

  async function loadFixture(
    capability: string,
    generation: number,
    focusOnSuccess: boolean,
  ) {
    const requestId = ++requestIdRef.current;
    const request = createRequest();
    try {
      const result = await readSyntheticFixture(
        capability,
        fetch,
        request.controller.signal,
      );
      if (!current(generation, requestId)) return false;
      setSnapshot(result);
      setState({ kind: "connected" });
      setAnnouncement("합성 읽기 전용 데이터가 연결되었습니다.");
      if (focusOnSuccess) setFocusIntent("connection");
      scheduleHeartbeat();
      return true;
    } catch (error) {
      if (!current(generation, requestId)) return false;
      if (isCapabilityAuthFailure(error)) {
        becomeTerminalAuthFailure();
        return false;
      }
      setSnapshot(null);
      setState({ kind: "read_failed" });
      setAnnouncement(
        "읽기 요청을 완료하지 못했습니다. 연결을 확인한 뒤 다시 시도할 수 있습니다.",
      );
      setFocusIntent("retry");
      return false;
    } finally {
      request.dispose();
    }
  }

  function scheduleHeartbeat() {
    clearHeartbeatTimer();
    heartbeatTimerRef.current = setTimeout(() => {
      heartbeatTimerRef.current = null;
      if (operationRef.current !== null || heartbeatInFlightRef.current) {
        heartbeatDueRef.current = true;
        return;
      }
      void sendHeartbeat(false);
    }, HEARTBEAT_INTERVAL_MS);
  }

  function sendDeferredHeartbeat() {
    if (!heartbeatDueRef.current || operationRef.current !== null) return;
    heartbeatDueRef.current = false;
    if (capabilityRef.current) void sendHeartbeat(false);
  }

  async function sendHeartbeat(recovery: boolean) {
    const capability = capabilityRef.current;
    const generation = generationRef.current;
    if (!capability || heartbeatInFlightRef.current) return;
    if (
      (recovery && operationRef.current !== "heartbeat-recovery") ||
      (!recovery && operationRef.current !== null)
    )
      return;

    if (!recovery) operationRef.current = "heartbeat";
    clearHeartbeatTimer();
    heartbeatInFlightRef.current = true;
    const request = createRequest();
    if (recovery) {
      setState({ kind: "heartbeat_failed", busy: true });
      setAnnouncement(
        "브리지 연결을 확인하고 합성 데이터를 다시 읽고 있습니다.",
      );
      setFocusIntent("connection-status");
    }
    try {
      await heartbeatBridge(capability, fetch, request.controller.signal);
      if (!current(generation)) return;
      setAnnouncement("브리지 연결 시간이 갱신되었습니다.");
      // A successful heartbeat restores the cadence even when the subsequent
      // snapshot/events refresh fails; the read error remains visible for retry.
      scheduleHeartbeat();
      if (recovery) {
        const loaded = await loadFixture(capability, generation, false);
        if (!loaded || !current(generation)) return;
        setState({ kind: "connected" });
        setAnnouncement("브리지 연결과 최신 합성 데이터를 확인했습니다.");
      }
    } catch (error) {
      if (!current(generation)) return;
      if (isCapabilityAuthFailure(error)) {
        becomeTerminalAuthFailure();
        return;
      }
      clearHeartbeatTimer();
      setState({ kind: "heartbeat_failed", busy: false });
      setAnnouncement(
        "연결 갱신을 확인하지 못했습니다. 자동 확인을 멈췄습니다.",
      );
      if (recovery) setFocusIntent("retry");
    } finally {
      request.dispose();
      if (current(generation)) {
        heartbeatInFlightRef.current = false;
        if (operationRef.current === "heartbeat") operationRef.current = null;
        sendDeferredHeartbeat();
      }
    }
  }

  async function submitPair(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operationRef.current) return;
    let submittedCode = trimAsciiWhitespace(code);
    if (!CODE_PATTERN.test(submittedCode)) {
      setValidationError(
        "43자의 영문자, 숫자, _ 또는 - 형식으로 code를 입력해 주세요.",
      );
      setAnnouncement("pairing code 형식을 확인해 주세요.");
      setFocusIntent("code");
      return;
    }

    operationRef.current = "pair";
    const pairButtonHadFocus = document.activeElement === pairButtonRef.current;
    const generation = generationRef.current;
    const request = createRequest();
    if (codeInputRef.current) codeInputRef.current.value = "";
    setCode("");
    setValidationError(null);
    setState({ kind: "pairing" });
    setAnnouncement("pairing 요청을 보내고 있습니다.");
    if (pairButtonHadFocus) setFocusIntent("pair-progress");

    try {
      const pairRequest = pairWithBridge(
        submittedCode,
        fetch,
        request.controller.signal,
      );
      submittedCode = "";
      const capability = await pairRequest;
      if (!current(generation)) return;
      capabilityRef.current = capability;
      operationRef.current = "read";
      setSnapshot(null);
      setState({ kind: "authenticated_loading" });
      setAnnouncement("읽기 전용 데이터를 불러오고 있습니다.");
      setFocusIntent("connection-status");
      await loadFixture(capability, generation, true);
    } catch (error) {
      if (!current(generation)) return;
      if (!(error instanceof BridgeResponseError) || error.status >= 500) {
        setState({ kind: "pair_outcome_unknown" });
        setAnnouncement(
          "code가 사용됐을 수 있어 결과를 확인할 수 없습니다. 터미널에서 새 code를 발급해 주세요.",
        );
        setFocusIntent("pairing");
      } else {
        const failure = pairFailure(error);
        setState({ kind: "pair_rejected", ...failure });
        setAnnouncement(failure.message);
        setFocusIntent(failure.focusCode ? "code" : "pairing");
      }
    } finally {
      request.dispose();
      if (current(generation)) {
        if (operationRef.current === "pair" || operationRef.current === "read")
          operationRef.current = null;
        sendDeferredHeartbeat();
      }
    }
  }

  async function retryRead() {
    if (operationRef.current) return;
    const capability = capabilityRef.current;
    if (!capability) return;
    operationRef.current = "read";
    setSnapshot(null);
    setState({ kind: "authenticated_loading" });
    setAnnouncement("합성 읽기 전용 데이터를 다시 읽고 있습니다.");
    setFocusIntent("connection-status");
    const generation = generationRef.current;
    try {
      await loadFixture(capability, generation, true);
    } finally {
      if (current(generation) && operationRef.current === "read") {
        operationRef.current = null;
        sendDeferredHeartbeat();
      }
    }
  }

  async function retryHeartbeat() {
    if (operationRef.current) return;
    operationRef.current = "heartbeat-recovery";
    const generation = generationRef.current;
    try {
      await sendHeartbeat(true);
    } finally {
      if (
        current(generation) &&
        operationRef.current === "heartbeat-recovery"
      ) {
        operationRef.current = null;
        sendDeferredHeartbeat();
      }
    }
  }

  async function disconnect() {
    if (operationRef.current === "pair" || operationRef.current === "revoke")
      return;
    const capability = capabilityRef.current;
    if (!capability) return;
    operationRef.current = "revoke";
    generationRef.current += 1;
    const generation = generationRef.current;
    clearHeartbeatTimer();
    heartbeatDueRef.current = false;
    heartbeatInFlightRef.current = false;
    abortRequests();
    capabilityRef.current = null;
    setSnapshot(null);
    setState({ kind: "revoking" });
    setAnnouncement("이 탭의 자격을 지우고 브리지 폐기를 요청하고 있습니다.");
    setFocusIntent("pair-progress");

    const request = createRequest();
    try {
      await revokeBridge(capability, fetch, request.controller.signal);
      if (!current(generation)) return;
      setState({ kind: "disconnected" });
      setAnnouncement("이 탭의 브리지 연결을 종료했습니다.");
    } catch {
      if (!current(generation)) return;
      setState({ kind: "local_disconnect_unconfirmed" });
      setAnnouncement(
        "이 탭의 자격은 지웠지만 브리지 폐기를 확인하지 못했습니다.",
      );
    } finally {
      request.dispose();
      if (operationRef.current === "revoke") operationRef.current = null;
      setCode("");
      setValidationError(null);
      if (current(generation)) setFocusIntent("code");
    }
  }

  const pairingMessage =
    state.kind === "pair_rejected"
      ? state.message
      : state.kind === "pair_outcome_unknown"
        ? "브리지에서 code가 이미 사용됐을 수 있습니다. 터미널에서 pair를 입력해 새 code를 발급하세요."
        : state.kind === "terminal_auth_failed"
          ? "브리지 자격이 만료되거나 폐기되었습니다. 새 pairing code가 필요합니다."
          : state.kind === "local_disconnect_unconfirmed"
            ? "이 탭의 자격은 지웠지만 브리지에서 폐기를 확인하지 못했습니다. 전체 자격을 즉시 무효화하려면 브리지 프로세스를 종료하세요."
            : validationError;

  const pairingLocked =
    state.kind === "pairing" ||
    state.kind === "authenticated_loading" ||
    state.kind === "revoking";
  const shouldShowPairing =
    state.kind !== "connected" &&
    state.kind !== "heartbeat_failed" &&
    state.kind !== "read_failed";

  return (
    <main className="workbench-page">
      <header className="workbench-header">
        <div>
          <p className="eyebrow">로컬 워크벤치</p>
          <h1>대화 미리보기</h1>
        </div>
        <span className="fixture-badge">합성 데이터 · 읽기 전용</span>
      </header>

      <section className="pairing-panel" aria-labelledby="pairing-heading">
        <div className="pairing-copy">
          <p className="eyebrow">브리지 연결</p>
          <h2 id="pairing-heading" ref={pairingHeadingRef} tabIndex={-1}>
            {state.kind === "connected" ||
            state.kind === "heartbeat_failed" ||
            state.kind === "read_failed"
              ? "읽기 전용 연결"
              : "합성 데이터 pairing"}
          </h2>
          <p>
            현재 화면은 bridge가 제공하는 synthetic fixture만 읽습니다. 실제
            프로젝트 파일, 계정 정보, OpenCode 세션에는 연결하지 않습니다.
          </p>
        </div>

        {shouldShowPairing ? (
          <form
            className="pairing-form"
            onSubmit={(event) => void submitPair(event)}
          >
            <label htmlFor="pairing-code">터미널 pairing code</label>
            <input
              ref={codeInputRef}
              id="pairing-code"
              name="pairing-code"
              type="password"
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
              value={code}
              disabled={pairingLocked}
              aria-invalid={Boolean(validationError)}
              aria-describedby={
                pairingMessage ? "pairing-feedback" : "pairing-hint"
              }
              onChange={(event) => {
                setCode(event.target.value);
                if (validationError) setValidationError(null);
              }}
            />
            <p
              className="field-feedback"
              id={pairingMessage ? "pairing-feedback" : "pairing-hint"}
            >
              {pairingMessage ??
                "실행 중인 로컬 브리지 터미널에서 받은 일회 code를 입력하세요."}
            </p>
            <button
              ref={pairButtonRef}
              className="action-button action-button--primary"
              type="submit"
              disabled={pairingLocked}
            >
              연결
            </button>
            {state.kind === "pairing" ? (
              <p
                ref={pairProgressRef}
                className="operation-status"
                role="status"
                aria-live="polite"
                tabIndex={-1}
              >
                pairing 요청을 보내고 있습니다…
              </p>
            ) : null}
          </form>
        ) : null}

        {state.kind === "connected" ? (
          <div className="connection-actions">
            <span className="connection-badge" role="status">
              연결됨 · 합성 읽기 전용
            </span>
            <button
              className="action-button"
              type="button"
              onClick={() => void retryRead()}
            >
              새로고침
            </button>
            <button
              className="action-button action-button--quiet"
              type="button"
              onClick={() => void disconnect()}
            >
              연결 끊기
            </button>
          </div>
        ) : null}

        {state.kind === "read_failed" ? (
          <div className="connection-actions">
            <p className="operation-status" role="status" aria-live="polite">
              브리지에서 데이터를 읽지 못했습니다. 자격은 유지되며 다시 시도할
              수 있습니다.
            </p>
            <button
              ref={retryButtonRef}
              className="action-button action-button--primary"
              type="button"
              onClick={() => void retryRead()}
            >
              다시 시도
            </button>
            <button
              className="action-button action-button--quiet"
              type="button"
              onClick={() => void disconnect()}
            >
              연결 끊기
            </button>
          </div>
        ) : null}

        {state.kind === "heartbeat_failed" ? (
          <div className="connection-actions">
            <p
              ref={connectionStatusRef}
              className="operation-status"
              role="status"
              aria-live="polite"
              tabIndex={-1}
            >
              연결 갱신을 확인하지 못했습니다. 자동 확인을 멈췄습니다.
              {state.busy
                ? " 연결을 확인하고 최신 데이터를 다시 읽고 있습니다…"
                : " 기존 데이터는 확인된 시점 그대로 표시합니다."}
            </p>
            <button
              ref={retryButtonRef}
              className="action-button action-button--primary"
              type="button"
              disabled={state.busy}
              onClick={() => void retryHeartbeat()}
            >
              연결 확인 다시 시도
            </button>
            <button
              className="action-button action-button--quiet"
              type="button"
              onClick={() => void disconnect()}
            >
              연결 끊기
            </button>
          </div>
        ) : null}

        {state.kind === "authenticated_loading" ? (
          <div className="connection-actions">
            <p
              ref={connectionStatusRef}
              className="operation-status"
              role="status"
              aria-live="polite"
              tabIndex={-1}
            >
              읽기 전용 데이터 연결 중…
            </p>
            {capabilityRef.current ? (
              <button
                className="action-button action-button--quiet"
                type="button"
                onClick={() => void disconnect()}
              >
                연결 끊기
              </button>
            ) : null}
          </div>
        ) : state.kind === "revoking" ? (
          <p
            ref={pairProgressRef}
            className="operation-status"
            role="status"
            aria-live="polite"
            tabIndex={-1}
          >
            이 탭의 연결을 종료하고 있습니다…
          </p>
        ) : null}
      </section>

      <p
        className="visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </p>

      {(state.kind === "connected" || state.kind === "heartbeat_failed") &&
      projectedSnapshot ? (
        <section className="session-column" aria-label="합성 대화">
          <div className="session-context">
            <div>
              <p className="eyebrow">{projectedSnapshot.workspace.name}</p>
              <h2 ref={connectionHeadingRef} tabIndex={-1}>
                {projectedSnapshot.session.title}
              </h2>
            </div>
            <span className="run-status" role="status" aria-live="polite">
              {projectedSnapshot.eventReconciliationNeeded
                ? "이벤트 재동기화 필요"
                : projectedSnapshot.run.status === "complete"
                  ? "합성 완료"
                  : "상태 확인 필요"}
            </span>
          </div>
          <p className="fixture-explanation">
            {projectedSnapshot.workspace.label}. 실제 경로, 프로젝트 파일, 계정
            정보는 사용하지 않습니다.
          </p>
          <div className="transcript" aria-label="assistant-ui 대화">
            <AssistantTranscript projectedSnapshot={projectedSnapshot} />
          </div>
        </section>
      ) : state.kind === "connected" || state.kind === "heartbeat_failed" ? (
        <section className="notice" role="status" aria-live="polite">
          합성 fixture를 준비하고 있습니다…
        </section>
      ) : state.kind === "authenticated_loading" ? (
        <section className="notice" role="status" aria-live="polite">
          읽기 전용 합성 fixture를 불러오고 있습니다…
        </section>
      ) : state.kind === "read_failed" ? (
        <section
          className="notice notice--error"
          role="status"
          aria-live="polite"
        >
          읽기 오류: 검증된 데이터를 표시할 수 없습니다. 연결 상태를 확인하고
          다시 시도해 주세요.
        </section>
      ) : null}
    </main>
  );
}
