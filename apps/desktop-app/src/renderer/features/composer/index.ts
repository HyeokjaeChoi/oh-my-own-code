import { useEffect } from "react";
import type { AssistantRuntime } from "@assistant-ui/react";
import {
  emptyDraft,
  useWindowWorkbench,
} from "../../entities/workbench/index.js";
import { selectionKey } from "../../shared/projection/index.js";
import {
  loadDefaultModel,
  usableDefaultModel,
} from "../../shared/providers/index.js";
// assistant-ui owns interaction. The window store owns the retained draft.
// Composer's internal send reset is not a user edit and cannot clear this draft.
export function useComposerDraft(
  runtime: AssistantRuntime,
  workspaceId: string,
  sessionId: string,
) {
  const { store } = useWindowWorkbench(),
    key = selectionKey(workspaceId, sessionId);
  useEffect(() => {
    const sync = () => {
      const text = (store.getState().drafts[key] ?? emptyDraft).text;
      if (runtime.thread.composer.getState().text !== text)
        runtime.thread.composer.setText(text);
    };
    sync();
    const unsubscribe = store.subscribe((next, previous) => {
      if (next.drafts[key] !== previous.drafts[key]) sync();
    });
    const unsubscribeComposer = runtime.thread.composer.subscribe(sync);
    return () => {
      unsubscribe();
      unsubscribeComposer();
    };
  }, [store, runtime, key]);
}

// Preselects the saved default model once per session while the draft requests none.
// Clearing the choice afterwards ("Native에서 결정") is respected.
export function useDefaultModel(workspaceId: string, sessionId: string) {
  const { store, actions } = useWindowWorkbench(),
    key = selectionKey(workspaceId, sessionId);
  useEffect(() => {
    let applied = false;
    const apply = () => {
      if (applied) return;
      const state = store.getState();
      const id = usableDefaultModel(state.catalog?.models, loadDefaultModel());
      if (!id) return;
      applied = true;
      if (!(state.drafts[key] ?? emptyDraft).model)
        actions.options({ model: id });
    };
    apply();
    return store.subscribe(apply);
  }, [store, actions, key]);
}
