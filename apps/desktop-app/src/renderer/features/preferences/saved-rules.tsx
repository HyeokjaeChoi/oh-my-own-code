import { useCallback, useEffect, useState } from "react";
import { Button } from "@workbench/ui";
import { useWorkbenchSelector } from "../../entities/workbench/index.js";
import {
  callSavedRules,
  savedRulesErrorText,
  type SavedRule,
} from "../../shared/saved-rules/index.js";
import styles from "./preferences.module.css";

// "저장된 허용 규칙": the project's "항상 허용" rows. They can only be removed
// here; the deny floor and the .git guard are never listed or editable.
export function SavedRulesSettings() {
  const workspaceId = useWorkbenchSelector((s) => s.selection.workspaceId);
  const [rules, setRules] = useState<SavedRule[]>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!workspaceId) return setRules(undefined);
    const result = await callSavedRules<{ rules: SavedRule[] }>({
      type: "rules.list",
      workspaceId,
    });
    if (!result.ok) {
      setRules(undefined);
      return setError(savedRulesErrorText(result.code));
    }
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
    if (!result.ok) setError(savedRulesErrorText(result.code));
    await load();
  };
  if (!workspaceId) return null;
  return (
    <section aria-label="저장된 허용 규칙">
      <h3 className={styles.subheading}>저장된 허용 규칙</h3>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {rules?.length === 0 && (
        <p role="status">이 프로젝트에 저장된 허용 규칙이 없습니다.</p>
      )}
      {rules?.map((rule) => (
        <div key={rule.id} className={styles.providerRow}>
          <span>
            {rule.action} · <small>{rule.resource}</small>
          </span>
          <Button
            size="compact"
            intent="danger"
            disabled={busy}
            aria-label={`${rule.action} ${rule.resource} 허용 규칙 삭제`}
            onClick={() => void remove(rule)}
          >
            삭제
          </Button>
        </div>
      ))}
    </section>
  );
}
