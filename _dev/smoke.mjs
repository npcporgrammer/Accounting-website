/* 开发自测：用最小 DOM 桩在 Node 里执行 app.js，检查渲染与账目计算
   用法：node _dev/smoke.mjs
   可选：DUMP=1 导出各视图 HTML 到 _dev/out/；DEBUG=1 打印分类分布与账户余额 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const code = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); };

/* ---------- DOM 桩 ---------- */
function makeEl(sel = '') {
  const el = {
    sel, tagName: 'DIV', _html: '', textContent: '', value: '', checked: false,
    disabled: false, hidden: false, type: '', min: 0, max: 0, dataset: {}, style: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { c.parent = this; this.children.push(c); return c; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); },
    get firstElementChild() { return this.children[0]; },
    focus() {}, select() {}, setSelectionRange() {}, click() {},
    querySelector(s) { return makeEl(s); },
    querySelectorAll() { return []; },
    closest() { return null; },
    getAttribute() { return null; }, setAttribute() {},
  };
  Object.defineProperty(el, 'innerHTML', { get() { return this._html; }, set(v) { this._html = v; } });
  return el;
}

const cache = new Map();
const doc = {
  documentElement: makeEl('html'),
  body: makeEl('body'),
  addEventListener() {},
  querySelector(s) { if (!cache.has(s)) cache.set(s, makeEl(s)); return cache.get(s); },
  querySelectorAll() { return []; },
  getElementById(id) { return this.querySelector('#' + id); },
  createElement(tag) { const e = makeEl(tag); e.tagName = String(tag).toUpperCase(); return e; },
};

const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};

class BlobStub { constructor(parts) { this.size = parts.join('').length; } }
const URLStub = { createObjectURL: () => 'blob:stub', revokeObjectURL() {} };

const ctx = vm.createContext({
  console, setTimeout, clearTimeout, structuredClone,
  Blob: BlobStub, URL: URLStub,
  AbortController, AbortSignal,
  navigator: { clipboard: { writeText: async () => {} } },
  fetch: async () => { throw new Error('network disabled in test'); },
  document: doc,
  window: { matchMedia: () => ({ matches: false }), scrollTo() {}, addEventListener() {} },
  localStorage,
});

vm.runInContext(code + `
;globalThis.__api = {
  get state(){ return state; },
  set state(v){ state = v; },
  ui, VIEWS, render, load, save, normalize,
  monthTotals, catTotals, accountBalance, budgetRows, dayTotals, sumKind,
  runRecurring, advanceDate, buildSummary, localInsights, mdToHtml,
  seedDemo, exportCsv, exportJson, addReport, debtTotals, confirmPending,
  today, curMonth, addMonths, daysInMonth, uid, catById, accById, bookOf, txLabel,
  starterState, defaultCatsFor, ruleText, openTxnModal, commitTxn, monthText, signedYuan,
  openBudgetModal, openAccountModal, openBookModal, openCatModal, openDebtModal, openRecurringModal,
  closeModal, settleDebt, unsettleDebt, exportJson,
  cleanStr, aiCfg, chatUrl, aiRequest, probeHost, statusHint, failureHint, normalizeStoredAI,
  setFetch(f) { fetch = f; }
};
`, ctx, { filename: 'app.js' });

const api = ctx.__api;

/* ---------- 1. 初始化 ---------- */
ok(api.state && api.state.books.length === 2, '初始化应有 2 个示例账本');
ok(api.state.txns.length > 50, '示例流水应大于 50 笔，实际 ' + api.state.txns.length);
ok(api.state.accounts.length === 5, '示例账户应为 5 个');
ok(api.state.budgets.length === 7, '示例预算应为 7 条');

/* ---------- 2. 各视图渲染 ---------- */
const bId = 'bk_main';
api.ui.bookId = bId;
api.ui.month = api.curMonth();
for (const [name, fn] of Object.entries(api.VIEWS)) {
  let out = '';
  try { out = fn(); } catch (e) { failures.push(`视图 ${name} 渲染抛错: ${e.message}`); continue; }
  ok(typeof out === 'string' && out.length > 300, `视图 ${name} 输出过短（${out.length}）`);
  ok(!/undefined|NaN/.test(out.replace(/undefined 日/g, '')), `视图 ${name} 含 undefined/NaN`);
  if (process.env.DUMP) {
    const dir = path.join(here, 'out');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name + '.html'), out, 'utf8');
  }
}

