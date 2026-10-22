import { useState } from "react";
import { X } from "lucide-react";

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
export function TodoRow({ todo, onToggle, onEdit, onDelete, propertyLabel, onPropertyClick }) {
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
        <input
          autoFocus
          className="todo-edit-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
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
            {todo.text}
          </span>
          {badge && <span className={`todo-due-badge ${badge.className}`}>{badge.label}</span>}
          {todo.done && todo.completed_at && <span className="todo-completed-date">{formatCompletedDate(todo.completed_at)}</span>}
        </div>
        {propertyLabel && (
          <button type="button" className="todo-property-pill" onClick={onPropertyClick} title="Open this deal">
            {propertyLabel}
          </button>
        )}
      </div>
      <button type="button" className="todo-delete-btn" onClick={() => onDelete(todo.id)} aria-label="Delete to-do" title="Delete to-do">
        <X size={13} />
      </button>
    </div>
  );
}

export default function TodoList({ todos = [], onAdd, onToggle, onEdit, onDelete }) {
  const [text, setText] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [showDueDate, setShowDueDate] = useState(false);

  function handleAdd(e) {
    e.preventDefault();
    if (!text.trim()) return;
    onAdd(text.trim(), dueDate || undefined);
    setText("");
    setDueDate("");
    setShowDueDate(false);
  }

  // Open items first (front and center), completed ones pushed to the bottom —
  // a stable sort, so within each group they keep whatever order they already
  // had (creation order).
  const sortedTodos = [...todos].sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));

  return (
    <div className="todo-list">
      {sortedTodos.map((t) => (
        <TodoRow key={t.id} todo={t} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />
      ))}
      <form className="todo-add" onSubmit={handleAdd}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a to-do…"
        />
        <button
          type="button"
          className={`todo-due-toggle ${dueDate ? "todo-due-toggle--active" : ""}`}
          onClick={() => setShowDueDate((v) => !v)}
          aria-label="Set a due date"
          title="Set a due date"
        >
          📅
        </button>
        <button type="submit">Add</button>
      </form>
      {showDueDate && (
        <input
          type="date"
          className="todo-add-date-row"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          aria-label="Due date (optional)"
        />
      )}
    </div>
  );
}
