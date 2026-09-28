import Field, { fieldClass } from './Field';

// options: [{ value: 'CASH', label: 'Cash' }, ...]
export default function Select({ label, error, hint, id, options = [], placeholder, className = '', ...props }) {
  const inputId = id || props.name;
  return (
    <Field label={label} error={error} hint={hint} id={inputId}>
      <select id={inputId} className={`${fieldClass(error)} ${className}`} {...props}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
