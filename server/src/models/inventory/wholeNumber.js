// A quantity: always a whole number (bottles, kits, ml, g or pieces). min: 0 by default, null = not set.
export function wholeNumber(options = {}) {
  return {
    type: Number,
    min: 0,
    validate: { validator: (v) => v == null || Number.isInteger(v), message: '{PATH} must be a whole number' },
    ...options,
  };
}
