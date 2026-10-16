import { useCallback, useEffect, useRef, useState } from "react";
import { Button, EmptyState, Notice, Section } from "@workbench/ui";
import { useWorkbenchSelector } from "../../entities/workbench/index.js";
import {
  callSavedRules,
  savedRulesErrorText,
  type SavedRule,
} from "../../shared/saved-rules/index.js";
import styles from "./preferences.module.css";

// "권한": the project's "항상 허용" rows. They can only be removed
// here; the deny floor and the .git guard are never listed or editable.
export function SavedRulesSettings() {
  const workspaceId = useWorkbenchSelector((s) => s.selection.workspaceId);
  const [rules, setRules] = useState<SavedRule[]>();
  const [isGlobal, setIsGlobal] = useState(false);
  const latest = useRef(0);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const fail = (code: string) => {
    setOffline(code === "UNAVAILABLE");
    setError(code === "UNAVAILABLE" ? "" : savedRulesErrorText(code));
  };
  const load = useCallback(async () => {
    const mine = ++latest.current;
    if (!workspaceId) return setRules(undefined);
    const result = await callSavedRules<{
      rules: SavedRule[];
      global: boolean;
    }>({ type: "rules.list", workspaceId });
    // A newer load (or workspace switch) supersedes this reply.
    if (mine !== latest.current) return;
    if (!result.ok) {
      setRules(undefined);
      setOffline(result.code === "UNAVAILABLE");
      setError(
        result.code === "UNAVAILABLE" ? "" : savedRulesErrorText(result.code),
      );
      return;
    }
    setError("");
    setOffline(false);
    setIsGlobal(result.value.global === true);
    setRules(result.value.rules);
  }, [workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  const remove = async (rule: SavedRule) => {
    if (!workspaceId) return;
    setBusy(true);
    setError("");
    const result = await callSavedRules({
      type: "rules.remove",
      workspaceId,
      id: rule.id,
    });
    setBusy(false);
    await load();
    if (!result.ok) fail(result.code);
  };
  if (!workspaceId) return <EmptyState title="작업 공간을 먼저 선택하세요." />;
  return (
    <>
      {offline && (
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
      <Section
        title="저장된 허용 규칙"
        description="프로젝트별로 저장되며 같은 프로젝트의 작업 트리가 함께 사용합니다."
      >
        {rules?.length === 0 && <EmptyState title="저장된 규칙이 없습니다" />}
        <ul className={styles.rowList}>
          {rules?.map((rule) => (
            <li key={rule.id} className={styles.ruleRow}>
              <span className={styles.itemText}>
                <span className={styles.mono}>{rule.resource}</span>
              </span>
              <span className={styles.chip}>{rule.action}</span>
              <Button
                size="compact"
                className={styles.dangerText ?? ""}
                disabled={busy || isGlobal}
                aria-label={`${rule.action} ${rule.resource} 허용 규칙 삭제`}
                onClick={() => void remove(rule)}
              >
                삭제
              </Button>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
