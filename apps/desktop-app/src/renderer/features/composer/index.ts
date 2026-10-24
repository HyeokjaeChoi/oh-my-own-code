import { useEffect } from "react";
import type { AssistantRuntime } from "@assistant-ui/react";
import {
  emptyDraft,
  sendInFlight,
  useWindowWorkbench,
} from "../../entities/workbench/index.js";
import { selectionKey } from "../../shared/projection/index.js";
import {
  keepAutoModel,
  loadDefaultModel,
  usableDefaultModel,
} from "../../shared/providers/index.js";
// assistant-ui owns interaction. The window store owns the retained draft.
// Composer's internal send reset is not a user edit and cannot clear this draft.
export function useComposerDraft(
  runtime: AssistantRuntime,
  workspaceId: string,
  sessionId: string,
  // While an IME composes, the input alone owns the text: any write would
  // commit the composing syllable. The draft catches up on compositionend.
  composing: { readonly current: boolean },
) {
  const { store } = useWindowWorkbench(),
    key = selectionKey(workspaceId, sessionId);
  useEffect(() => {
    const sync = () => {
      if (composing.current) return;
      const state = store.getState();
      // A sent draft awaiting its ACK shows as empty (failure brings it back).
      const text = sendInFlight(state, key)
        ? ""
        : (state.drafts[key] ?? emptyDraft).text;
      if (runtime.thread.composer.getState().text !== text)
        runtime.thread.composer.setText(text);
    };
    sync();
    const unsubscribe = store.subscribe((next, previous) => {
      if (
        next.drafts[key] !== previous.drafts[key] ||
        next.operations !== previous.operations
      )
        sync();
    });
    const unsubscribeComposer = runtime.thread.composer.subscribe(sync);
    return () => {
      unsubscribe();
      unsubscribeComposer();
    };
  }, [store, runtime, key, composing]);
}

// Preselects the saved default model once per session while the draft requests none.
// Clearing the choice afterwards ("Native에서 결정") is respected.
export function useDefaultModel(workspaceId: string, sessionId: string) {
  const { store, actions } = useWindowWorkbench(),
    key = selectionKey(workspaceId, sessionId);
  useEffect(() => {
    let applied = false;
    // The model this hook picked itself. While the draft still holds it, the
    // pick follows the catalog (runtime catalogs change) instead of going stale.
    let auto = "";
    const apply = () => {
      const state = store.getState();
      const current = (state.drafts[key] ?? emptyDraft).model;
      const id = usableDefaultModel(state.catalog?.models, loadDefaultModel());
      if (auto && current === auto) {
        if (keepAutoModel(state.catalog?.models, auto)) return;
        auto = id;
        applied = Boolean(id);
        actions.options({ model: id });
        return;
      }
      if (applied || !id) return;
      applied = true;
      if (!current) {
        auto = id;
        actions.options({ model: id });
      }
    };
    apply();
    return store.subscribe(apply);
  }, [store, actions, key]);
}
