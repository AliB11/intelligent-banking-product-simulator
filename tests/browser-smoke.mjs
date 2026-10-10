// Disposable server/database: SMOKE_BASE_URL=http://127.0.0.1:3000 npm run test:browser
// Install Chromium with `npx playwright install --with-deps chromium`, or provide BROWSER_EXECUTABLE_PATH.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const base = process.env.SMOKE_BASE_URL;
if (!base) throw new Error('Set SMOKE_BASE_URL to a disposable test server; this creates and cleans up its own products.');
const api = async (path, method = 'GET', body) => {
  const r = await fetch(new URL(path, base), { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const j = await r.json();
  assert.ok(r.ok, `${method} ${path}: ${r.status} ${j.error ?? ''}`);
  return j;
};
const ids = [];
const errors = [];
const audits = [];
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
  args: process.env.BROWSER_LAUNCH_ARGS ? JSON.parse(process.env.BROWSER_LAUNCH_ARGS) : ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
let expectedNetworkFailure = false;
page.on('pageerror', e => errors.push({ type: 'pageerror', message: e.message, url: page.url() }));
page.on('console', m => {
  if (['error', 'warning'].includes(m.type()) && !(expectedNetworkFailure && m.text().includes('Failed to load resource'))) errors.push({ type: m.type(), message: m.text(), url: page.url() });
});
const layout = async (label) => {
  const size = await page.evaluate(() => ({ width: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(size.html <= size.width + 1 && size.body <= size.width + 1, `${label}: viewport overflow ${JSON.stringify(size)}`);
};
const accessibility = async (label) => {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const result = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
  const violations = result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }));
  audits.push({ page: label, violations });
  const serious = violations.filter(v => ['critical', 'serious'].includes(v.impact));
  assert.equal(serious.length, 0, `${label}: accessibility violations ${JSON.stringify(serious)}`);
};
const visit = async (path) => {
  const response = await page.goto(new URL(path, base).href, { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200, path);
  await page.locator('h1').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  if (path === '/compare') await page.getByRole('heading', { name: /جدول شاخص‌ها/ }).waitFor();
  if (path.startsWith('/studio/') || path.includes('template=')) await page.getByText('به‌روز', { exact: true }).waitFor();
  await layout(path);
  await accessibility(path);
};

try {
  const template = await api('/api/alm', 'POST', { templateKey: 'negin_farapuya', marketShare: 1, horizon: 12 });
  const product = await api('/api/products', 'POST', { config: { ...template.config, name: `BROWSER AUDIT — ${Date.now()}` } });
  ids.push(product.id);
  await api('/api/simulate', 'POST', { productId: product.id, params: { customers: 500, runs: 1, horizon: 12, seed: 73 } });
  await api('/api/alm', 'POST', { productId: product.id, save: true, marketShare: 1, horizon: 24 });
  const paths = ['/', '/studio', '/studio?template=negin_farapuya', '/persona', '/compare', '/knowledge', `/products/${product.id}`, `/studio/${product.id}`];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const path of paths) await visit(path);
  }

  // Numeric drafts are editable, but empty/out-of-range values never become financial model inputs.
  await page.goto(new URL('/studio?template=negin_farapuya', base).href, { waitUntil: 'networkidle' });
  await page.getByText('به‌روز', { exact: true }).waitFor();
  await page.getByRole('button', { name: /قیمت‌گذاری$/, exact: false }).click();
  const fee = page.getByRole('spinbutton', { name: 'کارمزد تشکیل پرونده (یکجا)', exact: true });
  const original = await fee.inputValue();
  await fee.fill(''); await fee.blur();
  assert.equal(await fee.inputValue(), original, 'blank draft restores the previous finite value');
  await fee.fill('-99'); await fee.blur(); assert.equal(await fee.inputValue(), '0');
  await fee.fill('999'); await fee.blur(); assert.equal(await fee.inputValue(), '6');
  await fee.fill(original); await fee.blur();
  await page.getByRole('button', { name: /موتور امتیاز/ }).click();
  const alpha = page.getByRole('spinbutton', { name: /ضریب α/ }).first();
  const previousAlpha = await alpha.inputValue();
  await alpha.fill('500'); await alpha.blur();
  assert.ok((await page.locator('tbody tr').first().locator('td').nth(9).textContent()).includes('۴۰۰'), 'loan preview respects the 400M individual cap');
  await alpha.fill('9999'); await alpha.blur(); assert.equal(await alpha.inputValue(), '1000');
  await alpha.fill(previousAlpha); await alpha.blur();
  await accessibility('mobile numeric + editable tier menu');
  await layout('mobile editable tier menu');

  // Create/save from the real Studio, not just API fixtures.
  await page.getByRole('button', { name: /هویت و بازار/ }).click();
  const uiName = `BROWSER UI SAVE — ${Date.now()}`;
  await page.getByRole('textbox', { name: 'نام محصول', exact: true }).fill(uiName);
  const createdResponse = page.waitForResponse(r => r.url().endsWith('/api/products') && r.request().method() === 'POST');
  await page.getByRole('button', { name: /ذخیره و ورود به آزمایشگاه/ }).click();
  const created = await (await createdResponse).json(); ids.push(created.id);
  await page.waitForURL(`**/products/${created.id}`);
  await page.getByRole('heading', { name: uiName, exact: true }).waitFor();
  await page.getByRole('button', { name: /اجرای شبیه‌سازی/, exact: false }).waitFor({ state: 'visible' });

  // ALM run provenance, stale controls, drafts surviving tab switches and persisted restoration.
  await page.goto(new URL(`/products/${product.id}`, base).href, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /آزمایشگاه ALM/ }).click();
  const seed = page.getByRole('spinbutton', { name: 'بذر تصادفی', exact: true });
  const hole = page.getByRole('spinbutton', { name: 'سقف حفره', exact: true });
  await seed.fill('73'); await seed.blur();
  await hole.fill('7'); await hole.blur();
  const almResponse = page.waitForResponse(r => r.url().endsWith('/api/alm') && r.request().method() === 'POST');
  await page.getByRole('button', { name: /اجرا و ثبت در تاریخچه/ }).click();
  const full = await (await almResponse).json();
  assert.ok(full.simulationId);
  await page.getByRole('heading', { name: /جریان نقد ماهانه و کسری انباشته/ }).waitFor();
  await hole.fill('8'); await hole.blur();
  await page.getByText('پارامترها، قیود طراح یا پیکربندی محصول تغییر کرده‌اند؛ نتایج فعلی متعلق به اجرای قبلی هستند. دوباره اجرا کنید.').waitFor();
  const apply = page.getByRole('button', { name: /اعمال سهم‌های پیشنهادی/ });
  if (await apply.count()) assert.ok(await apply.isDisabled(), 'cannot apply a stale ALM design');
  await page.getByRole('button', { name: /داشبورد نتایج/ }).click();
  await page.getByRole('button', { name: /آزمایشگاه ALM/ }).click();
  assert.equal(await hole.inputValue(), '8', 'draft constraints survive tab switches');
  await page.getByText('پارامترها، قیود طراح یا پیکربندی محصول تغییر کرده‌اند؛ نتایج فعلی متعلق به اجرای قبلی هستند. دوباره اجرا کنید.').waitFor();
  await accessibility('mobile ALM results + stale constraints');
  await layout('mobile ALM');
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /آزمایشگاه ALM/ }).click();
  assert.equal(await seed.inputValue(), '73'); assert.equal(await hole.inputValue(), '7');
  await page.getByText(/نمایش آخرین اجرای ثبت‌شده/).waitFor();

  // A completed or in-flight stress analysis cannot survive changed global parameters.
  await page.getByRole('button', { name: /تست استرس$/, exact: false }).click();
  const stressResponse = page.waitForResponse(r => r.url().endsWith('/api/analyze'));
  await page.getByRole('button', { name: /اجرای تست استرس/ }).click();
  await stressResponse;
  await page.locator('table').first().waitFor();
  const market = page.getByRole('spinbutton', { name: 'نرخ مؤثر رقبا', exact: true });
  const marketValue = Number(await market.inputValue());
  await market.fill(String(marketValue + 1)); await market.blur();
  await page.getByText('برای اجرای تست استرس دکمه بالا را بزنید.').waitFor();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let resolveIntercepted;
  const intercepted = new Promise(resolve => { resolveIntercepted = resolve; });
  await page.route('**/api/analyze', async route => { resolveIntercepted(); await held; await route.continue(); });
  const delayedResponse = page.waitForResponse(r => r.url().endsWith('/api/analyze'));
  await page.getByRole('button', { name: /اجرای تست استرس/ }).click(); await intercepted;
  await market.fill(String(marketValue + 2)); await market.blur(); release();
  await delayedResponse;
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('اجرای تست استرس') && !b.disabled));
  await page.getByText('برای اجرای تست استرس دکمه بالا را بزنید.').waitFor();
  await page.unroute('**/api/analyze');

  // Undefined credit returns survive persistence and render as unavailable, not profitable zeroes.
  const emptyName = `BROWSER ZERO CAPITAL — ${Date.now()}`;
  const empty = await api('/api/products', 'POST', { config: { name: emptyName, risk: { maxAge: 18 } } });
  ids.push(empty.id);
  const noCredit = await api('/api/simulate', 'POST', { productId: empty.id, params: { customers: 500, runs: 1, horizon: 12 } });
  assert.equal(noCredit.sim.kpis.raroc, null);
  await page.goto(new URL(`/products/${empty.id}`, base).href, { waitUntil: 'networkidle' });
  await page.getByText('بدون سرمایه مبنای معتبر', { exact: true }).waitFor();
  const rarocCard = page.getByText('RAROC سالانه', { exact: true }).locator('../..');
  assert.equal(await rarocCard.locator('div.font-extrabold').textContent(), '—');
  await page.getByRole('button', { name: /بهینه‌ساز هوشمند$/, exact: false }).click();
  await page.getByRole('combobox', { name: 'هدف بهینه‌سازی', exact: true }).selectOption('raroc');
  const noDesignResponse = page.waitForResponse(r => r.url().endsWith('/api/analyze'));
  await page.getByRole('button', { name: /اجرای بهینه‌ساز/ }).click();
  const noDesign = await (await noDesignResponse).json();
  assert.equal(noDesign.best.feasible, false);
  await page.getByRole('heading', { name: /طراحی امکان‌پذیر پیدا نشد/ }).waitFor();
  assert.equal(await page.getByRole('heading', { name: /پیکربندی پیشنهادی/ }).count(), 0);
  await accessibility('mobile undefined credit ratios + infeasible optimizer');
  await layout('mobile undefined credit ratios');

  // Empty compare selection must hide old results and leave no canceled spinner behind.
  await page.goto(new URL('/compare', base).href, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: /جدول شاخص‌ها/ }).waitFor();
  const selected = page.locator('button[style*="background"]');
  while (await selected.count()) await selected.first().click();
  await page.getByText('یک یا چند محصول را از بالا انتخاب کنید.').waitFor();
  assert.equal(await page.getByRole('heading', { name: /جدول شاخص‌ها/ }).count(), 0);
  assert.equal(await page.getByText('محاسبه…', { exact: true }).count(), 0);
  await page.getByRole('button', { name: new RegExp(emptyName) }).click();
  await page.getByRole('button', { name: new RegExp(product.config.name) }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('tr')].some(r => r.firstElementChild?.textContent === 'RAROC' && r.children.length === 3));
  const rarocRow = page.locator('tr').filter({ has: page.getByText('RAROC', { exact: true }) });
  const unavailable = rarocRow.locator('td').nth(1);
  assert.equal(await unavailable.textContent(), '—');
  assert.ok(!(await unavailable.getAttribute('class')).includes('bg-emerald'), 'null RAROC is not a best performer');

  // Storage failure is visible, not swallowed, and offline templates remain usable.
  expectedNetworkFailure = true;
  await page.route('**/api/products', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline test"}' }));
  await page.goto(new URL('/persona', base).href, { waitUntil: 'networkidle' });
  await page.getByRole('alert').filter({ hasText: 'الگوها همچنان در دسترس' }).waitFor();
  assert.ok(await page.getByRole('combobox', { name: 'انتخاب محصول' }).isVisible());
  await page.unroute('**/api/products'); expectedNetworkFailure = false;

  // Invalid page identifiers must display Not Found even if Next streams an initial HTTP 200.
  for (const path of ['/products/2147483648', '/studio/nope']) {
    expectedNetworkFailure = true;
    await page.goto(new URL(path, base).href, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '404', exact: true }).waitFor();
    expectedNetworkFailure = false;
  }
  assert.deepEqual(errors, [], `browser console/runtime errors: ${JSON.stringify(errors)}`);
  console.log(JSON.stringify({ status: 'PASS', routes: paths.length, viewports: ['1440×1000', '390×844'], accessibilityScans: audits.length, audits, errors, interactions: ['numeric drafts/bounds', 'capped tier preview', 'Studio save', 'ALM stale/apply/draft/restore', 'stress async invalidation', 'compare cancellation', 'undefined credit ratios/persistence/comparison/infeasible optimizer', 'storage-error fallback', 'invalid page IDs'] }, null, 2));
} finally {
  await browser.close();
  for (const id of ids) await api(`/api/products/${id}`, 'DELETE');
}
