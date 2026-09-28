import Field, { fieldClass } from './Field';

export default function Textarea({ label, error, hint, id, rows = 3, className = '', ...props }) {
  const inputId = id || props.name;
  return (
    <Field label={label} error={error} hint={hint} id={inputId}>
      <textarea id={inputId} rows={rows} className={`${fieldClass(error)} ${className}`} {...props} />
    </Field>
  );
}
