import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AtSign, File, FileImage, FileText, Folder, X } from "lucide-react";
import {
  selectors,
  useWindowWorkbench,
  useWorkbenchSelector,
} from "../../entities/workbench/index.js";
import {
  CONTEXT_LIMITS,
  contextModelSupports,
  type ContextDescriptor,
} from "../../shared/api/index.js";
import styles from "./context.module.css";

const notReady = "세션이 준비되면 사용할 수 있습니다";

export type ContextIntake = {
  notice: string;
  pickFiles(): void;
  pickFolder(): void;
  // Starts an `@` mention in the composer.
  search(): void;
  drop(files: File[]): void;
  // Clipboard files: true when an image was taken (caller cancels the text paste).
  paste(files: File[]): boolean;
};

type PasteMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
const PASTE_MIMES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

// Files are attached through observeContext; folders only become `@dir/`
// mentions in the message text (no new send wire).
export function useContextIntake(
  insertText: (text: string) => void,
): ContextIntake {
  const { actions } = useWindowWorkbench();
  const [notice, setNotice] = useState("");
  const insert = useRef(insertText);
  insert.current = insertText;
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 8000);
    return () => clearTimeout(timer);
  }, [notice]);
  const take = useCallback(
    async (read: ReturnType<typeof actions.pickContextPaths>) => {
      setNotice("");
      const result = await read;
      if (!result.ok) {
        if (result.code !== "CANCELLED")
          setNotice("파일을 가져오지 못했습니다. 다시 시도하세요.");
        return;
      }
      if (result.refused > 0)
        setNotice(`작업 공간 밖의 파일 ${result.refused}개는 제외했습니다.`);
      if (result.files.length) await actions.attachContextFiles(result.files);
      if (result.folders.length)
        insert.current(
          `${result.folders.map((dir) => `@${dir || "."}/`).join(" ")} `,
        );
    },
    [actions],
  );
  return {
    notice,
    pickFiles: () => void take(actions.pickContextPaths("file")),
    pickFolder: () => void take(actions.pickContextPaths("folder")),
    search: () => insert.current("@"),
    drop: (files) => void take(actions.resolveDroppedFiles(files)),
    paste(files) {
      const image = files.find((f) => f.type.startsWith("image/"));
      if (!image) return false;
      // A copied file that has a path attaches like a dropped file.
      if (actions.droppedFileHasPath(image)) {
        void take(actions.resolveDroppedFiles([image]));
        return true;
      }
      if (!PASTE_MIMES.includes(image.type))
        setNotice("지원하지 않는 파일 형식입니다.");
      else if (image.size < 1 || image.size > CONTEXT_LIMITS.fileBytes)
        setNotice("파일 크기 한도를 넘었습니다.");
      else {
        setNotice("");
        void image.arrayBuffer().then(
          (buffer) =>
            actions.pasteContextImage({
              mime: image.type as PasteMime,
              bytes: new Uint8Array(buffer),
            }),
          () => setNotice("이미지를 붙여넣지 못했습니다. 다시 시도하세요."),
        );
      }
      return true;
    },
  };
}

// Direct actions only: each item does its thing and closes the menu.
export function AttachMenuBody({
  intent,
  ready,
}: {
  intent: ContextIntake;
  ready: boolean;
}) {
  const items = [
    { key: "file", label: "파일 추가…", icon: File, run: intent.pickFiles },
    {
      key: "folder",
      label: "폴더 추가…",
      icon: Folder,
      run: intent.pickFolder,
    },
    {
      key: "search",
      label: "파일·폴더 검색",
      hint: "@",
      icon: AtSign,
      run: intent.search,
    },
  ];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ),
    );
    const at = buttons.indexOf(event.target as HTMLButtonElement);
    const next =
      event.key === "ArrowDown"
        ? (at + 1) % buttons.length
        : event.key === "ArrowUp"
          ? (at - 1 + buttons.length) % buttons.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : -1;
    if (next < 0 || !buttons.length) return;
    event.preventDefault();
    buttons[next]?.focus();
  };
  return (
    <div className={styles.menu} onKeyDown={onKeyDown}>
      {items.map(({ key, label, hint, icon: Icon, run }) => (
        <button
          key={key}
          type="button"
          role="menuitem"
          className={styles.menuItem}
          data-context-menu-item={key}
          disabled={!ready}
          onClick={(event) => {
            const panel = event.currentTarget.closest<HTMLElement>("[popover]");
            panel?.hidePopover();
            run();
          }}
        >
          <Icon size={16} aria-hidden="true" />
          <span>
            {label}
            {!ready && <small>{notReady}</small>}
          </span>
          {hint && <kbd aria-hidden="true">{hint}</kbd>}
        </button>
      ))}
    </div>
  );
}

