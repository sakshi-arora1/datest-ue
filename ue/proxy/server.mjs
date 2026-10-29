/*
 * Universal Editor service proxy for Adaptive Forms stored as inline JSON in DA.
 *
 * Requests that target a form field resource (connection "fj", resources `urn:fj:...`)
 * are handled here: the form JSON in the form block's <pre><code> is read from DA,
 * modified, and written back. Every other request is forwarded unchanged to the
 * Adobe Universal Editor service.
 *
 * Run: node ue/proxy/server.mjs   (PORT, UE_UPSTREAM, DA_ADMIN, DEBUG=1 optional)
 */
import http from 'node:http';
// eslint-disable-next-line import/extensions
import { handleFormRequest, isFormRequest } from './form-handler.mjs';

const PORT = Number(process.env.PORT || 8899);
const UPSTREAM = process.env.UE_UPSTREAM || 'https://universal-editor-service.adobe.io';
const DEBUG = process.env.DEBUG === '1';

const CORS_HEADERS = {
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-allow-private-network': 'true',
  'access-control-max-age': '600',
};

// UE calls the service with credentials, so the origin must be echoed (no wildcard).
function corsHeaders(req) {
  return {
    ...CORS_HEADERS,
    'access-control-allow-origin': req.headers.origin || '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': req.headers['access-control-request-headers'] || '*',
    vary: 'Origin',
  };
}

const HOP_HEADERS = ['host', 'connection', 'content-length', 'accept-encoding', 'origin', 'referer'];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(req, res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', ...headers, ...corsHeaders(req) });
  res.end(payload);
}

function log(...args) {
  // eslint-disable-next-line no-console
  console.log(new Date().toISOString(), ...args);
}

// The "fj" connection and its urn:fj: resources only exist for this proxy; never send them
// upstream (e.g. publish/unpublish reference lists). Form fields are published with the page.
function stripFormConnection(json) {
  const strip = (v) => {
    if (Array.isArray(v)) {
      return v.filter((x) => !(typeof x === 'string' && x.startsWith('urn:fj:'))
        && !(x && x.name === 'fj')).map(strip);
    }
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, strip(val)]));
    }
    return v;
  };
  return strip(json);
}

async function forward(req, res, rawBody, json) {
  const headers = {};
  Object.entries(req.headers).forEach(([k, v]) => {
    if (!HOP_HEADERS.includes(k) && !k.startsWith('x-fj-')) headers[k] = v;
  });
  let body;
  if (!['GET', 'HEAD'].includes(req.method)) {
    body = json ? JSON.stringify(stripFormConnection(json)) : rawBody;
  }
  const upstream = await fetch(`${UPSTREAM}${req.url}`, { method: req.method, headers, body });
  const text = await upstream.text();
  if (DEBUG) log('<- upstream', upstream.status, req.url, text.slice(0, 400));
  const outHeaders = {};
  upstream.headers.forEach((v, k) => {
    if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)
      && !k.startsWith('access-control-')) outHeaders[k] = v;
  });
  send(req, res, upstream.status, text, outHeaders);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }
  try {
    const rawBody = await readBody(req);
    let json;
    try {
      json = rawBody.length ? JSON.parse(rawBody.toString()) : undefined;
    } catch {
      json = undefined;
    }
    log('->', req.method, req.url, DEBUG && json ? JSON.stringify(json).slice(0, 800) : '');

    if (json && isFormRequest(json)) {
      const result = await handleFormRequest(req.url, json, req.headers);
      log('<- form', req.url, result.status, JSON.stringify(result.body).slice(0, 300));
      send(req, res, result.status, result.body);
      return;
    }
    // configuration for the fj connection alone: nothing to ask upstream for
    if (json && Array.isArray(json.connections) && json.connections.length
      && stripFormConnection(json).connections.length === 0) {
      send(req, res, 200, { capabilities: {} });
      return;
    }
    await forward(req, res, rawBody, json);
  } catch (e) {
    log('!! error', req.url, e.stack || e.message);
    send(req, res, e.status || 500, { error: e.message });
  }
});

server.listen(PORT, () => log(`UE form proxy listening on :${PORT} -> ${UPSTREAM}`));
