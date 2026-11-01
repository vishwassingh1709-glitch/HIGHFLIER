const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

const sanitizeValue = (value) => {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!isPlainObject(value)) return value;

  const clean = {};
  for (const [key, nested] of Object.entries(value)) {
    // Block MongoDB operator injection and dotted-path injection.
    if (key.startsWith('$') || key.includes('.')) continue;
    clean[key] = sanitizeValue(nested);
  }
  return clean;
};

const replaceObjectContents = (target, cleaned) => {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, cleaned);
};

/**
 * Defence-in-depth against NoSQL injection. Zod validation remains the primary
 * input contract; this strips operator keys early so they never reach Mongoose.
 */
export const sanitizeRequest = (req, _res, next) => {
  if (req.body && isPlainObject(req.body)) {
    req.body = sanitizeValue(req.body);
  }
  if (req.query && isPlainObject(req.query)) {
    replaceObjectContents(req.query, sanitizeValue(req.query));
  }
  if (req.params && isPlainObject(req.params)) {
    replaceObjectContents(req.params, sanitizeValue(req.params));
  }
  next();
};
