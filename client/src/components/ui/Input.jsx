import Field, { fieldClass } from './Field';

// Works with react-hook-form: <Input label="Name" error={errors.name?.message} {...register('name')} />
export default function Input({ label, error, hint, id, className = '', ...props }) {
  const inputId = id || props.name;
  return (
    <Field label={label} error={error} hint={hint} id={inputId}>
      <input id={inputId} className={`${fieldClass(error)} ${className}`} {...props} />
    </Field>
  );
}
