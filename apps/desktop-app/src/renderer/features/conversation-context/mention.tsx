import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { File, Folder } from "lucide-react";
import { useWindowWorkbench } from "../../entities/workbench/index.js";
import styles from "./context.module.css";

type Token = { start: number; end: number; query: string };
type Item = { kind: "file" | "folder"; path: string };

const TOKEN = /(^|\s)@([^\s@]*)$/;

// `@query` before the caret → combobox over workspace files and folders. Focus
// stays in the textarea; the list is a listbox driven by aria-activedescendant.
export function useMention({
  input,
  suspended,
  replaceRange,
}: {
  input: RefObject<HTMLTextAreaElement | null>;
  // True while another composer menu (the `/` command menu) owns the keys.
  suspended: boolean;
  replaceRange: (start: number, end: number, text: string) => void;
}) {
  const { actions } = useWindowWorkbench();
  const listId = useId();
  const [token, setToken] = useState<Token | null>(null);
  // Each result set remembers the query it answered.
  const [results, setResults] = useState<{ query: string; items: Item[] }>({
    query: "",
    items: [],
  });
  const [active, setActive] = useState(0);
  // Escape hides the list until the text changes.
  const dismissed = useRef("");
  const panel = useRef<HTMLDivElement>(null);

  const track = useCallback(() => {
    const el = input.current;
    if (!el) return;
    const caret = el.selectionStart ?? el.value.length;
    const hit = TOKEN.exec(el.value.slice(0, caret));
    // Escape hides the list only until the text changes.
    if (dismissed.current !== el.value) dismissed.current = "";
    if (!hit || dismissed.current) {
      setToken(null);
      return;
    }
    const query = hit[2] ?? "";
    setToken((prev) =>
      prev && prev.query === query && prev.end === caret
        ? prev
        : { start: caret - query.length - 1, end: caret, query },
    );
  }, [input]);

  const query = token?.query ?? "";
  useEffect(() => {
    setActive(0);
    if (!query.trim()) {
      setResults({ query, items: [] });
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void actions.searchMentions(query).then((found) => {
        if (!live || !found) return;
        setResults({
          query,
          items: [
            ...found.files.map((path) => ({ kind: "file" as const, path })),
            ...found.folders.map((path) => ({
              kind: "folder" as const,
              path,
            })),
          ].slice(0, 20),
        });
      });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, actions]);

  const open = Boolean(token) && !suspended;
  // Results of an older query are never selectable.
  const stale = results.query !== query;
  const items = stale ? [] : results.items;
  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    el.showPopover();
    return () => {
      if (el.matches(":popover-open")) el.hidePopover();
    };
  }, [open]);

  const select = (item: Item) => {
    if (!token) return;
    if (item.kind === "folder") {
      replaceRange(token.start, token.end, `@${item.path}/ `);
    } else {
      replaceRange(token.start, token.end, "");
      void actions.attachContextFiles([item.path]);
    }
    setToken(null);
  };

  // Returns true when the key belonged to the list.
  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (!open) return false;
    if (event.key === "Escape") {
      dismissed.current = input.current?.value ?? "";
      setToken(null);
      return true;
    }
    if (!items.length) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + items.length) % items.length);
      return true;
    }
    // Shift+Tab is never ours (focus, or the composer mode switch).
    if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
      const item = items[active];
      if (!item) return false;
      select(item);
      return true;
    }
    return false;
  };

  const optionId = (i: number) => `${listId}-${i}`;
  const list: ReactNode = open ? (
    <div
      ref={panel}
      popover="manual"
      className={styles.mention}
      data-context-mention
    >
      {query.trim() === "" ? (
        <p className={styles.mentionHint}>파일 또는 폴더 이름을 입력하세요</p>
      ) : stale ? (
        <p className={styles.mentionHint} role="status">
          검색하는 중입니다
        </p>
      ) : items.length === 0 ? (
        <p className={styles.mentionHint} role="status">
          일치하는 파일이 없습니다
        </p>
      ) : (
        <ul id={listId} role="listbox" aria-label="파일·폴더 검색 결과">
          {items.map((item, i) => (
            <li
              key={`${item.kind}:${item.path}`}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              data-mention-kind={item.kind}
              title={item.path}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActive(i)}
              onClick={() => select(item)}
            >
              {item.kind === "folder" ? (
                <Folder size={14} aria-hidden="true" />
              ) : (
                <File size={14} aria-hidden="true" />
              )}
              <span>
                {item.kind === "folder" ? `${item.path}/` : item.path}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  ) : null;

  return {
    open,
    track,
    onKeyDown,
    list,
    // The textarea is a plain textbox until the list is open.
    props: open
      ? {
          role: "combobox" as const,
          "aria-autocomplete": "list" as const,
          "aria-expanded": true,
          ...(items.length
            ? {
                "aria-controls": listId,
                "aria-activedescendant": optionId(active),
              }
            : {}),
        }
      : {},
  };
}
