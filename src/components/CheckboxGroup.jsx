export default function CheckboxGroup({ name, values, onChange, options }) {
  function toggle(option) {
    if (values.includes(option)) {
      onChange(values.filter((v) => v !== option));
    } else {
      onChange([...values, option]);
    }
  }

  return (
    <div className="radio-group">
      {options.map((o) => (
        <label key={o} className="radio-option">
          <input type="checkbox" name={name} checked={values.includes(o)} onChange={() => toggle(o)} />
          {o}
        </label>
      ))}
    </div>
  );
}
