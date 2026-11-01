import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApiDocument } from '../src/docs/openapi.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'postman');

const OBJECT_ID = '665f1c2a9b1e8a0012345678';
const SAMPLE_BY_NAME = {
  productId: '{{productId}}',
  sku: '{{sku}}',
  orderId: '{{orderId}}',
  supplierId: '{{supplierId}}',
  addressId: '{{addressId}}',
  categoryId: '{{categoryId}}',
  brandId: '{{brandId}}',
  reviewId: '{{reviewId}}',
  userId: '{{userId}}',
  slug: '{{categorySlug}}',
  identifier: '{{productSlug}}',
  refreshToken: '{{refreshToken}}',
  name: 'Demo User',
  fullName: 'Aarav Sharma',
  email: 'aarav@example.com',
  password: 'Passw0rd123',
  newPassword: 'NewPassw0rd123',
  currentPassword: 'OldPassw0rd123',
  phone: '9876543210',
  label: 'Home',
  line1: '12 MG Road',
  line2: 'Apartment 4B',
  landmark: 'Near Metro Station',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  country: 'India',
  title: 'Demo product',
  comment: 'Excellent quality and fast delivery.',
  reason: 'Changed my mind',
  note: 'Demo note',
  adminNote: 'Internal demo note',
  customerNote: 'Please deliver after 6 PM',
  code: 'DEMO10',
  description: 'Demo description',
  shortDescription: 'Demo short description',
  url: 'https://example.com/image.jpg',
  publicId: 'highflier/demo/sample',
  folder: 'products',
  token: 'replace-with-token',
  courier: 'Demo Express',
  trackingNumber: 'MOCKTRK123456',
  amount: 100,
  quantity: 1,
  adjustment: 5,
  stock: 25
};

const resolveRef = (ref) => {
  if (!ref?.startsWith('#/')) return undefined;
  return ref
    .slice(2)
    .split('/')
    .reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), openApiDocument);
};

const deref = (schema) => {
  let current = schema;
  let guard = 0;
  while (current?.$ref && guard < 10) {
    current = resolveRef(current.$ref);
    guard += 1;
  }
  return current || {};
};

const mergeAllOf = (schema) => {
  const base = deref(schema);
  if (!Array.isArray(base.allOf)) return base;
  const merged = { ...base, allOf: undefined };
  for (const part of base.allOf) {
    const resolved = mergeAllOf(part);
    Object.assign(merged, resolved, {
      properties: { ...(merged.properties || {}), ...(resolved.properties || {}) },
      required: [...(merged.required || []), ...(resolved.required || [])]
    });
  }
  delete merged.allOf;
  return merged;
};

const pickExample = (schema) => {
  if (!schema || typeof schema !== 'object') return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  return null;
};

const sample = (schema, name = '', depth = 0) => {
  if (depth > 8) return null;
  const resolved = mergeAllOf(schema);
  const example = pickExample(resolved);
  if (example !== null) return example;

  if (resolved.allOf) return sample(resolved.allOf[0], name, depth + 1);
  if (resolved.oneOf?.length) return sample(resolved.oneOf[0], name, depth + 1);
  if (resolved.anyOf?.length) return sample(resolved.anyOf[0], name, depth + 1);

  if (SAMPLE_BY_NAME[name]) return SAMPLE_BY_NAME[name];

  switch (resolved.type) {
    case 'object': {
      const result = {};
      for (const [key, value] of Object.entries(resolved.properties || {})) {
        if (value?.readOnly) continue;
        result[key] = sample(value, key, depth + 1);
      }
      return result;
    }
    case 'array':
      return resolved.items ? [sample(resolved.items, name, depth + 1)] : [];
    case 'integer':
      return resolved.minimum ?? 1;
    case 'number':
      return resolved.minimum ?? 1.5;
    case 'boolean':
      return true;
    case 'string':
      if (resolved.format === 'email') return 'aarav@example.com';
      if (resolved.format === 'uri') return 'https://example.com/image.jpg';
      if (resolved.format === 'date-time') return '2026-10-31T12:00:00.000Z';
      if (resolved.pattern?.includes('0-9a-fA-F')) return OBJECT_ID;
      if (resolved.format === 'binary') return null;
      return resolved.minLength ? 'x'.repeat(Math.min(resolved.minLength, 8)) : 'string';
    default:
      return null;
  }
};

