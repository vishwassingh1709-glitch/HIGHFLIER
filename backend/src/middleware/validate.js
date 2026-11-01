import { ApiError } from '../utils/ApiError.js';

const applyValidated = (req, source, data) => {
  if (source === 'query') {
    Object.defineProperty(req, 'query', {
      value: data,
      writable: true,
      configurable: true,
      enumerable: true
    });
    return;
  }
  req[source] = data;
};

export const validate =
  (schema, source = 'body') =>
  (req, _res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.') || source,
        message: issue.message,
        code: issue.code
      }));
      return next(ApiError.unprocessable('Request validation failed', details));
    }
    applyValidated(req, source, result.data);
    return next();
  };

export const validateRequest = ({ body, query, params }) => {
  const middlewares = [];
  if (body) middlewares.push(validate(body, 'body'));
  if (query) middlewares.push(validate(query, 'query'));
  if (params) middlewares.push(validate(params, 'params'));
  return middlewares;
};
