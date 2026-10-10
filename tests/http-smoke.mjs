// Disposable server/database only: SMOKE_BASE_URL=http://127.0.0.1:3000 npm run test:smoke
import assert from 'node:assert/strict';
const base = process.env.SMOKE_BASE_URL;
if (!base) throw new Error('Set SMOKE_BASE_URL to a test server; this creates and deletes its own test product.');
const origin = new URL(base).origin;
let checks = 0;
const statusIs = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };
const request = async (path, method = 'GET', body, headers = {}, raw = false) => {
  const response = await fetch(new URL(path, base), {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json(), response };
};
const health = await request('/api/health');
statusIs(health.status, 200, 'database health');
assert.equal(health.data.ok, true);
assert.equal(health.response.headers.get('x-content-type-options'), 'nosniff');
assert.equal(health.response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
assert.equal(health.response.headers.get('cache-control'), 'no-store');
assert.equal(health.response.headers.get('x-powered-by'), null);
statusIs((await request('/api/products')).status, 200);
for (const path of ['/api/products', '/api/simulate', '/api/analyze', '/api/alm']) {
  for (const body of [null, {}, []]) statusIs((await request(path, 'POST', body)).status, 400, `${path}: invalid body`);
  statusIs((await request(path, 'POST', {}, { 'Content-Type': 'text/plain' })).status, 415, `${path}: JSON required`);
  statusIs((await request(path, 'POST', {}, { Origin: 'https://evil.example' })).status, 403, `${path}: CSRF`);
  statusIs((await request(path, 'POST', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403, `${path}: fetch metadata`);
  statusIs((await request(path, 'POST', '{', {}, true)).status, 400, `${path}: malformed JSON`);
}
statusIs((await request('/api/products/nope')).status, 400);
statusIs((await request('/api/products/2147483648')).status, 400);
statusIs((await request('/api/products', 'POST', { config: { description: 'ب'.repeat(40000) } })).status, 413, '64KB UTF-8 limit');
statusIs((await request('/api/simulate', 'POST', { config: {}, productId: 1 })).status, 400, 'ambiguous source');
statusIs((await request('/api/analyze', 'POST', { config: {}, mode: 'unknown' })).status, 400, 'unknown analysis mode');
statusIs((await request('/api/alm', 'POST', { templateKey: 'negin_farapuya', config: {} })).status, 400, 'ALM ambiguous source');
statusIs((await request('/api/alm', 'POST', { templateKey: 'negin_farapuya', save: 'yes' })).status, 400, 'ALM boolean save');
statusIs((await request('/api/alm', 'POST', { templateKey: 'negin_farapuya', save: true })).status, 400, 'ALM persistence needs a stored product');
statusIs((await request('/api/alm', 'POST', { templateKey: 'missing' })).status, 404);
statusIs((await request('/api/alm', 'POST', { config: { kind: 'points_loan', contract: 'qard', points: { mode: 'tiered_murabaha', tiers: [{ rate: 23 }] } } })).status, 400, 'ALM incompatible contract');
const emptyCredit = await request('/api/simulate', 'POST', {
  config: { risk: { maxAge: 18 } }, params: { customers: 500, runs: 1, horizon: 12 },
});
statusIs(emptyCredit.status, 200, 'no credit/capital basis');
assert.equal(emptyCredit.data.sim.kpis.booked, 0);
for (const key of ['raroc', 'rarocCredit', 'rarocLiquidity', 'roa', 'nim']) {
  assert.equal(emptyCredit.data.sim.kpis[key], null, `${key}: undefined, not an extreme epsilon return`);
}
assert.ok(emptyCredit.data.insights.some(i => i.id === 'undefined_raroc'));
const created = await request('/api/products', 'POST', {
  config: { name: `SMOKE TEST — ${Date.now()}`, kind: 'points_loan', family: 'points', contract: 'qard', purpose: 'cash' },
}, { Origin: origin });
statusIs(created.status, 201);
const id = created.data.id;
let version = created.data.configVersion;
try {
  assert.equal(version, 1);
  statusIs((await request(`/api/products/${id}`)).status, 200);
  statusIs((await request(`/api/products/${id}`, 'PUT', { productId: id })).status, 400);
  statusIs((await request(`/api/products/${id}`, 'PUT', { config: {}, configVersion: 0 })).status, 400);
  statusIs((await request(`/api/products/${id}`, 'DELETE', undefined, { Origin: 'https://evil.example' })).status, 403);
  const params = { customers: 500, runs: 1, horizon: 12, seed: 73 };
  const simulation = await request('/api/simulate', 'POST', { productId: id, params }, { Origin: origin });
  statusIs(simulation.status, 200);
  assert.ok(Number.isFinite(simulation.data.sim.kpis.netProfit));
  assert.equal(simulation.data.configVersion, version);
  assert.equal(simulation.data.sim.params.seed, 73);
  let products = (await request('/api/products')).data.items;
  assert.ok(products.find(p => p.id === id).latest);
  const edited = await request(`/api/products/${id}`, 'PUT', { config: { ...created.data.config, name: `${created.data.config.name} edited` }, configVersion: version });
  statusIs(edited.status, 200);
  assert.equal(edited.data.configVersion, version + 1);
  statusIs((await request(`/api/products/${id}`, 'PUT', { config: created.data.config, configVersion: version })).status, 409, 'stale editor cannot overwrite');
  version = edited.data.configVersion;
  products = (await request('/api/products')).data.items;
  assert.equal(products.find(p => p.id === id).latest, null, 'edits invalidate old metrics');
  for (const mode of ['stress', 'sensitivity', 'optimize']) {
    const analysis = await request('/api/analyze', 'POST', { productId: id, params, mode });
    statusIs(analysis.status, 200, mode);
    assert.equal(analysis.data.configVersion, version);
  }
  const alm = await request('/api/alm', 'POST', {
    productId: id, save: true, horizon: 24, marketShare: 1, seed: 73,
    designer: { objective: 'liquidity', maxHolePct: 7, minMarginPct: -5, maxLeverage: 3 },
  });
  statusIs(alm.status, 200, 'persisted ALM');
  assert.ok(alm.data.simulationId > 0);
  assert.equal(alm.data.configVersion, version);
  assert.equal(alm.data.params.seed, 73);
  assert.equal(alm.data.params.designer.maxHolePct, 7);
  assert.ok(Number.isFinite(alm.data.alm.kpis.maxHole));
  const product = (await request(`/api/products/${id}`)).data;
  assert.equal(product.history.length, 5, 'MC plus all four analyses retained');
  assert.ok(product.history.every(h => h.summary.engineVersion && h.summary.configVersion));
  const almHistory = product.history.find(h => h.type === 'alm').summary;
  assert.equal(almHistory.seed, 73);
  assert.equal(almHistory.designer.maxHolePct, 7);
  for (const path of ['/', '/studio', '/studio?template=negin_farapuya', '/persona', '/compare', '/knowledge', `/products/${id}`, `/studio/${id}`]) {
    const r = await fetch(new URL(path, base));
    statusIs(r.status, 200, path);
    assert.ok((await r.text()).includes('سیمرغ'), path);
  }
} finally {
  statusIs((await request(`/api/products/${id}`, 'DELETE', undefined, { Origin: origin })).status, 200);
}
statusIs((await request(`/api/products/${id}`)).status, 404);
console.log(`PASS: ${checks} HTTP assertions — headers, invalid input, CSRF, CRUD/revisions, MC, all four analyses/ALM provenance, eight page routes, cleanup.`);