const specialBody = (pathName, method) => {
  const key = `${method} ${pathName}`;
  const overrides = {
    'post /orders/checkout': {
      paymentMethod: 'cod',
      addressId: '{{addressId}}',
      couponCode: 'WELCOME10',
      customerNote: 'Demo COD order'
    },
    'post /admin/coupons': {
      code: 'DEMO10',
      description: 'Demo: 10% off orders above ₹499',
      discountType: 'percent',
      discountValue: 10,
      maxDiscount: 200,
      minOrderValue: 499,
      scope: 'all',
      perUserLimit: 1,
      usageLimit: 0,
      isActive: true
    },
    'put /admin/suppliers/{id}/credentials': {
      credentials: { apiKey: 'replace-with-supplier-api-key', apiSecret: 'replace-with-supplier-api-secret' }
    },
    'patch /admin/inventory/{productId}/variants/{sku}': {
      stock: 25,
      note: 'Cycle count adjustment'
    },
    'patch /reviews/{id}': { rating: 5, comment: 'Updated demo review.' }
  };
  return overrides[key];
};

const jsonBody = (requestBody, pathName, method) => {
  const content = requestBody?.content || {};
  const media = content['application/json'] || Object.entries(content).find(([type]) => type.includes('json'))?.[1];
  if (!media?.schema) return null;
  const override = specialBody(pathName, method);
  if (override) return override;

  const generated = sample(media.schema);
  if (
    generated &&
    typeof generated === 'object' &&
    !Array.isArray(generated) &&
    Object.keys(generated).length === 0 &&
    ['patch', 'put'].includes(method)
  ) {
    return { name: 'Updated demo value' };
  }
  return generated;
};

const stripAdminNote = (summary = '') => summary.replace(/\s*Requires the \*\*admin\*\* role\.?$/i, '').trim();

const buildUrl = (basePath, parameters, operation) => {
  const rawPath = basePath.replace(/\{([^}]+)\}/g, (_, name) => `{{${name}}}`);
  const rootMounted = operation?.servers?.some((server) => server.url === '/');
  const base = rootMounted ? '{{rootUrl}}' : '{{baseUrl}}';
  const query = parameters
    .filter((parameter) => parameter?.in === 'query' && parameter.schema?.default !== undefined)
    .map((parameter) => `${parameter.name}=${encodeURIComponent(parameter.schema.default)}`)
    .join('&');

  return `${base}${rawPath}${query ? `?${query}` : ''}`;
};

const specialScript = (pathName, method) => {
  if (pathName === '/auth/login' && method === 'post') {
    return [
      'const body = pm.response.json();',
      'const tokens = body?.data?.tokens;',
      'if (tokens) {',
      "  pm.collectionVariables.set('accessToken', tokens.accessToken);",
      "  pm.collectionVariables.set('refreshToken', tokens.refreshToken);",
      '}'
    ].join('\n');
  }
  if (pathName === '/auth/refresh' && method === 'post') {
    return [
      'const body = pm.response.json();',
      "if (body?.data?.accessToken) pm.collectionVariables.set('accessToken', body.data.accessToken);",
      "if (body?.data?.refreshToken) pm.collectionVariables.set('refreshToken', body.data.refreshToken);"
    ].join('\n');
  }
  if (pathName === '/orders/checkout' && method === 'post') {
    return [
      'const body = pm.response.json();',
      "if (body?.data?.order?._id) pm.collectionVariables.set('orderId', body.data.order._id);"
    ].join('\n');
  }
  if (pathName === '/admin/suppliers' && method === 'post') {
    return [
      'const body = pm.response.json();',
      "if (body?.data?.supplier?._id) pm.collectionVariables.set('supplierId', body.data.supplier._id);"
    ].join('\n');
  }
  if (pathName === '/admin/products' && method === 'get') {
    return [
      'const body = pm.response.json();',
      'const product = body?.data?.products?.[0];',
      'if (product) {',
      "  pm.collectionVariables.set('productId', product._id);",
      "  pm.collectionVariables.set('productSlug', product.slug);",
      "  pm.collectionVariables.set('sku', product.variants?.[0]?.sku || '');",
      '}'
    ].join('\n');
  }
  return null;
};

