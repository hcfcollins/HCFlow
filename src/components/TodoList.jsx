import { useState } from "react";

export default function TodoList({ todos = [], onAdd, onToggle }) {
  const [text, setText] = useState("");

  function handleAdd(e) {
    e.preventDefault();
    if (!text.trim()) return;
    onAdd(text.trim());
    setText("");
  }

  return (
    <div className="todo-list">
      {todos.map((t) => (
        <label key={t.id} className={`todo-item ${t.done ? "done" : ""}`}>
          <input type="checkbox" checked={t.done} onChange={(e) => onToggle(t.id, e.target.checked)} />
          {t.text}
        </label>
      ))}
      <form className="todo-add" onSubmit={handleAdd}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a to-do…"
        />
        <button type="submit">Add</button>
      </form>
    </div>
  );
}
