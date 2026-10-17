import {
  GitActionDock,
  GitReviewPanel,
} from "../../features/git-review/index.js";
import { LineFeedbackPanel } from "../../features/line-feedback/index.js";
import styles from "./changes.module.css";

export function ChangesPanel({ workspaceId }: { workspaceId: string }) {
  return (
    <div className={styles.changes} data-workspace={workspaceId}>
      <GitReviewPanel />
      <details className={styles.feedback}>
        <summary>줄 피드백</summary>
        <LineFeedbackPanel />
      </details>
      <GitActionDock />
    </div>
  );
}
