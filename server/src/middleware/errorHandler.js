import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';

// Runs when no route matched the request
export function notFound(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`));
}

// Every error ends up here, so every error response has the same shape:
// { error: { code, message, details? } }
export function errorHandler(err, req, res, next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details;

  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err.type === 'entity.parse.failed') {
    // The request body was not valid JSON
    status = 400;
    code = 'BAD_JSON';
    message = 'Request body is not valid JSON';
  } else if (err.name === 'CastError') {
    // A badly formed id, e.g. /customers/abc. Treat it like "not found".
    status = 404;
    code = 'NOT_FOUND';
    message = 'Record not found';
  } else if (err.code === 11000) {
    // A unique index was broken, e.g. a duplicate phone number
    status = 409;
    code = 'DUPLICATE';
    message = 'A record with these details already exists';
    details = err.keyValue;
  } else {
    // An unexpected bug: log it, but don't show internals in production
    console.error(err);
    if (env.NODE_ENV !== 'production') message = err.message;
  }

  res.status(status).json({ error: { code, message, details } });
}
