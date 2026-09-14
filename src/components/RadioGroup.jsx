export default function RadioGroup({ name, value, onChange, options }) {
  const normalized = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <div className="radio-group">
      {normalized.map((o) => (
        <label key={o.value} className="radio-option">
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}
