// A fresh Idempotency-Key, made once per form: a double click or a retry with the same key happens only once
export const newRequestKey = () => crypto.randomUUID();
