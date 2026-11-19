// Options can be plain strings, or { value, label } when the stored value and the
// shown text differ (e.g. the land improvements: key "well", label "Well (+$20,000)").
export default function CheckboxGroup({ name, values, onChange, options }) {
  const list = values || [];
  function toggle(value) {
    if (list.includes(value)) {
      onChange(list.filter((v) => v !== value));
    } else {
      onChange([...list, value]);
    }
  }

  return (
    <div className="radio-group">
      {options.map((o) => {
        const value = typeof o === "object" ? o.value : o;
        const label = typeof o === "object" ? o.label : o;
        return (
          <label key={value} className="radio-option">
            <input type="checkbox" name={name} checked={list.includes(value)} onChange={() => toggle(value)} />
            {label}
          </label>
        );
      })}
    </div>
  );
}