/* ---------- 3. 账目一致性 ---------- */
const t = api.monthTotals(bId, api.curMonth());
const expenseSum = api.state.txns
  .filter(x => x.bookId === bId && x.kind === 'expense' && x.date.slice(0, 7) === api.curMonth())
  .reduce((a, x) => a + x.amount, 0);
ok(Math.abs(t.expense - expenseSum) < 0.01, `本月支出聚合不一致 ${t.expense} vs ${expenseSum}`);

const cats = api.catTotals(bId, api.curMonth(), 'expense');
const catSum = cats.reduce((a, c) => a + c.amount, 0);
ok(Math.abs(catSum - t.expense) < 0.01, `分类合计应与支出合计一致 ${catSum} vs ${t.expense}`);
const shareSum = cats.reduce((a, c) => a + c.share, 0);
ok(Math.abs(shareSum - 1) < 0.001, `分类占比合计应为 1，实际 ${shareSum}`);

for (const acc of api.state.accounts) {
  let calc = acc.initialBalance;
  for (const x of api.state.txns) {
    if (x.bookId !== acc.bookId) continue;
    if (x.kind === 'transfer') {
      if (x.accountId === acc.id) calc -= x.amount;
      if (x.toAccountId === acc.id) calc += x.amount;
    } else if (x.accountId === acc.id) {
      calc += x.kind === 'income' ? x.amount : -x.amount;
    }
  }
  const got = api.accountBalance(acc);
  ok(Math.abs(calc - got) < 0.01, `账户 ${acc.name} 余额不符 ${calc} vs ${got}`);
}

const bud = api.budgetRows(bId, api.curMonth());
ok(bud.total && bud.total.amount === 12000, '总预算应为 12000');
ok(Math.abs(bud.total.used - t.expense) < 0.01, '总预算已用应等于本月支出');
ok(Math.abs(bud.total.usage - t.expense / 12000) < 0.001, '总预算使用率不对');
for (const c of bud.cats) {
  ok(c.amount > 0, `分类预算 ${c.name} 金额异常`);
  ok(c.remaining === Math.round((c.amount - c.used) * 100) / 100, `分类预算 ${c.name} 剩余金额不对`);
}

/* ---------- 4. 周期账单 ---------- */
const pendingCount = api.state.pending.length;
ok(pendingCount >= 1, '示例数据应产生至少 1 条待入账');
api.runRecurring();
ok(api.state.pending.length === pendingCount, '重复运行不应重复生成待入账');
api.advanceDate('2026-01-31', { freq: 'monthly', day: 31 });
ok(api.advanceDate('2026-01-15', { freq: 'monthly', day: 15 }) === '2026-02-15', '月度周期推进错误');
ok(api.advanceDate('2026-01-15', { freq: 'weekly', day: 1 }) === '2026-01-22', '周周期推进错误');
ok(api.advanceDate('2026-01-15', { freq: 'daily' }) === '2026-01-16', '日周期推进错误');

/* 确认待入账 */
const p = api.state.pending[0];
const before = api.state.txns.length;
api.confirmPending(p.id);
ok(api.state.txns.length === before + 1, '确认待入账应新增一笔流水');
ok(api.state.pending.length === pendingCount - 1, '确认后待入账应减少');

/* ---------- 5. AI 摘要与本地分析 ---------- */
const tAfter = api.monthTotals(bId, api.curMonth());
let summary, insights, md;
try {
  summary = api.buildSummary();
  insights = api.localInsights(summary);
  md = api.mdToHtml(insights);
} catch (e) { failures.push('AI 摘要/本地分析抛错: ' + e.message); }
ok(summary && Math.abs(summary.支出 - tAfter.expense) < 0.01, 'AI 摘要支出金额应与统计一致');
ok(summary.分类支出.length > 0 && summary.分类支出[0].占比 > 0, 'AI 摘要分类数据缺失');
ok(typeof insights === 'string' && insights.includes('### 一句话结论'), '本地分析缺少结论段');
ok(typeof md === 'string' && md.includes('<h3>') && md.includes('<li>'), 'Markdown 渲染失败');

