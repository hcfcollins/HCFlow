import { useState } from "react";
import { X, AlertTriangle } from "lucide-react";
import { missingInfoItems } from "../lib/missingInfo";
import { useTodoActions } from "../lib/TodoActionsContext";
import MentionInput from "./MentionInput";
import { useMentionRoster, splitMentions } from "../lib/mentions";

/** Plain text with any http(s) links made clickable (opens a new tab, and
 * doesn't also trigger tap-to-edit on the to-do). */
function Linkified({ text }) {
  const pieces = text.split(/(https?:\/\/[^\s]+)/g);
  return pieces.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noreferrer" className="todo-link" onClick={(e) => e.stopPropagation()}>
        {p}
      </a>
    ) : (
      p
    )
  );
}

/** To-do text with @-tagged people shown bold and in the brand color. */
function TodoText({ text }) {
  const roster = useMentionRoster();
  return splitMentions(text, roster).map((part, i) =>
    typeof part === "string" ? (
      <Linkified key={i} text={part} />
    ) : (
      <strong key={i} className="todo-mention" title={part.agent.name}>
        {part.mention}
      </strong>
    )
  );
}

function formatCompletedDate(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function dueBadge(dueDate) {
  if (!dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  const days = Math.round((due - today) / 86400000);
  if (days < 0) return { label: "Overdue", className: "todo-due-badge--overdue" };
  if (days === 0) return { label: "Due Today", className: "todo-due-badge--today" };
  return { label: `Due ${due.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, className: "todo-due-badge--upcoming" };
}

/** Tap the text to edit it in place (blur/Enter saves, Escape cancels) — separate
 * from the checkbox so toggling done and editing the text don't fight over the
 * same tap target the way they would if this were still one big <label>. */
export function TodoRow({ todo, onToggle, onEdit, onDelete, propertyLabel, onPropertyClick, renderActions: renderActionsProp }) {
  const contextActions = useTodoActions();
  const renderActions = renderActionsProp || contextActions;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(todo.text);
  const badge = !todo.done && dueBadge(todo.due_date);

  function commitEdit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== todo.text) onEdit(todo.id, { text: trimmed });
    else setDraft(todo.text);
  }

  if (editing) {
    return (
      <div className="todo-item todo-item--editing">
        <MentionInput
          autoFocus
          className="todo-edit-input"
          value={draft}
          onChange={setDraft}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.target.blur();
            if (e.key === "Escape") {
              setDraft(todo.text);
              setEditing(false);
            }
          }}
        />
      </div>
    );
  }

  const urgentClass = badge?.className === "todo-due-badge--overdue" ? "todo-item--overdue" : badge?.className === "todo-due-badge--today" ? "todo-item--today" : "";

  return (
    <div className={`todo-item ${todo.done ? "done" : ""} ${urgentClass}`}>
      <input type="checkbox" checked={todo.done} onChange={(e) => onToggle(todo, e.target.checked)} />
      <div className="todo-item-main">
        <div className="todo-item-top-row">
          <span className="todo-text" onClick={() => setEditing(true)}>
            <TodoText text={todo.text} />
          </span>
          {badge && <span className={`todo-due-badge ${badge.className}`}>{badge.label}</span>}
          {todo.done && todo.completed_at && (
            <span className="todo-completed-date" title={todo.completed_by_initials ? `Checked off by ${todo.completed_by_initials}` : undefined}>
              {formatCompletedDate(todo.completed_at)}
              {todo.completed_by_initials ? ` · ${todo.completed_by_initials}` : ""}
            </span>
          )}
        </div>
        {propertyLabel && (
          <button type="button" className="todo-property-pill" onClick={onPropertyClick} title="Open this deal">
            {propertyLabel}
          </button>
        )}
      </div>
      {renderActions && renderActions(todo)}
      <button type="button" className="todo-delete-btn" onClick={() => onDelete(todo.id)} aria-label="Delete to-do" title="Delete to-do">
        <X size={13} />
      </button>
    </div>
  );
}

/** `renderActions(todo)` — optional extra per-row buttons (e.g. the staff
 * "notify agent" bell, or Generate Utility Email on the Send Utilities to-do). */
/** The "standing to-do" for a deal's missing info — highlighted, can't be
 * checked off or deleted, and vanishes by itself once every field is filled
 * in (see lib/missingInfo.js). Tapping it opens the deal to fill things in. */
export function MissingInfoTodo({ tx, onOpen, onPick }) {
  const missing = missingInfoItems(tx);
  if (!missing.length) return null;
  // On a card: open the deal and jump to the field. On the deal screen
  // itself: just jump (onPick scrolls + flashes it).
  const go = (field) => (onPick ? onPick(field) : onOpen?.({ ...tx, _focusField: field }));
  return (
    <div
      role="button"
      tabIndex={0}
      className="missing-info-todo"
      onClick={(e) => {
        e.stopPropagation();
        go(missing[0].field);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") go(missing[0].field);
      }}
      title="Take me to the missing info"
    >
      <AlertTriangle size={14} className="missing-info-todo-icon" />
      <span>
        <strong>Add missing info:</strong>{" "}
        {missing.map((m, i) => (
          <span key={m.field}>
            <button
              type="button"
              className="missing-info-link"
              title={`Go to ${m.label}`}
              onClick={(e) => {
                e.stopPropagation();
                go(m.field);
              }}
            >
              {m.label}
            </button>
            {i < missing.length - 1 ? ", " : ""}
          </span>
        ))}
      </span>
    </div>
  );
}

const dueSortKey = (t) => (t.due_date ? new Date(`${t.due_date}T00:00:00`).getTime() : Infinity);

/** `maxVisible` (deal cards): show only the N most urgent open to-dos —
 * overdue/soonest-due first, undated after — with a "+N more" link
 * (`onShowMore`, opens the deal) so one busy deal doesn't make its card
 * three times taller than its neighbors. */
export default function TodoList({ todos = [], onAdd, onToggle, onEdit, onDelete, renderActions, maxVisible, onShowMore, emptyHint }) {
  const [text, setText] = useState("");
  const [dueDate, setDueDate] = useState("");

  function handleAdd(e) {
    e.preventDefault();
    if (!text.trim()) return;
    onAdd(text.trim(), dueDate || undefined);
    setText("");
    setDueDate("");
  }

  // Open items first (front and center), completed ones pushed to the bottom —
  // a stable sort, so within each group they keep whatever order they already
  // had (creation order).
  let sortedTodos = [...todos].sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
  let hiddenCount = 0;
  if (maxVisible && sortedTodos.length > maxVisible) {
    sortedTodos = sortedTodos.sort((a, b) => a.done - b.done || dueSortKey(a) - dueSortKey(b));
    hiddenCount = sortedTodos.length - maxVisible;
    sortedTodos = sortedTodos.slice(0, maxVisible);
  }

  return (
    <div className="todo-list">
      {sortedTodos.map((t) => (
        <TodoRow key={t.id} todo={t} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} renderActions={renderActions} />
      ))}
      {todos.length === 0 && emptyHint && <div className="todo-empty-hint">{emptyHint}</div>}
      {hiddenCount > 0 && (
        <button type="button" className="todo-more-btn" onClick={onShowMore} title="Open the deal to see every to-do">
          + {hiddenCount} more to-do{hiddenCount > 1 ? "s" : ""}
        </button>
      )}
      <form className="todo-add" onSubmit={handleAdd}>
        <MentionInput
          value={text}
          onChange={setText}
          placeholder="Add a to-do… (@name to notify)"
        />
        {/* The real date input sits invisibly on top of the 📅, so a tap opens
            the phone's date picker straight away; showPicker() covers desktop
            browsers, where clicking a date field's text doesn't open it. */}
        <label className={`todo-due-toggle ${dueDate ? "todo-due-toggle--active" : ""}`} title="Set a due date">
          📅
          <input
            type="date"
            className="todo-due-native"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            onClick={(e) => {
              try {
                e.currentTarget.showPicker?.();
              } catch {
                /* already open, or not supported — the native tap still works */
              }
            }}
            aria-label="Set a due date"
          />
        </label>
        <button title="Add this to-do (anyone you @tag gets notified)" type="submit">Add</button>
      </form>
      {dueDate && (
        <div className="todo-due-chip">
          Due {new Date(`${dueDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
          <button type="button" onClick={() => setDueDate("")} aria-label="Clear due date" title="Clear due date">
            <X size={11} />
          </button>
        </div>
      )}
    </div>
  );
}
