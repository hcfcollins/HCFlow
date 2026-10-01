import { useState } from "react";

function formatCompletedDate(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dueBadge(dueDate) {
  if (!dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  const days = Math.round((due - today) / 86400000);
  if (days < 0) return { label: "Overdue", className: "todo-due-badge--overdue" };
  if (days === 0) return { label: "Due Today", className: "todo-due-badge--today" };
  return { label: `Due ${due.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, className: "todo-due-badge--upcoming" };
}

export default function TodoList({ todos = [], onAdd, onToggle }) {
  const [text, setText] = useState("");
  const [dueDate, setDueDate] = useState("");

  function handleAdd(e) {
    e.preventDefault();
    if (!text.trim()) return;
    onAdd(text.trim(), dueDate || undefined);
    setText("");
    setDueDate("");
  }

  return (
    <div className="todo-list">
      {todos.map((t) => {
        const badge = !t.done && dueBadge(t.due_date);
        return (
          <label key={t.id} className={`todo-item ${t.done ? "done" : ""}`}>
            <input type="checkbox" checked={t.done} onChange={(e) => onToggle(t, e.target.checked)} />
            {t.text}
            {badge && <span className={`todo-due-badge ${badge.className}`}>{badge.label}</span>}
            {t.done && t.completed_at && <span className="todo-completed-date">{formatCompletedDate(t.completed_at)}</span>}
          </label>
        );
      })}
      <form className="todo-add" onSubmit={handleAdd}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a to-do…"
        />
        <input
          type="date"
          className="todo-add-date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          aria-label="Due date (optional)"
        />
        <button type="submit">Add</button>
      </form>
    </div>
  );
}