/* ---------- 6. 新增流水后联动 ---------- */
const cash = api.state.accounts.find(a => a.id === 'ac_cash');
const balBefore = api.accountBalance(cash);
const beforeAdd = api.monthTotals(bId, api.curMonth()).expense;
api.state.txns.push({
  id: 'tx_test', createdAt: Date.now(), bookId: 'bk_main', kind: 'expense',
  categoryId: api.state.categories.find(c => c.bookId === 'bk_main' && c.name === '餐饮').id,
  accountId: 'ac_cash', amount: 12.34, date: api.curMonth() + '-01', note: '测试',
});
ok(Math.abs(api.accountBalance(cash) - (balBefore - 12.34)) < 0.01, '新增流水后余额未联动');
const t2 = api.monthTotals(bId, api.curMonth());
ok(Math.abs(t2.expense - (beforeAdd + 12.34)) < 0.01, '新增流水后月度统计未联动');
api.state.txns = api.state.txns.filter(x => x.id !== 'tx_test');

/* ---------- 7. 导出 ---------- */
try { api.exportCsv(); } catch (e) { failures.push('CSV 导出抛错: ' + e.message); }
try { api.exportJson(); } catch (e) { failures.push('JSON 导出抛错: ' + e.message); }

/* ---------- 8. 图标引用完整性 ---------- */
const symbolIds = new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map(m => m[1]));
const used = new Set([...code.matchAll(/#(i-[a-z-]+)/g)].map(m => m[1]));
for (const id of used) ok(symbolIds.has(id), `缺少图标 symbol: ${id}`);

/* ---------- 9. 弹窗模板 ---------- */
const modals = [
  ['记一笔', () => api.openTxnModal(null)],
  ['编辑流水', () => api.openTxnModal(api.state.txns[0])],
  ['预算', () => api.openBudgetModal(null)],
  ['账户', () => api.openAccountModal(null)],
  ['账本', () => api.openBookModal(null)],
  ['分类', () => api.openCatModal(null, 'expense')],
  ['借贷', () => api.openDebtModal(null)],
  ['周期账单', () => api.openRecurringModal(null)],
];
for (const [name, fn] of modals) {
  try { fn(); api.closeModal(); } catch (e) { failures.push(`弹窗「${name}」抛错: ${e.message}`); }
}

/* ---------- 10. 借贷结清联动 ---------- */
{
  const d = api.state.debts.find(x => !x.settled && x.direction === 'out');
  if (!d) failures.push('示例数据缺少应收借贷');
  else {
    const acc = api.state.accounts.find(a => a.id === d.accountId);
    const before = api.accountBalance(acc);
    await api.settleDebt(d.id, true);
    ok(d.settled === true, '结清后状态应为已结清');
    ok(Math.abs(api.accountBalance(acc) - (before + d.amount)) < 0.01, '收回借款后余额应增加');
    ok(api.state.txns.some(t => t.debtId === d.id && t.debtFlow === 'settle'), '结清应生成一笔转账流水');
    api.unsettleDebt(d.id);
    ok(d.settled === false, '撤销结清后状态应还原');
    ok(Math.abs(api.accountBalance(acc) - before) < 0.01, '撤销结清后余额应还原');
    ok(!api.state.txns.some(t => t.debtId === d.id && t.debtFlow === 'settle'), '撤销结清应删除关联流水');
  }
}

/* ---------- 11. AI 接口请求（本地 mock） ---------- */
{
  ok(api.cleanStr('  "https://a.com/v1"  ') === 'https://a.com/v1', 'cleanStr 应去掉引号与空白');
  ok(api.chatUrl('https://api.deepseek.com/v1') === 'https://api.deepseek.com/v1/chat/completions', 'chatUrl 拼接错误');
  ok(api.chatUrl('https://api.deepseek.com/v1/') === 'https://api.deepseek.com/v1/chat/completions', 'chatUrl 未去尾斜杠');
  ok(api.chatUrl('https://api.deepseek.com/v1/chat/completions') === 'https://api.deepseek.com/v1/chat/completions', 'chatUrl 不应重复拼接');
  ok(api.chatUrl('"https://api.deepseek.com/v1"') === 'https://api.deepseek.com/v1/chat/completions', 'chatUrl 应清洗引号');

  const http = await import('node:http');
  let lastAuth = '', lastBody = null, lastPath = '';
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      lastPath = req.url;
      lastAuth = req.headers.authorization || '';
      try { lastBody = JSON.parse(body); } catch { lastBody = null; }
      if (req.url !== '/v1/chat/completions') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{"error":{"message":"no such route"}}');
        return;
      }
      if (lastAuth !== 'Bearer sk-test') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end('{"error":{"message":"Authentication Fails, Your api key is invalid"}}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: 'deepseek-chat', choices: [{ message: { content: 'ok' } }] }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/v1`;
  api.setFetch(globalThis.fetch);

  const bad = await api.aiRequest([{ role: 'user', content: 'hi' }], 16, 5000, { baseUrl: base, apiKey: 'sk-wrong', model: 'deepseek-chat' });
  ok(bad.ok === false && bad.status === 401, '401 应判定为失败并带回状态码');
  ok(/Authentication Fails/.test(bad.text || ''), '401 应保留服务器原始响应');

  const good = await api.aiRequest([{ role: 'user', content: 'hi' }], 16, 5000, { baseUrl: base + '/', apiKey: 'sk-test', model: 'deepseek-chat' });
  ok(good.ok === true && good.status === 200, '200 应判定为成功');
  ok(good.data && good.data.choices[0].message.content === 'ok', '应能解析 choices[0].message.content');
  ok(lastPath === '/v1/chat/completions', '请求路径应为 /v1/chat/completions，实际 ' + lastPath);
  ok(good.url === base + '/chat/completions', '返回的 url 应可复现');
  ok(lastBody && lastBody.model === 'deepseek-chat' && Array.isArray(lastBody.messages), '请求体应含 model 与 messages');
  ok(lastBody && lastBody.stream === false, '请求应为非流式');

  const notFound = await api.aiRequest([{ role: 'user', content: 'hi' }], 16, 5000, { baseUrl: `http://127.0.0.1:${port}/nope`, apiKey: 'sk-test', model: 'x' });
  ok(notFound.ok === false && notFound.status === 404, '404 应判定为失败');

  server.close();

  const down = await api.aiRequest([{ role: 'user', content: 'hi' }], 16, 1500, { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'sk-test', model: 'x' });
  ok(down.ok === false && down.status === 0 && down.error, '连接失败应返回 status 0 与错误信息');

  /* 网页控制台地址应被自动纠正 */
  const savedBase = api.state.settings.ai.baseUrl;
  api.state.settings.ai.baseUrl = 'https://platform.deepseek.com';
  ok(api.normalizeStoredAI() === true && api.state.settings.ai.baseUrl === 'https://api.deepseek.com/v1', 'platform.deepseek.com 应被纠正为 API 地址');
  api.state.settings.ai.baseUrl = 'https://api.deepseek.com/v1';
  ok(api.normalizeStoredAI() === false, '正确地址不应被改动');
  api.state.settings.ai.baseUrl = savedBase;

  /* 返回 HTML 时应给出"地址不是接口"的提示 */
  const htmlHint = api.failureHint({ status: 429, text: '<!DOCTYPE html><html><head><title>Error</title>' });
  ok(/HTML|网页/.test(htmlHint) && /api\.deepseek\.com/.test(htmlHint), 'HTML 响应应提示地址填错');
}

/* ---------- 输出 ---------- */
if (process.env.DEBUG) {
  const m = api.curMonth();
  const rows = api.state.txns.filter(x => x.bookId === 'bk_main' && x.kind === 'expense' && x.date.slice(0, 7) === m);
  const dist = new Map();
  for (const x of rows) { const c = api.catById(x.categoryId); const k = c ? c.name : '?'; dist.set(k, (dist.get(k) || 0) + 1); }
  console.log('分类笔数:', [...dist.entries()].map(([k, v]) => `${k}:${v}`).join(' '));
  console.log('账户余额:', api.state.accounts.map(a => `${a.name}=${api.accountBalance(a)}`).join(' '));
}
if (failures.length) {
  console.log('FAIL ' + failures.length);
  failures.forEach(f => console.log(' - ' + f));
  process.exitCode = 1;
} else {
  console.log('ALL PASS');
  console.log(`txns=${api.state.txns.length} pending=${api.state.pending.length} 本月支出=${t.expense} 预算使用率=${(bud.total.usage * 100).toFixed(1)}%`);
}
