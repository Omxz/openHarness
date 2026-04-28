export function FilterChips({ label, value, options, onChange }) {
  return (
    <div className="chips">
      <span className="chips-label">{label}</span>
      {options.map((o) => (
        <button
          key={o}
          className={`chip ${value === o ? "is-active" : ""}`}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