const kb = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;

function reasonFor(
  d: ContextDescriptor,
  verified: boolean,
  model: string,
  entry: { variants: unknown; capabilities?: unknown } | undefined,
): { text: string; model: boolean } | undefined {
  if (!verified)
    return {
      text:
        d.source === "paste"
          ? "확인 기간이 끝났습니다. 이미지를 다시 붙여넣으세요."
          : "다시 확인이 필요합니다. 첨부를 눌러 확인하세요.",
      model: false,
    };
  if (!model || !entry)
    return { text: "첨부를 보낼 모델을 선택하세요.", model: true };
  return contextModelSupports(entry as never, [d])
    ? undefined
    : { text: "현재 모델은 이 형식을 지원하지 않습니다", model: true };
}

// Chips live inside the composer card; a chip opens the preview popover.
export function AttachmentChips({
  previewId,
  onChangeModel,
}: {
  previewId: string;
  onChangeModel: () => void;
}) {
  const { actions } = useWindowWorkbench();
  const draft = useWorkbenchSelector(selectors.contextDraft);
  const preview = useWorkbenchSelector(selectors.conversationContext).preview;
  const model = useWorkbenchSelector((s) => selectors.draft(s).model);
  const catalog = useWorkbenchSelector((s) => s.catalog);
  // The store keeps only the latest preview; remember image data per chip.
  const thumbs = useRef(new Map<string, string>());
  if (preview?.value.kind === "image")
    thumbs.current.set(preview.descriptor.capabilityId, preview.value.dataUrl);
  if (!draft.items.length) return null;
  const entry =
    catalog?.models.status === "available"
      ? catalog.models.entries.find((e) => e.id === model)
      : undefined;
  return (
    <ul className={styles.chipRow} aria-label="첨부" data-context-chips>
      {draft.items.map((d) => {
        const reason = reasonFor(
          d,
          draft.verifiedIds.includes(d.capabilityId),
          model,
          entry && {
            variants: entry.variants,
            ...(entry.capabilities ? { capabilities: entry.capabilities } : {}),
          },
        );
        const thumb = thumbs.current.get(d.capabilityId);
        const Icon = d.mime.startsWith("image/")
          ? FileImage
          : d.mime === "application/pdf" || d.mime.startsWith("text/")
            ? FileText
            : File;
        return (
          <li
            // Re-reading a file issues a new capabilityId; the chip (and the focus
            // the preview popover returns to) must survive it.
            key={`${d.source}:${d.path}:${d.range?.start ?? ""}-${d.range?.end ?? ""}`}
            className={styles.attChip}
            data-context-item={d.capabilityId}
            data-context-source={d.source}
            data-state={reason ? "warn" : "ok"}
          >
            <button
              type="button"
              className={styles.attMain}
              // A pasted image has no workspace path to re-read: no preview open.
              popoverTarget={d.source === "paste" ? undefined : previewId}
              title={d.path}
              data-context-open={d.capabilityId}
              onClick={() =>
                d.source === "paste"
                  ? undefined
                  : void actions.observeContext(d.path)
              }
            >
              {thumb ? (
                <img src={thumb} alt="" className={styles.attThumb} />
              ) : (
                <Icon size={16} aria-hidden="true" />
              )}
              <span className={styles.attName}>{d.name}</span>
              <span className={styles.attSize}>{kb(d.size)}</span>
            </button>
            <button
              type="button"
              className={styles.attRemove}
              aria-label={`첨부 제거: ${d.name}`}
              title="첨부 제거"
              data-context-remove={d.capabilityId}
              onClick={() => actions.removeContext(d.capabilityId)}
            >
              <X size={14} aria-hidden="true" />
            </button>
            {reason && (
              <span className={styles.attReason} data-context-reason>
                {reason.text}
                {reason.model && (
                  <button
                    type="button"
                    data-context-change-model
                    onClick={onChangeModel}
                  >
                    모델 바꾸기
                  </button>
                )}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
