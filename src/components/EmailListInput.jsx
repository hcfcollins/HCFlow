/** Repeatable email inputs for forms where the whole screen is already in "edit
 * mode" (NewCompForm, GenerateCompForm) — as many emails as needed, not just one. */
export default function EmailListInput({ values, onChange }) {
  const list = values.length ? values : [""];

  function update(i, v) {
    onChange(list.map((x, idx) => (idx === i ? v : x)));
  }
  function remove(i) {
    onChange(list.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...list, ""]);
  }

  return (
    <div className="email-list-input">
      {list.map((v, i) => (
        <div key={i} className="email-list-input-row">
          <input type="email" value={v} onChange={(e) => update(i, e.target.value)} placeholder="email@example.com" />
          {list.length > 1 && (
            <button type="button" className="email-list-remove-btn" onClick={() => remove(i)} aria-label="Remove email">
              ×
            </button>
          )}
        </div>
      ))}
      <button type="button" className="email-list-add-btn" onClick={add}>
        + Add another email
      </button>
    </div>
  );
}
