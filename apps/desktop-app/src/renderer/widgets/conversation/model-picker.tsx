import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Input, Segmented, Switch } from "@workbench/ui";
import {
  defaultFreeOnly,
  defaultModelText,
  groupModels,
  modelDisplayName,
  variantLabel,
  type WorkbenchCatalog,
} from "../../shared/api/index.js";
import {
  loadFreeOnly,
  loadRecentModels,
  pushRecentModel,
  saveFreeOnly,
} from "../../shared/providers/index.js";
import styles from "./conversation.module.css";

type Entry = WorkbenchCatalog["models"]["entries"][number];
type Row = {
  id: string;
  name: string;
  hint?: string;
  free?: boolean;
  unavailable?: boolean;
};

type Props = {
  entries: Entry[];
  model: string;
  variant: string;
  variantCleared: boolean;
  // Name the session reports, shown on the default row.
  reportedName?: string | undefined;
  disabled: boolean;
  // Catalog ids that answered "not available for free"; still selectable.
  unavailable: readonly string[];
  onModel(_id: string): void;
  onVariant(_variant: string): void;
  close(): void;
};

// Searchable model list (combobox + listbox). Options are not tab stops: the
// search field keeps focus and points at the active row, so typing, arrows,
// Enter and Esc all work from one place.
export function ModelPicker(props: Props) {
  const { entries, model, variant } = props;
  const base = useId();
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [freeChoice, setFreeChoice] = useState(loadFreeOnly);
  const [recent, setRecent] = useState(loadRecentModels);
  const [active, setActive] = useState(0);
  const freeOnly = defaultFreeOnly(entries, freeChoice);
  const selected = entries.find((entry) => entry.id === model);
  const groups = useMemo(
    () => groupModels(entries, { query, freeOnly, recent, selectedId: model }),
    [entries, query, freeOnly, recent, model],
  );
  const lead: Row[] = query
    ? []
    : [
        {
          id: "",
          name: "기본 모델",
          hint: defaultModelText(props.reportedName).hint,
        },
        ...(model && !selected
          ? [{ id: model, name: `${model} (사용 불가)` }]
          : []),
      ];
  const groupRows = groups.map((group) => ({
    key: group.key,
    label: group.label,
    rows: group.items.map(
      (entry): Row => ({
        id: entry.id,
        name: modelDisplayName(entry.name),
        ...(group.key === "recent" && entry.provider
          ? { hint: entry.provider }
          : {}),
        ...(entry.free ? { free: true } : {}),
        ...(props.unavailable.includes(entry.id) ? { unavailable: true } : {}),
      }),
    ),
  }));
  const rows: Row[] = [...lead, ...groupRows.flatMap((group) => group.rows)];
  const optionId = (index: number) => `${base}-option-${index}`;
  const selectedIndex = rows.findIndex((row) => row.id === model);
  const variants = selected?.variants;
  const variantIds = variants?.status === "available" ? variants.ids : [];

  // Mounted only while the popover is open: every opening starts a fresh
  // search with the selected row active.
  useEffect(() => {
    search.current?.focus();
  }, []);
  useEffect(() => {
    setActive(Math.max(0, selectedIndex));
    // The active row follows the list, not every selection change.
  }, [query, freeOnly]);
  useEffect(() => {
    document
      .getElementById(optionId(active))
      ?.scrollIntoView({ block: "nearest" });
    // optionId is derived from base only.
  }, [active, rows.length]);

  const choose = (row: Row) => {
    if (props.disabled) return;
    props.onModel(row.id);
    if (row.id)
      setRecent(
        pushRecentModel(
          row.id,
          undefined,
          entries.map((entry) => entry.id),
        ),
      );
    const chosen = entries.find((entry) => entry.id === row.id);
    // A model with reasoning levels keeps the picker open for them.
    if (
      !(chosen?.variants?.status === "available" && chosen.variants.ids.length)
    )
      props.close();
  };
  let index = -1;
  const option = (row: Row) => {
    index += 1;
    const i = index;
    return (
      <div
        key={`${row.id}:${i}`}
        id={optionId(i)}
        role="option"
        aria-selected={row.id === model}
        className={styles.modelOption}
        data-active={i === active}
        data-model-option={row.id}
        // Keep focus in the search field.
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => i !== active && setActive(i)}
        onClick={() => choose(row)}
      >
        <span className={styles.modelName}>{row.name}</span>
        {row.hint && <span className={styles.modelHint}>{row.hint}</span>}
        {row.unavailable ? (
          <span className={styles.unavailableTag}>사용 불가</span>
        ) : (
          row.free && <span className={styles.freeBadge}>무료</span>
        )}
        <Check
          size={16}
          className={styles.modelCheck}
          aria-hidden="true"
          data-checked={row.id === model}
        />
      </div>
    );
  };
  const leadOptions = lead.map(option);
  return (
    <div className={styles.modelPicker} data-model-picker>
      <div className={styles.modelHeader}>
        <Input
          ref={search}
          type="search"
          role="combobox"
          aria-label="모델 검색"
          aria-expanded="true"
          aria-controls={`${base}-list`}
          aria-activedescendant={rows.length ? optionId(active) : undefined}
          aria-autocomplete="list"
          placeholder="모델 검색"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || props.disabled) return;
            const last = rows.length - 1;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActive((i) =>
                event.key === "ArrowDown"
                  ? i >= last
                    ? 0
                    : i + 1
                  : i <= 0
                    ? last
                    : i - 1,
              );
            } else if (event.key === "Home" || event.key === "End") {
              // Home/End jump in the list only with an empty search; otherwise
              // they keep moving the text cursor.
              if (query) return;
              event.preventDefault();
              setActive(event.key === "Home" ? 0 : last);
            } else if (event.key === "Enter") {
              event.preventDefault();
              const row = rows[active];
              if (row) choose(row);
            } else if (event.key === "Escape") {
              event.preventDefault();
              // A search is cleared first; a second Esc closes.
              if (query) setQuery("");
              else props.close();
            }
          }}
        />
        <Switch
          label="무료만"
          checked={freeOnly}
          onChange={(event) => {
            setFreeChoice(event.target.checked);
            saveFreeOnly(event.target.checked);
          }}
        />
      </div>
      <div
        ref={list}
        id={`${base}-list`}
        role="listbox"
        aria-label="모델"
        className={styles.modelList}
      >
        {leadOptions}
        {groupRows.map((group) => (
          <div
            key={group.key}
            role="group"
            aria-label={group.label}
            className={styles.modelGroup}
          >
            <div className={styles.modelGroupLabel} aria-hidden="true">
              {group.label}
            </div>
            {group.rows.map(option)}
          </div>
        ))}
        {rows.length === 0 && (
          <p className={styles.modelEmpty} role="status">
            일치하는 모델이 없습니다.
          </p>
        )}
      </div>
      {((model && variantIds.length > 0) || variant) && (
        <div className={styles.modelVariant}>
          <span id={`${base}-variant`}>추론 강도</span>
          <Segmented
            aria-labelledby={`${base}-variant`}
            name={`${base}-variant`}
            value={variant}
            disabled={props.disabled}
            onChange={props.onVariant}
            options={[
              { value: "", label: "기본" },
              ...(variant && !variantIds.includes(variant)
                ? [
                    {
                      value: variant,
                      label: `${variantLabel(variant)} (사용 불가)`,
                    },
                  ]
                : []),
              ...variantIds.map((id) => ({
                value: id,
                label: variantLabel(id),
              })),
            ]}
          />
        </div>
      )}
      {model && variants?.status !== "available" && (
        <p className={styles.runtimeHint}>
          추론 강도 목록을 확인할 수 없습니다. 요청 없이 모델을 사용할 수
          있습니다.
        </p>
      )}
      <p className={styles.runtimeHint}>선택은 다음 전송부터 적용됩니다.</p>
      {props.variantCleared && (
        <p
          className={styles.runtimeHint}
          role="status"
          data-variant-cleared="true"
        >
          모델을 바꿔 이전 추론 강도 요청을 지웠습니다.
        </p>
      )}
    </div>
  );
}
