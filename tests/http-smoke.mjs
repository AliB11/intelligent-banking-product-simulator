// Run against a disposable database/server: SMOKE_BASE_URL=http://127.0.0.1:3000 npm run test:smoke
import assert from 'node:assert/strict';
const base = process.env.SMOKE_BASE_URL;
if (!base) throw new Error('Set SMOKE_BASE_URL to a running test server (uses and deletes one test product).');
const request = async (path, method = 'GET', body) => {
  const response = await fetch(new URL(path, base), {method, headers: {'Content-Type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  return {status: response.status, data: await response.json()};
};
assert.equal((await request('/api/health')).status, 200);
assert.equal((await request('/api/products')).status, 200);
for (const path of ['/api/products', '/api/simulate', '/api/analyze']) {
  assert.equal((await request(path, 'POST', null)).status, 400);
  assert.equal((await request(path, 'POST', {})).status, 400);
}
assert.equal((await request('/api/products/nope')).status, 400);
const created = await request('/api/products', 'POST', {config: {name:'SMOKE TEST — disposable'}});
assert.equal(created.status, 201);
const id = created.data.id;
try {
  assert.equal((await request(`/api/products/${id}`)).status, 200);
  assert.equal((await request(`/api/products/${id}`, 'PUT', {productId:id})).status, 400);
  const params = {customers:500, runs:1, horizon:12};
  const simulation = await request('/api/simulate', 'POST', {productId:id, params});
  assert.equal(simulation.status, 200);
  assert.ok(Number.isFinite(simulation.data.sim.kpis.netProfit));
  let products = (await request('/api/products')).data.items;
  assert.ok(products.find(p=>p.id === id).latest);
  assert.equal((await request(`/api/products/${id}`, 'PUT', {config:{name:'SMOKE TEST — edited'}})).status, 200);
  products = (await request('/api/products')).data.items;
  assert.equal(products.find(p=>p.id === id).latest, null, 'edited configs must not present old results as current');
  for (const mode of ['stress','sensitivity','optimize']) {
    const analysis = await request('/api/analyze','POST',{productId:id,params,mode});
    assert.equal(analysis.status,200,mode);
  }
  for (const path of ['/', '/studio', '/persona', '/compare', '/knowledge', `/products/${id}`, `/studio/${id}`]) {
    const r = await fetch(new URL(path,base));
    assert.equal(r.status,200,path);
    assert.ok((await r.text()).includes('سیمرغ'),path);
  }
} finally {
  assert.equal((await request(`/api/products/${id}`, 'DELETE')).status,200);
}
assert.equal((await request(`/api/products/${id}`)).status,404);
console.log('PASS: health, invalid input, CRUD, simulation, all analyses, stale-result invalidation, seven pages and deletion');
