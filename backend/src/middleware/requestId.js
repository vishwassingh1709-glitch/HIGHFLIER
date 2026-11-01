import crypto from 'node:crypto';

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export const requestId = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