const buildRequestItem = (pathName, method, operation, pathItem) => {
  const parameters = [...(pathItem.parameters || []), ...(operation.parameters || [])].map((parameter) =>
    parameter?.$ref ? resolveRef(parameter.$ref) : parameter
  );
  const noAuth = Array.isArray(operation.security) && operation.security.length === 0;

  const header = [];
  const bodyMode = operation.requestBody?.content?.['application/json']
    ? 'raw'
    : operation.requestBody?.content?.['multipart/form-data']
      ? 'formdata'
      : null;

  if (bodyMode === 'raw') header.push({ key: 'Content-Type', value: 'application/json', type: 'text' });
  if (!noAuth) header.push({ key: 'Authorization', value: 'Bearer {{accessToken}}', type: 'text' });
  if (operation.parameters?.some((parameter) => parameter?.$ref === '#/components/parameters/IdempotencyKey')) {
    header.push({ key: 'Idempotency-Key', value: '{{$guid}}', type: 'text' });
  }
  if (pathName === '/payments/webhook') {
    header.push({ key: 'X-Razorpay-Signature', value: '{{razorpayWebhookSignature}}', type: 'text' });
  }

  let body;
  if (bodyMode === 'raw') {
    body = { mode: 'raw', raw: JSON.stringify(jsonBody(operation.requestBody, pathName, method), null, 2), options: { raw: { language: 'json' } } };
  } else if (bodyMode === 'formdata') {
    const mediaSchema = operation.requestBody.content['multipart/form-data'].schema;
    body = {
      mode: 'formdata',
      formdata: Object.keys(mediaSchema.properties || {}).map((key) => ({
        key,
        type: mediaSchema.properties[key]?.format === 'binary' || mediaSchema.properties[key]?.type === 'array' ? 'file' : 'text',
        src: '',
        description: mediaSchema.properties[key]?.format === 'binary' ? 'Select a local image file' : ''
      }))
    };
  }

  const name = `${method.toUpperCase()} ${pathName}${operation.summary ? ` — ${stripAdminNote(operation.summary)}` : ''}`;
  const script = specialScript(pathName, method);

  return {
    name,
    request: {
      method: method.toUpperCase(),
      header,
      url: buildUrl(pathName, parameters, operation),
      ...(body ? { body } : {}),
      description: operation.description || stripAdminNote(operation.summary)
    },
    ...(script ? { event: [{ listen: 'test', script: { type: 'text/javascript', exec: script.split('\n') } }] } : {})
  };
};

const tagOrder = openApiDocument.tags.map((tag) => tag.name);
const folders = new Map();

for (const [pathName, pathItem] of Object.entries(openApiDocument.paths)) {
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    const tag = operation.tags?.[0] || 'Other';
    if (!folders.has(tag)) folders.set(tag, []);
    folders.get(tag).push(buildRequestItem(pathName, method, operation, pathItem));
  }
}

const collection = {
  info: {
    name: 'HIGHFLIER Backend API',
    description: `Postman collection generated from the OpenAPI document.

1. Set \`baseUrl\` (default \`http://localhost:5000/api/v1\`).
2. Run **Auth → POST /auth/login** to store \`accessToken\` (or set it manually).
3. Run **Catalogue → GET /products** then **Admin → GET /admin/products** to capture a product id and SKU.
4. Checkout and supplier requests automatically capture \`orderId\` and \`supplierId\`.

All mock supplier and mock payment responses are labelled \`isMock\`/\`mock: true\`. They are not real fulfilment or real money.`,
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
  },
  variable: [
    { key: 'baseUrl', value: 'http://localhost:5000/api/v1' },
    { key: 'rootUrl', value: 'http://localhost:5000' },
    { key: 'accessToken', value: '' },
    { key: 'refreshToken', value: '' },
    { key: 'id', value: OBJECT_ID },
    { key: 'productId', value: OBJECT_ID },
    { key: 'productSlug', value: 'mock-stainless-steel-cookware-set' },
    { key: 'sku', value: 'MOCK-HK-001-STD' },
    { key: 'orderId', value: OBJECT_ID },
    { key: 'supplierId', value: OBJECT_ID },
    { key: 'addressId', value: OBJECT_ID },
    { key: 'categoryId', value: OBJECT_ID },
    { key: 'categorySlug', value: 'home-kitchen' },
    { key: 'brandId', value: OBJECT_ID },
    { key: 'reviewId', value: OBJECT_ID },
    { key: 'userId', value: OBJECT_ID },
    { key: 'razorpayWebhookSignature', value: '' }
  ],
  item: [...folders.entries()]
    .sort(([a], [b]) => tagOrder.indexOf(a) - tagOrder.indexOf(b))
    .map(([tag, items]) => ({ name: tag, item: items }))
};

const environment = {
  id: 'highflier-local',
  name: 'HIGHFLIER Local',
  values: [
    { key: 'baseUrl', value: 'http://localhost:5000/api/v1', type: 'default', enabled: true },
    { key: 'rootUrl', value: 'http://localhost:5000', type: 'default', enabled: true },
    { key: 'accessToken', value: '', type: 'secret', enabled: true },
    { key: 'refreshToken', value: '', type: 'secret', enabled: true },
    { key: 'razorpayWebhookSignature', value: '', type: 'secret', enabled: true }
  ],
  _postman_variable_scope: 'environment',
  _postman_exported_using: 'HIGHFLIER scripts/generatePostman.js'
};

await mkdir(outputDir, { recursive: true });
await writeFile(
  path.join(outputDir, 'HIGHFLIER.postman_collection.json'),
  `${JSON.stringify(collection, null, 2)}\n`
);
await writeFile(
  path.join(outputDir, 'HIGHFLIER.postman_environment.json'),
  `${JSON.stringify(environment, null, 2)}\n`
);

const requestCount = collection.item.reduce((sum, folder) => sum + folder.item.length, 0);
console.log(`Wrote postman/HIGHFLIER.postman_collection.json with ${requestCount} requests in ${collection.item.length} folders.`);
console.log('Wrote postman/HIGHFLIER.postman_environment.json.');
