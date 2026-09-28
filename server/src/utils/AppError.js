// An error we throw on purpose, with an HTTP status and a short code.
// Example: throw new AppError(404, 'NOT_FOUND', 'Customer not found')
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
