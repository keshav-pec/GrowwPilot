import { AppError } from '../utils/AppError.js';

// Checks a request with Zod before it reaches the controller.
// Usage: router.post('/', validate({ body: createCustomerSchema }), controller)
//
// The cleaned values are saved on req.valid = { body, query, params }.
// (Express 5 does not let us overwrite req.query, so we use req.valid instead.)
export function validate(schemas) {
  return (req, res, next) => {
    req.valid = {};
    const issues = [];

    for (const part of ['body', 'query', 'params']) {
      if (!schemas[part]) continue;

      const result = schemas[part].safeParse(req[part] ?? {});
      if (result.success) {
        req.valid[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          issues.push({ field: [part, ...issue.path].join('.'), message: issue.message });
        }
      }
    }

    if (issues.length > 0) {
      return next(new AppError(400, 'VALIDATION_ERROR', 'Please check the highlighted fields', issues));
    }
    next();
  };
}
