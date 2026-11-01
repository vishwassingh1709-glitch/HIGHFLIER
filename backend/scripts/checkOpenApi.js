import { openApiDocument } from '../src/docs/openapi.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
const problems = [];

const resolveRef = (ref) => {
  if (!ref.startsWith('#/')) return undefined;
  return ref
    .slice(2)
    .split('/')
    .reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), openApiDocument);
};

const walk = (node, trail) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((entry, index) => walk(entry, `${trail}[${index}]`));
    return;
  }
  if (node.$ref) {
    if (typeof node.$ref !== 'string' || !resolveRef(node.$ref)) {
      problems.push(`${trail}: unresolved $ref "${node.$ref}"`);
    }
  }
  for (const [key, value] of Object.entries(node)) walk(value, `${trail}.${key}`);
};

if (openApiDocument.openapi !== '3.0.3') problems.push(`Unexpected OpenAPI version: ${openApiDocument.openapi}`);
if (!openApiDocument.info?.title || !openApiDocument.info?.version) problems.push('info.title and info.version are required');
if (!Array.isArray(openApiDocument.servers) || openApiDocument.servers.length === 0) problems.push('servers must not be empty');

const schemeNames = new Set(Object.keys(openApiDocument.components?.securitySchemes || {}));
const checkSecurity = (requirement, trail) => {
  for (const name of Object.keys(requirement)) {
    if (!schemeNames.has(name)) problems.push(`${trail}: unknown security scheme "${name}"`);
  }
};

if (Array.isArray(openApiDocument.security)) {
  openApiDocument.security.forEach((requirement, index) =>
    checkSecurity(requirement, `security[${index}]`)
  );
}

const operations = [];
const paths = openApiDocument.paths || {};
for (const [path, pathItem] of Object.entries(paths)) {
  if (!path.startsWith('/')) problems.push(`Path "${path}" must start with "/"`);
  let operationsInPath = 0;
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!HTTP_METHODS.includes(method)) continue;
    operationsInPath += 1;
    const trail = `${method.toUpperCase()} ${path}`;
    operations.push(trail);

    if (!operation.summary) problems.push(`${trail}: missing summary`);
    if (!Array.isArray(operation.tags) || operation.tags.length === 0) problems.push(`${trail}: missing tags`);
    if (!operation.responses || Object.keys(operation.responses).length === 0) {
      problems.push(`${trail}: missing responses`);
    }

    const declaredTags = new Set((openApiDocument.tags || []).map((tag) => tag.name));
    (operation.tags || []).forEach((tag) => {
      if (!declaredTags.has(tag)) problems.push(`${trail}: undeclared tag "${tag}"`);
    });

    if (Array.isArray(operation.security)) {
      operation.security.forEach((requirement, index) =>
        checkSecurity(requirement, `${trail}.security[${index}]`)
      );
    }

    const parameters = [...(pathItem.parameters || []), ...(operation.parameters || [])];
    const pathParams = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
    for (const name of pathParams) {
      const declared = parameters.some((parameter) => parameter?.name === name && parameter?.in === 'path');
      if (!declared) problems.push(`${trail}: missing declaration for path parameter "${name}"`);
    }
  }
  if (operationsInPath === 0) problems.push(`Path "${path}" has no operations`);
}

walk(openApiDocument, 'document');

const schemaCount = Object.keys(openApiDocument.components?.schemas || {}).length;
const describedOperations = new Set(operations).size;

console.log(`OpenAPI ${openApiDocument.openapi}: ${Object.keys(paths).length} paths, ${describedOperations} operations, ${schemaCount} schemas.`);

if (problems.length > 0) {
  console.error(`Found ${problems.length} problem(s):`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}

console.log('OpenAPI document is valid.');
