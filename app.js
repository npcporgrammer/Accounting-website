/* ============================================================
   账页 · 记账工作台
   纯原生 JS，无框架、无依赖、无网络请求（AI 分析除外，且由你主动触发）
   ============================================================ */
'use strict';

/* ============================================================
   0. 常量与工具
   ============================================================ */

const STORAGE_KEY = 'jizhang-ledger-v1';
const PALETTE = ['#2FA36B', '#3E8ED0', '#E08A2E', '#E2574C', '#7A6BD0', '#2C9E9A', '#C9A227', '#8C5E9E', '#B08968', '#6E7B8B'];
const ACC_TYPES = { cash: '现金', wechat: '微信', alipay: '支付宝', bank: '储蓄卡', credit: '信用卡', other: '其他' };
const INCOME_COLOR = '#178A52';

/* 分类固定配色：一眼能认出是什么类别 */
const CAT_COLOR = {
  餐饮: '#E08A2E', 交通: '#3E8ED0', 购物: '#E2574C', 住房: '#7A6BD0', 居家: '#2C9E9A',
  娱乐: '#C9A227', 医疗: '#8C5E9E', 人情: '#B08968', 订阅: '#6E7B8B', 学习: '#2FA36B',
  其他: '#8C8273', 工资: '#178A52', 兼职: '#3E8ED0', 红包: '#E08A2E', 投资收益: '#2FA36B',
  报销: '#2C9E9A', 住宿: '#2C9E9A', 门票: '#B08968',
};
const catColor = name => CAT_COLOR[name] || PALETTE[0];
const OLD_PALETTE = ['#2F3E5C', '#5A6B85', '#8A6D4E', '#5E7A6B', '#7C6472', '#4E6E7E', '#8C7A52', '#6B5560', '#5F6F5B', '#7A6A66', '#6E7A8A', '#3F6B55'];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = v => num(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const yuan = v => '¥' + money(v);
const signedYuan = v => (num(v) < 0 ? '−¥' : '¥') + money(Math.abs(num(v)));
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, (d || 1), 12); };
const today = () => ymd(new Date());
const curMonth = () => today().slice(0, 7);
const monthText = m => `${m.slice(0, 4)}年${Number(m.slice(5, 7))}月`;
const shortMonth = m => `${Number(m.slice(5, 7))}月`;
const addMonths = (m, n) => { const [y, mm] = m.split('-').map(Number); const d = new Date(y, mm - 1 + n, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
const addDays = (iso, n) => { const d = parseYmd(iso); d.setDate(d.getDate() + n); return ymd(d); };
const daysInMonth = m => { const [y, mm] = m.split('-').map(Number); return new Date(y, mm, 0).getDate(); };
const round2 = v => Math.round(num(v) * 100) / 100;
const pctText = r => (r * 100).toFixed(Math.abs(r * 100) >= 99.95 ? 0 : 1) + '%';
const clamp01 = v => Math.max(0, Math.min(1, v));
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
const WEEK_ORDER = ['一', '二', '三', '四', '五', '六', '日'];

function dateLabel(iso) {
  const t = today();
  if (iso === t) return '今天';
  if (iso === addDays(t, -1)) return '昨天';
  if (iso === addDays(t, -2)) return '前天';
  const d = parseYmd(iso);
  const sameYear = d.getFullYear() === Number(t.slice(0, 4));
  return `${sameYear ? '' : d.getFullYear() + '年'}${d.getMonth() + 1}月${d.getDate()}日 周${WEEK_CN[d.getDay()]}`;
}

function lcg(seed) {
  /* mulberry32：分布比线性同余均匀，示例数据不会扎堆 */
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function download(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* ============================================================
   1. 状态
   ============================================================ */

let state = null;
const ui = {
  view: 'dashboard',
  month: curMonth(),
  bookId: null,
  tx: { kind: 'all', cat: '', acc: '', q: '', shown: 300 },
  statsKind: 'expense',
  aiBusy: false,
  aiTestBusy: false,
  lastTxnDraft: null,
};

const DEFAULT_SETTINGS = {
  theme: 'light',
  font: 'song',
  ai: { baseUrl: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat', temperature: 0.4, sendDetail: false },
  seeded: false,
  createdAt: null,
};

function blankState() {
  return {
    version: 1,
    settings: structuredClone(DEFAULT_SETTINGS),
    books: [],
    accounts: [],
    categories: [],
    txns: [],
    budgets: [],
    recurring: [],
    pending: [],
    debts: [],
    aiReports: [],
    lastAccountByCat: {},
  };
}

function normalize(raw) {
  const s = Object.assign(blankState(), raw || {});
  s.settings = Object.assign(structuredClone(DEFAULT_SETTINGS), s.settings || {});
  s.settings.ai = Object.assign(structuredClone(DEFAULT_SETTINGS.ai), (raw && raw.settings && raw.settings.ai) || {});
  for (const k of ['books', 'accounts', 'categories', 'txns', 'budgets', 'recurring', 'pending', 'debts', 'aiReports']) {
    if (!Array.isArray(s[k])) s[k] = [];
  }
  if (!s.lastAccountByCat || typeof s.lastAccountByCat !== 'object') s.lastAccountByCat = {};
  s.txns = s.txns.filter(t => t && t.date && Number.isFinite(Number(t.amount))).map(t => ({
    ...t,
    amount: round2(t.amount),
    kind: t.kind === 'income' ? 'income' : t.kind === 'transfer' ? 'transfer' : 'expense',
  }));
  return s;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    toast('保存失败：浏览器存储空间可能已满', 'error');
    console.error(err);
  }
}

function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { raw = null; }
  if (raw && raw.version) {
    state = normalize(raw);
  } else {
    state = seedDemo();
    save();
  }
  if (!state.books.some(b => b.id === ui.bookId)) ui.bookId = state.books[0] ? state.books[0].id : null;
}

/* ---------- 查询 ---------- */
const bookOf = id => state.books.find(b => b.id === id) || null;
const accById = id => state.accounts.find(a => a.id === id) || null;
const catById = id => state.categories.find(c => c.id === id) || null;
const bookAccounts = (bookId, includeArchived = false) => state.accounts.filter(a => a.bookId === bookId && (includeArchived || !a.archived));
const bookCats = (bookId, kind) => state.categories.filter(c => c.bookId === bookId && (!kind || c.kind === kind) && !c.archived);

function txnsOf(bookId, month) {
  return state.txns
    .filter(t => t.bookId === bookId && (!month || t.date.slice(0, 7) === month))
    .sort((a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1));
}

function sumKind(bookId, month, kind) {
  let s = 0;
  for (const t of state.txns) {
    if (t.bookId !== bookId || t.kind !== kind) continue;
    if (month && t.date.slice(0, 7) !== month) continue;
    s += t.amount;
  }
  return round2(s);
}

function monthTotals(bookId, month) {
  const expense = sumKind(bookId, month, 'expense');
  const income = sumKind(bookId, month, 'income');
  return { expense, income, net: round2(income - expense) };
}

function catTotals(bookId, month, kind) {
  const map = new Map();
  for (const t of state.txns) {
    if (t.bookId !== bookId || t.kind !== kind) continue;
    if (month && t.date.slice(0, 7) !== month) continue;
    const key = t.categoryId || '_none';
    map.set(key, round2((map.get(key) || 0) + t.amount));
  }
  const total = [...map.values()].reduce((a, b) => a + b, 0);
  return [...map.entries()]
    .map(([categoryId, amount]) => {
      const c = catById(categoryId);
      return {
        categoryId,
        name: c ? c.name : '未分类',
        color: c ? c.color : 'var(--ink-3)',
        amount,
        share: total ? amount / total : 0,
      };
    })
    .sort((a, b) => b.amount - a.amount);
}

function dayTotals(bookId, month) {
  const map = new Map();
  for (const t of state.txns) {
    if (t.bookId !== bookId || t.kind !== 'expense' || t.date.slice(0, 7) !== month) continue;
    map.set(t.date, round2((map.get(t.date) || 0) + t.amount));
  }
  return map;
}

function accountBalance(acc) {
  let b = num(acc.initialBalance);
  for (const t of state.txns) {
    if (t.bookId !== acc.bookId) continue;
    if (t.kind === 'transfer') {
      if (t.accountId === acc.id) b -= t.amount;
      if (t.toAccountId === acc.id) b += t.amount;
    } else if (t.accountId === acc.id) {
      b += t.kind === 'income' ? t.amount : -t.amount;
    }
  }
  return round2(b);
}

function accountFlows(acc, month) {
  let inflow = 0, outflow = 0;
  for (const t of state.txns) {
    if (t.bookId !== acc.bookId || t.date.slice(0, 7) !== month) continue;
    if (t.kind === 'transfer') {
      if (t.accountId === acc.id) outflow += t.amount;
      if (t.toAccountId === acc.id) inflow += t.amount;
    } else if (t.accountId === acc.id) {
      if (t.kind === 'income') inflow += t.amount; else outflow += t.amount;
    }
  }
  return { inflow: round2(inflow), outflow: round2(outflow) };
}

function budgetRows(bookId, month) {
  const rowsRaw = state.budgets.filter(b => b.bookId === bookId && (b.month === month || b.month === 'ALL'));
  const picked = new Map();
  for (const b of rowsRaw) {
    const key = b.categoryId || '';
    const prev = picked.get(key);
    if (!prev || (b.month === month && prev.month !== month)) picked.set(key, b);
  }
  const catMap = new Map(catTotals(bookId, month, 'expense').map(c => [c.categoryId, c.amount]));
  const totalExpense = sumKind(bookId, month, 'expense');
  const rows = [...picked.values()].map(b => {
    const cat = b.categoryId ? catById(b.categoryId) : null;
    const used = b.categoryId ? (catMap.get(b.categoryId) || 0) : totalExpense;
    return {
      ...b,
      name: cat ? cat.name : '已删除分类',
      color: cat ? cat.color : 'var(--ink-3)',
      used,
      remaining: round2(b.amount - used),
      usage: b.amount > 0 ? used / b.amount : 0,
    };
  });
  const total = rows.find(r => !r.categoryId) || null;
  const cats = rows.filter(r => r.categoryId).sort((a, b) => b.amount - a.amount);
  return { total, cats, totalExpense };
}

function archivedOrAll() { return false; }

/* 旧版灰调配色 → 新版彩色分类，一次性迁移（只跑一次） */
function migratePalette() {
  if (!state || !state.settings || state.settings.paletteV2) return false;
  let changed = 0;
  for (const c of state.categories) {
    if (!c) continue;
    if (!OLD_PALETTE.includes(String(c.color || '').toUpperCase())) continue;
    c.color = catColor(c.name);
    changed++;
  }
  state.settings.paletteV2 = true;
  return changed > 0;
}

/* ============================================================
   2. 示例数据
   ============================================================ */

function seedDemo() {
  const s = blankState();
  s.settings.seeded = true;
  s.settings.demo = true;
  s.settings.createdAt = new Date().toISOString();
  const rnd = lcg(20261113);
  const between = (a, b) => Math.round((a + rnd() * (b - a)) * 10) / 10;
  const pick = arr => arr[Math.floor(rnd() * arr.length)];

  const mainBook = { id: 'bk_main', name: '日常', color: '#2FA36B' };
  const tripBook = { id: 'bk_trip', name: '旅行', color: '#E08A2E' };
  s.books = [mainBook, tripBook];

  s.accounts = [
    { id: 'ac_wx', bookId: 'bk_main', name: '微信零钱', type: 'wechat', initialBalance: 4200, archived: false },
    { id: 'ac_ali', bookId: 'bk_main', name: '支付宝', type: 'alipay', initialBalance: 3600, archived: false },
    { id: 'ac_cmb', bookId: 'bk_main', name: '招商银行', type: 'bank', initialBalance: 25000, archived: false },
    { id: 'ac_cash', bookId: 'bk_main', name: '现金', type: 'cash', initialBalance: 1200, archived: false },
    { id: 'ac_trip', bookId: 'bk_trip', name: '旅行基金', type: 'bank', initialBalance: 6000, archived: false },
  ];

  const mainCats = [
    ['餐饮', 'expense'], ['交通', 'expense'], ['购物', 'expense'], ['住房', 'expense'],
    ['居家', 'expense'], ['娱乐', 'expense'], ['医疗', 'expense'], ['人情', 'expense'],
    ['订阅', 'expense'], ['学习', 'expense'], ['其他', 'expense'],
    ['工资', 'income'], ['兼职', 'income'], ['红包', 'income'], ['投资收益', 'income'], ['报销', 'income'],
  ];
  const tripCats = [
    ['交通', 'expense'], ['住宿', 'expense'], ['餐饮', 'expense'],
    ['门票', 'expense'], ['购物', 'expense'], ['其他', 'expense'],
  ];
  mainCats.forEach(([name, kind], i) => s.categories.push({ id: 'ct_m' + i, bookId: 'bk_main', name, kind, color: catColor(name), archived: false }));
  tripCats.forEach(([name, kind], i) => s.categories.push({ id: 'ct_t' + i, bookId: 'bk_trip', name, kind, color: catColor(name), archived: false }));

  const catId = (bookId, name) => (s.categories.find(c => c.bookId === bookId && c.name === name) || {}).id;

  const NOTES = {
    餐饮: ['午餐', '晚饭', '咖啡', '外卖', '早餐', '楼下小馆', '周末聚餐', '奶茶'],
    交通: ['地铁', '打车', '公交', '共享单车', '高铁票'],
    购物: ['日用品', '超市采购', 'T恤', '耳机', '护肤品', '快递'],
    住房: ['房租'],
    居家: ['水电费', '清洁用品', '小家具'],
    娱乐: ['电影票', '游戏', '演出', '桌游'],
    医疗: ['感冒药', '体检', '牙科'],
    人情: ['随礼', '请客', '生日礼物'],
    订阅: ['视频会员', '云存储', '音乐会员', '软件订阅'],
    学习: ['书', '课程', '文具'],
    其他: ['杂项支出', '其他'],
  };
  const AMOUNTS = { 餐饮: [12, 78], 交通: [4, 52], 购物: [25, 380], 住房: [4200, 4200], 居家: [30, 260], 娱乐: [25, 190], 医疗: [18, 320], 人情: [80, 500], 订阅: [15, 38], 学习: [18, 180], 其他: [10, 90] };
  const catPool = ['餐饮', '餐饮', '餐饮', '餐饮', '交通', '交通', '购物', '购物', '居家', '娱乐', '医疗', '人情', '订阅', '学习', '其他'];
  const accountPool = ['ac_wx', 'ac_ali', 'ac_cmb', 'ac_wx', 'ac_ali', 'ac_cmb', 'ac_cmb', 'ac_cash'];

  const m0 = curMonth();
  let seq = 0;
  const push = (t) => s.txns.push({ id: 'tx_seed' + (++seq), createdAt: Date.now() + seq, ...t });

  for (let off = -2; off <= 0; off++) {
    const m = addMonths(m0, off);
    const dim = daysInMonth(m);
    const maxDay = off === 0 ? Math.max(1, Number(today().slice(8, 10))) : dim;
    const day = n => `${m}-${pad2(n)}`;

    push({ bookId: 'bk_main', kind: 'income', categoryId: catId('bk_main', '工资'), accountId: 'ac_cmb', amount: 18600 + (off === 0 ? 0 : between(-200, 600)), date: day(10), note: '月度工资' });
    if (maxDay >= 5) push({ bookId: 'bk_main', kind: 'expense', categoryId: catId('bk_main', '住房'), accountId: 'ac_cmb', amount: 4200, date: day(5), note: '房租' });
    if (maxDay >= 18) push({ bookId: 'bk_main', kind: 'expense', categoryId: catId('bk_main', '订阅'), accountId: 'ac_wx', amount: 25, date: day(18), note: '视频会员' });
    if (maxDay >= 22) push({ bookId: 'bk_main', kind: 'expense', categoryId: catId('bk_main', '居家'), accountId: 'ac_ali', amount: between(120, 260), date: day(22), note: '水电费' });
    if (maxDay >= 12 && off !== -1) push({ bookId: 'bk_main', kind: 'income', categoryId: catId('bk_main', '兼职'), accountId: 'ac_ali', amount: between(800, 2600), date: day(12), note: '外包尾款' });

    for (let d = 1; d <= maxDay; d++) {
      const times = 1 + (rnd() < 0.55 ? 1 : 0) + (rnd() < 0.12 ? 1 : 0);
      for (let k = 0; k < times; k++) {
        const catName = pick(catPool);
        const [lo, hi] = AMOUNTS[catName];
        push({
          bookId: 'bk_main', kind: 'expense',
          categoryId: catId('bk_main', catName),
          accountId: pick(accountPool),
          amount: between(lo, hi),
          date: day(d),
          note: pick(NOTES[catName]),
        });
      }
      if (rnd() < 0.10) {
        push({
          bookId: 'bk_main', kind: 'income',
          categoryId: catId('bk_main', pick(['红包', '报销'])),
          accountId: pick(['ac_wx', 'ac_ali']),
          amount: between(18, 320),
          date: day(d),
          note: pick(['群里红包', '打车报销', '餐补']),
        });
      }
    }
  }

  // 旅行账本：上个月一次出行
  const tripMonth = addMonths(m0, -1);
  const tday = n => `${tripMonth}-${pad2(Math.min(n, daysInMonth(tripMonth)))}`;
  [
    ['交通', 2460, '往返机票', 'ac_trip'],
    ['住宿', 1580, '民宿三晚', 'ac_trip'],
    ['门票', 280, '景区门票', 'ac_trip'],
    ['餐饮', 168, '当地小吃', 'ac_trip'],
    ['购物', 320, '伴手礼', 'ac_trip'],
  ].forEach(([name, amount, note, accountId], i) => {
    push({ bookId: 'bk_trip', kind: 'expense', categoryId: catId('bk_trip', name), accountId, amount, date: tday(12 + i), note });
  });
  push({ bookId: 'bk_trip', kind: 'income', categoryId: catId('bk_trip', '其他'), accountId: 'ac_trip', amount: 2000, date: `${tripMonth}-02`, note: '旅行预算转入' });

  s.budgets = [
    { id: uid('bd'), bookId: 'bk_main', month: 'ALL', categoryId: '', amount: 12000 },
    { id: uid('bd'), bookId: 'bk_main', month: 'ALL', categoryId: catId('bk_main', '住房'), amount: 4200 },
    { id: uid('bd'), bookId: 'bk_main', month: 'ALL', categoryId: catId('bk_main', '餐饮'), amount: 2400 },
    { id: uid('bd'), bookId: 'bk_main', month: 'ALL', categoryId: catId('bk_main', '交通'), amount: 700 },
    { id: uid('bd'), bookId: 'bk_main', month: 'ALL', categoryId: catId('bk_main', '购物'), amount: 1500 },
    { id: uid('bd'), bookId: 'bk_main', month: 'ALL', categoryId: catId('bk_main', '订阅'), amount: 200 },
    { id: uid('bd'), bookId: 'bk_main', month: 'ALL', categoryId: catId('bk_main', '娱乐'), amount: 600 },
  ];

  s.recurring = [
    { id: 'rc_1', bookId: 'bk_main', name: '房租', kind: 'expense', amount: 4200, categoryId: catId('bk_main', '住房'), accountId: 'ac_cmb', rule: { freq: 'monthly', day: 5 }, nextDate: `${addMonths(m0, 1)}-05`, auto: true, active: true },
    { id: 'rc_2', bookId: 'bk_main', name: '视频会员', kind: 'expense', amount: 25, categoryId: catId('bk_main', '订阅'), accountId: 'ac_wx', rule: { freq: 'monthly', day: 18 }, nextDate: addDays(today(), -2), auto: false, active: true },
    { id: 'rc_3', bookId: 'bk_main', name: '宽带费', kind: 'expense', amount: 120, categoryId: catId('bk_main', '居家'), accountId: 'ac_ali', rule: { freq: 'monthly', day: 20 }, nextDate: `${addMonths(m0, 1)}-20`, auto: false, active: true },
  ];

  const debtDate = addDays(today(), -26);
  s.debts = [
    { id: 'db_1', bookId: 'bk_main', direction: 'out', person: '张伟', amount: 1200, date: debtDate, dueDate: addDays(today(), 20), note: '聚餐我先垫的，说好月底还', settled: false, accountId: 'ac_wx' },
    { id: 'db_2', bookId: 'bk_main', direction: 'in', person: '李雷', amount: 500, date: addDays(today(), -9), dueDate: addDays(today(), 30), note: '借来买耳机，下月发工资还', settled: false, accountId: 'ac_ali' },
  ];
  s.txns.push({ id: 'tx_seed_debt1', createdAt: Date.now() - 5000, bookId: 'bk_main', kind: 'transfer', categoryId: '', accountId: 'ac_wx', amount: 1200, date: debtDate, note: '借出给张伟', debtId: 'db_1' });
  s.txns.push({ id: 'tx_seed_debt2', createdAt: Date.now() - 4000, bookId: 'bk_main', kind: 'transfer', categoryId: '', toAccountId: 'ac_ali', amount: 500, date: addDays(today(), -9), note: '向李雷借入', debtId: 'db_2' });

  s.txns.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return s;
}

/* ============================================================
   3. 视图框架
   ============================================================ */

function effectiveTheme() {
  const t = state.settings.theme || 'light';
  if (t === 'auto') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return t;
}

function render() {
  if (!state) return;
  document.documentElement.dataset.theme = effectiveTheme();
  document.documentElement.dataset.font = state.settings.font || 'song';
  const iconUse = $('#themeBtn use');
  if (iconUse) iconUse.setAttribute('href', effectiveTheme() === 'dark' ? '#i-sun' : '#i-moon');

  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === ui.view));

  const ml = $('#monthLabel');
  if (ml) ml.textContent = monthText(ui.month);

  const sel = $('#bookSelect');
  if (sel) {
    const opts = state.books.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    if (sel.dataset.opts !== opts) { sel.innerHTML = opts; sel.dataset.opts = opts; }
    if (ui.bookId) sel.value = ui.bookId;
  }

  const noMonth = ['accounts', 'debts', 'ai', 'settings'].includes(ui.view);
  $('#topbar').classList.toggle('hide-month', noMonth);

  const idx = Math.max(0, VIEW_ORDER.indexOf(ui.view));
  const pageNo = $('#pageNo');
  if (pageNo) pageNo.textContent = String(idx + 1).padStart(2, '0');
  const pageName = $('#pageName');
  if (pageName) pageName.textContent = VIEW_NAMES[ui.view] || '';
  const prevV = VIEW_ORDER[(idx - 1 + VIEW_ORDER.length) % VIEW_ORDER.length];
  const nextV = VIEW_ORDER[(idx + 1) % VIEW_ORDER.length];
  const fp = $('#flipPrev .flip-name');
  if (fp) fp.textContent = VIEW_NAMES[prevV] || '';
  const fn = $('#flipNext .flip-name');
  if (fn) fn.textContent = VIEW_NAMES[nextV] || '';

  const view = $('#view');
  const renderer = VIEWS[ui.view] || VIEWS.dashboard;
  view.innerHTML = renderer();
}

const VIEWS = {
  dashboard: renderDashboard,
  txns: renderTxns,
  stats: renderStats,
  budget: renderBudget,
  accounts: renderAccounts,
  debts: renderDebts,
  ai: renderAI,
  settings: renderSettings,
};

/* 书本的页序：顶部便条贴直达，底部箭头前后翻 */
const VIEW_ORDER = ['dashboard', 'txns', 'stats', 'budget', 'accounts', 'debts', 'ai', 'settings'];
const VIEW_NAMES = {
  dashboard: '仪表盘', txns: '明细', stats: '统计', budget: '预算与周期',
  accounts: '账户', debts: '应收应付', ai: 'AI 分析', settings: '设置',
};

function flip(dir) {
  const i = VIEW_ORDER.indexOf(ui.view);
  const next = VIEW_ORDER[(i + dir + VIEW_ORDER.length) % VIEW_ORDER.length];
  goto(next, dir);
}

function goto(view, dir) {
  ui.view = view;
  render();
  const page = $('#page');
  if (page) page.scrollTop = 0;
  const v = $('#view');
  if (v && dir) {
    v.classList.remove('turn-next', 'turn-prev');
    void v.offsetWidth;
    v.classList.add(dir > 0 ? 'turn-next' : 'turn-prev');
    setTimeout(() => v.classList.remove('turn-next', 'turn-prev'), 300);
  }
}

/* ---------- 小组件 ---------- */
function deltaEl(cur, prev, goodWhenUp = false) {
  if (!prev) return '<span class="delta flat">暂无对比</span>';
  const r = (cur - prev) / Math.abs(prev);
  if (Math.abs(r) < 0.0005) return '<span class="delta flat">持平</span>';
  const up = r > 0;
  const cls = goodWhenUp ? (up ? 'good-up' : 'good-down') : (up ? 'up' : 'down');
  return `<span class="delta ${cls}">${up ? '▲' : '▼'} ${pctText(Math.abs(r))}</span>`;
}

function emptyState(text, action) {
  const icon = action && action.icon ? action.icon : 'i-list';
  return `<div class="empty"><svg class="icon"><use href="#${icon}"/></svg><p>${text}</p>${action ? `<button class="btn" data-act="${action.act}" data-id="${esc(action.id || '')}">${esc(action.label)}</button>` : ''}</div>`;
}

function catDot(color) { return `<i class="cat-dot" style="background:${esc(color)}"></i>`; }

function txLabel(t) {
  if (t.kind !== 'transfer') {
    const c = catById(t.categoryId);
    return c ? c.name : '未分类';
  }
  if (t.debtId) {
    const d = state.debts.find(x => x.id === t.debtId);
    if (d) {
      if (d.direction === 'out') return t.toAccountId ? '收回借款' : '借出';
      return t.accountId ? '归还借款' : '借入';
    }
  }
  const from = accById(t.accountId), to = accById(t.toAccountId);
  if (from && to) return `${from.name} → ${to.name}`;
  if (from) return `${from.name} → 转出`;
  if (to) return `转入 → ${to.name}`;
  return '转账';
}

function txAccountName(t) {
  if (t.kind === 'transfer') {
    const from = accById(t.accountId), to = accById(t.toAccountId);
    if (from && to) return `${from.name} → ${to.name}`;
    if (from) return from.name;
    if (to) return to.name;
    return '—';
  }
  const a = accById(t.accountId);
  return a ? a.name : '—';
}

function txAmountHtml(t) {
  const cls = t.kind === 'income' ? 'income' : t.kind === 'transfer' ? 'transfer' : 'expense';
  const sign = t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : '';
  return `<td class="right amount ${cls}">${sign}${yuan(t.amount)}</td>`;
}

/* ============================================================
   4. 仪表盘
   ============================================================ */

function renderDashboard() {
  const bId = ui.bookId, m = ui.month;
  const t = monthTotals(bId, m);
  const prev = monthTotals(bId, addMonths(m, -1));
  const yoy = monthTotals(bId, addMonths(m, -12));
  const bud = budgetRows(bId, m);
  const book = bookOf(bId);
  const pending = state.pending.filter(p => p.bookId === bId);

  const budgetKpi = bud.total
    ? { value: bud.total.remaining, foot: `已用 ${pctText(bud.total.usage)} · 预算 ${yuan(bud.total.amount)}`, neg: bud.total.remaining < 0, goodUp: true, cur: bud.total.remaining < 0 ? -1 : 1 }
    : null;

  const kpis = `
    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-label">本月结余</div>
        <div class="kpi-value${t.net < 0 ? ' neg' : ''}">${t.net < 0 ? '−' : ''}<span class="cur">¥</span>${money(Math.abs(t.net))}</div>
        <div class="kpi-foot">${deltaEl(t.net, prev.net, true)}<span>环比</span></div>
      </div>
      <div class="kpi">
        <div class="kpi-label">本月支出</div>
        <div class="kpi-value"><span class="cur">¥</span>${money(t.expense)}</div>
        <div class="kpi-foot">${deltaEl(t.expense, prev.expense)}<span>环比</span><span class="sep"></span><span>同比</span>${deltaEl(t.expense, yoy.expense)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">本月收入</div>
        <div class="kpi-value"><span class="cur">¥</span>${money(t.income)}</div>
        <div class="kpi-foot">${deltaEl(t.income, prev.income, true)}<span>环比</span></div>
      </div>
      <div class="kpi">
        <div class="kpi-label">预算剩余</div>
        ${budgetKpi
          ? `<div class="kpi-value${budgetKpi.neg ? ' neg' : ''}">${budgetKpi.neg ? '−' : ''}<span class="cur">¥</span>${money(Math.abs(budgetKpi.value))}</div>
             <div class="kpi-foot">${budgetKpi.foot}</div>`
          : `<div class="kpi-value" style="font-size:18px;color:var(--ink-3);font-weight:500">未设置</div>
             <div class="kpi-foot"><button class="linkish" data-act="add-budget">设置本月预算 →</button></div>`}
      </div>
    </div>`;

  const pendingBanner = pending.length ? `
    <div class="banner">
      <svg class="icon"><use href="#i-alert"/></svg>
      <div><strong>${pending.length} 笔周期账单待入账</strong>
        <span style="color:var(--ink-3);margin-left:8px">${pending.slice(0, 3).map(p => `${esc(p.name)} ${yuan(p.amount)}`).join(' · ')}${pending.length > 3 ? ' 等' : ''}</span>
      </div>
      <button class="btn" data-act="pending-all" data-id="${bId}">全部入账</button>
    </div>` : '';

  const demoBanner = state.settings.demo ? `
    <div class="banner" style="border-color:var(--line);background:var(--surface);">
      <svg class="icon" style="color:var(--ink-3)"><use href="#i-book"/></svg>
      <div>当前是<strong>示例数据</strong>，方便先看效果。正式记账前可以一键清空。</div>
      <button class="btn" data-act="demo-clear">清空并开始记账</button>
      <button class="icon-btn" data-act="demo-dismiss" aria-label="忽略"><svg class="icon"><use href="#i-x"/></svg></button>
    </div>` : '';

  const recent = txnsOf(bId).slice(0, 8);

  return `
    <div class="page-head">
      <div>
        <h1 class="page-title">${esc(book ? book.name : '')} · ${monthText(m)}</h1>
        <p class="page-sub">共 ${state.txns.filter(x => x.bookId === bId && x.date.slice(0, 7) === m).length} 笔记录${t.income ? ` · 储蓄率 ${pctText(clamp01(t.net / t.income))}` : ''}</p>
      </div>
      <div class="page-actions">
        <button class="btn" data-act="add-txn"><svg class="icon"><use href="#i-plus"/></svg>记一笔</button>
        <button class="btn" data-act="tx-export-csv"><svg class="icon"><use href="#i-download"/></svg>导出 CSV</button>
      </div>
    </div>
    ${demoBanner}
    ${pendingBanner}
    ${kpis}
    <div class="grid grid-main">
      <div class="stack">
        ${dashboardRankCard(bId, m)}
        ${recentCard(recent, bId)}
      </div>
      <div class="stack">
        ${dashboardBudgetCard(bud, bId, m)}
        ${heatCard(bId, m)}
      </div>
    </div>`;
}

function dashboardRankCard(bId, m) {
  const all = catTotals(bId, m, 'expense');
  const rows = all.slice(0, 6);
  const total = all.reduce((a, b) => a + b.amount, 0);
  const prevMonth = addMonths(m, -1);
  const prevMap = new Map(catTotals(bId, prevMonth, 'expense').map(c => [c.categoryId, c.amount]));
  const body = rows.length
    ? `<div class="rank-list">${rows.map(r => {
      const prev = prevMap.get(r.categoryId) || 0;
      return `
        <div class="rank-row">
          <div class="rank-top">${catDot(r.color)}<span class="rank-name">${esc(r.name)}</span><span class="rank-share">${pctText(r.share)}</span></div>
          <div class="rank-amount">${yuan(r.amount)}</div>
          <div class="rank-bar"><i style="width:${Math.max(2, clamp01(r.share / (rows[0].share || 1)) * 100)}%;background:${esc(r.color)}"></i></div>
          <div class="rank-delta" style="grid-column:1/-1">${prev ? deltaEl(r.amount, prev) + '<span>较上月</span>' : '<span>上月无此分类</span>'}</div>
        </div>`;
    }).join('')}</div>`
    : emptyState('本月还没有支出记录', { act: 'add-txn', label: '记第一笔', icon: 'i-grid' });
  return `
    <div class="card">
      <div class="card-head">
        <div><div class="card-title">分类排行</div><div class="card-sub">本月支出 ${yuan(total)}</div></div>
        <div class="card-actions"><button class="btn sm plain" data-act="nav" data-view="stats">查看统计</button></div>
      </div>
      <div class="card-body">${body}</div>
    </div>`;
}

function dashboardBudgetCard(bud, bId, m) {
  const rows = bud.total ? [bud.total, ...bud.cats.slice(0, 3)] : bud.cats.slice(0, 4);
  const body = rows.length
    ? rows.map(r => `
      <div class="budget-item">
        <div class="top">
          <span class="name">${r.categoryId ? catDot(r.color) : ''}${esc(r.name)}</span>
          <span class="nums"><b>${money(r.used)}</b> / ${money(r.amount)}</span>
        </div>
        <div class="bar thin"><div class="bar-fill ${r.usage > 1 ? 'over' : r.usage > 0.85 ? 'warn' : ''}" style="width:${Math.min(100, r.usage * 100)}%"></div>
        </div>
        <div class="budget-foot"><span>${r.remaining < 0 ? `超支 ${yuan(-r.remaining)}` : `剩余 ${yuan(r.remaining)}`}</span><span>${pctText(r.usage)}</span></div>
      </div>`).join('')
    : emptyState('还没有设置预算', { act: 'add-budget', label: '设置预算', icon: 'i-target' });
  return `
    <div class="card">
      <div class="card-head">
        <div><div class="card-title">预算执行</div><div class="card-sub">${monthText(m)}</div></div>
        <div class="card-actions"><button class="btn sm plain" data-act="nav" data-view="budget">管理</button></div>
      </div>
      <div class="card-body">${body}</div>
    </div>`;
}

function recentCard(list, bId) {
  const body = list.length
    ? `<table class="table">
        <tbody>
        ${list.map(t => `
          <tr data-act="edit-txn" data-id="${t.id}" style="cursor:pointer">
            <td class="w-date hide-sm" style="width:78px">${esc(dateLabel(t.date).replace(/ \S+$/, ''))}</td>
            <td><div class="cat-cell">${catDot(t.kind === 'transfer' ? 'var(--ink-3)' : (catById(t.categoryId) || {}).color || 'var(--ink-3)')}<span>${esc(txLabel(t))}</span></div></td>
            <td class="note-cell muted hide-sm">${esc(t.note || '—')}</td>
            <td class="hide-sm muted" style="width:110px">${esc(txAccountName(t))}</td>
            <td class="right amount ${t.kind === 'income' ? 'income' : t.kind === 'transfer' ? 'transfer' : 'expense'}" style="width:130px">${t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : ''}${yuan(t.amount)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`
    : emptyState('还没有记录，记第一笔试试', { act: 'add-txn', label: '记一笔', icon: 'i-list' });
  return `
    <div class="card">
      <div class="card-head">
        <div><div class="card-title">最近流水</div><div class="card-sub">${esc(bookOf(bId) ? bookOf(bId).name : '')}</div></div>
        <div class="card-actions"><button class="btn sm plain" data-act="nav" data-view="txns">全部明细</button></div>
      </div>
      <div class="card-body flush">${body}</div>
    </div>`;
}

function heatCard(bId, m) {
  const days = dayTotals(bId, m);
  const dim = daysInMonth(m);
  const first = parseYmd(`${m}-01`);
  const offset = (first.getDay() + 6) % 7;
  const max = Math.max(1, ...[...days.values()]);
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<div class="heat-cell blank"></div>');
  const t = today();
  let sum = 0, activeDays = 0;
  for (let d = 1; d <= dim; d++) {
    const date = `${m}-${pad2(d)}`;
    const v = days.get(date) || 0;
    sum += v; if (v > 0) activeDays++;
    const lv = v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4));
    cells.push(`<div class="heat-cell ${lv ? 'lv-' + lv : ''} ${date === t ? 'today' : ''}" title="${d}日 ${v ? yuan(v) : '无支出'}">${d}</div>`);
  }
  const target = `${m}-${pad2(dim)}`;
  const future = target > t;
  return `
    <div class="card">
      <div class="card-head">
        <div><div class="card-title">每日支出</div><div class="card-sub">${monthText(m)} · 记账 ${activeDays} 天</div></div>
        <div class="card-actions"><span class="card-sub">日均 ${yuan(sum / (future ? Math.max(1, Number(t.slice(8, 10))) : dim))}</span></div>
      </div>
      <div class="card-body">
        <div class="heat-head">${WEEK_ORDER.map(w => `<span>${w}</span>`).join('')}</div>
        <div class="heat-grid">${cells.join('')}</div>
        <div class="heat-legend"><span>少</span><i class="lv-1"></i><i class="lv-2"></i><i class="lv-3"></i><i class="lv-4"></i><span>多</span></div>
      </div>
    </div>`;
}

/* ============================================================
   5. 明细
   ============================================================ */

function filteredTxns() {
  const f = ui.tx;
  return txnsOf(ui.bookId, ui.month).filter(t => {
    if (f.kind !== 'all' && t.kind !== f.kind) return false;
    if (f.cat && t.categoryId !== f.cat) return false;
    if (f.acc && t.accountId !== f.acc && t.toAccountId !== f.acc) return false;
    if (f.q) {
      const q = f.q.toLowerCase();
      const hay = `${t.note || ''} ${txLabel(t)} ${txAccountName(t)} ${t.amount}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderTxns() {
  const list = filteredTxns();
  const shown = list.slice(0, ui.tx.shown);
  const sums = list.reduce((acc, t) => {
    if (t.kind === 'expense') acc.expense += t.amount;
    else if (t.kind === 'income') acc.income += t.amount;
    return acc;
  }, { expense: 0, income: 0 });

  const cats = ui.tx.kind === 'transfer' ? [] : bookCats(ui.bookId, ui.tx.kind === 'all' ? null : ui.tx.kind);
  const accs = bookAccounts(ui.bookId);

  const groups = [];
  for (const t of shown) {
    const last = groups[groups.length - 1];
    if (last && last.date === t.date) last.items.push(t);
    else groups.push({ date: t.date, items: [t] });
  }

  const rowsHtml = groups.map(g => {
    const ds = g.items.reduce((a, t) => a + (t.kind === 'expense' ? t.amount : t.kind === 'income' ? -t.amount : 0), 0);
    return `
      <tr class="date-row"><td colspan="5">
        <span>${esc(dateLabel(g.date))}</span>
        <span class="day-sum">${ds >= 0 ? '支出 ' + yuan(ds) : '净入 ' + yuan(-ds)}</span>
      </td></tr>
      ${g.items.map(t => `
        <tr data-act="edit-txn" data-id="${t.id}" style="cursor:pointer">
          <td style="width:130px"><div class="cat-cell">${catDot(t.kind === 'transfer' ? 'var(--ink-3)' : (catById(t.categoryId) || {}).color || 'var(--ink-3)')}<span>${esc(txLabel(t))}</span></div></td>
          <td class="note-cell">${esc(t.note || '—')}${t.recurringId ? '<span class="tag">周期</span>' : ''}${t.debtId ? '<span class="tag">借贷</span>' : ''}${t.auto ? '<span class="tag brand">自动</span>' : ''}</td>
          <td class="muted hide-sm" style="width:150px">${esc(txAccountName(t))}</td>
          <td class="right amount ${t.kind === 'income' ? 'income' : t.kind === 'transfer' ? 'transfer' : 'expense'}" style="width:130px">${t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : ''}${yuan(t.amount)}</td>
          <td style="width:74px"><div class="row-actions">
            <button class="icon-btn" data-act="edit-txn" data-id="${t.id}" title="编辑"><svg class="icon"><use href="#i-pencil"/></svg></button>
            <button class="icon-btn danger" data-act="del-txn" data-id="${t.id}" title="删除"><svg class="icon"><use href="#i-trash"/></svg></button>
          </div></td>
        </tr>`).join('')}
    `;
  }).join('');

  return `
    <div class="page-head">
      <div>
        <h1 class="page-title">明细</h1>
        <p class="page-sub">${monthText(ui.month)} · ${list.length} 笔 · 支出 ${yuan(sums.expense)} · 收入 ${yuan(sums.income)}</p>
      </div>
      <div class="page-actions">
        <button class="btn" data-act="add-txn"><svg class="icon"><use href="#i-plus"/></svg>记一笔</button>
      </div>
    </div>

    <div class="filters" style="margin-bottom:14px">
      <div class="segmented">
        ${[['all', '全部'], ['expense', '支出'], ['income', '收入'], ['transfer', '转账']].map(([k, label]) =>
          `<button class="seg ${ui.tx.kind === k ? 'active' : ''}" data-act="tx-kind" data-id="${k}">${label}</button>`).join('')}
      </div>
      <select class="select-mini" data-change="tx-cat" ${ui.tx.kind === 'transfer' ? 'disabled' : ''}>
        <option value="">全部分类</option>
        ${cats.map(c => `<option value="${c.id}" ${ui.tx.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
      <select class="select-mini" data-change="tx-acc">
        <option value="">全部账户</option>
        ${accs.map(a => `<option value="${a.id}" ${ui.tx.acc === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
      </select>
      <div class="search">
        <svg class="icon"><use href="#i-search"/></svg>
        <input id="txSearch" type="search" placeholder="搜索备注 / 分类 / 金额" value="${esc(ui.tx.q)}">
      </div>
      ${(ui.tx.q || ui.tx.cat || ui.tx.acc || ui.tx.kind !== 'all') ? `<button class="btn sm plain" data-act="tx-reset">清除筛选</button>` : ''}
    </div>

    <div class="card">
      <div class="card-body flush">
        ${shown.length ? `<div class="table-wrap"><table class="table">
          <thead><tr>
            <th style="width:130px">分类</th><th>备注</th><th class="hide-sm" style="width:150px">账户</th><th class="right" style="width:130px">金额</th><th style="width:74px"></th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table></div>` : emptyState('没有符合条件的记录', { act: 'add-txn', label: '记一笔', icon: 'i-search' })}
      </div>
    </div>
    ${list.length > shown.length ? `<div style="text-align:center;margin-top:14px"><button class="btn" data-act="tx-more">加载更多（还有 ${list.length - shown.length} 条）</button></div>` : ''}
  `;
}

/* ============================================================
   6. 统计
   ============================================================ */

function daysElapsed(m) {
  const cm = curMonth();
  const dim = daysInMonth(m);
  if (m === cm) return Math.max(1, Number(today().slice(8, 10)));
  if (m < cm) return dim;
  return 1;
}

function renderStats() {
  const bId = ui.bookId, m = ui.month;
  const t = monthTotals(bId, m);
  const prev = monthTotals(bId, addMonths(m, -1));
  const yoy = monthTotals(bId, addMonths(m, -12));
  const elapsed = daysElapsed(m);
  const kind = ui.statsKind;

  const rank = catTotals(bId, m, kind);
  const prevMap = new Map(catTotals(bId, addMonths(m, -1), kind).map(c => [c.categoryId, c.amount]));
  const yoyMap = new Map(catTotals(bId, addMonths(m, -12), kind).map(c => [c.categoryId, c.amount]));
  const rankTotal = rank.reduce((a, b) => a + b.amount, 0);

  const rankBody = rank.length ? `<div class="rank-list">${rank.map(r => {
    const p = prevMap.get(r.categoryId) || 0;
    const y = yoyMap.get(r.categoryId) || 0;
    return `
      <div class="rank-row">
        <div class="rank-top">${catDot(r.color)}<span class="rank-name">${esc(r.name)}</span><span class="rank-share">${pctText(r.share)}</span></div>
        <div class="rank-amount">${yuan(r.amount)}</div>
        <div class="rank-bar"><i style="width:${Math.max(2, clamp01(r.share / (rank[0].share || 1)) * 100)}%;background:${esc(r.color)}"></i></div>
        <div class="rank-delta" style="grid-column:1/-1">
          <span>环比 ${deltaEl(r.amount, p)}</span>
          <span>同比 ${deltaEl(r.amount, y)}</span>
        </div>
      </div>`;
  }).join('')}</div>` : emptyState(kind === 'expense' ? '本月还没有支出' : '本月还没有收入', { act: 'add-txn', label: '记一笔', icon: 'i-chart' });

  const compareRows = [
    ['支出', t.expense, prev.expense, yoy.expense, false],
    ['收入', t.income, prev.income, yoy.income, true],
    ['结余', t.net, prev.net, yoy.net, true],
  ];

  const months = [];
  for (let i = 5; i >= 0; i--) months.push(addMonths(m, -i));
  const monthVals = months.map(mm => sumKind(bId, mm, 'expense'));
  const maxV = Math.max(1, ...monthVals);

  return `
    <div class="page-head">
      <div>
        <h1 class="page-title">统计</h1>
        <p class="page-sub">${monthText(m)} · 已过 ${elapsed} 天，日均支出 ${yuan(t.expense / elapsed)}</p>
      </div>
      <div class="page-actions">
        <div class="segmented">
          <button class="seg ${kind === 'expense' ? 'active' : ''}" data-act="stats-kind" data-id="expense">支出</button>
          <button class="seg ${kind === 'income' ? 'active' : ''}" data-act="stats-kind" data-id="income">收入</button>
        </div>
      </div>
    </div>

    <div class="stat-strip" style="margin-bottom:14px">
      <div class="stat-cell"><div class="label">本月支出</div><div class="value">${yuan(t.expense)}</div></div>
      <div class="stat-cell"><div class="label">本月收入</div><div class="value">${yuan(t.income)}</div></div>
      <div class="stat-cell"><div class="label">本月结余</div><div class="value" style="color:${t.net < 0 ? 'var(--red)' : 'var(--ink)'}">${signedYuan(t.net)}</div></div>
      <div class="stat-cell"><div class="label">日均支出</div><div class="value">${yuan(t.expense / elapsed)}</div></div>
    </div>

    <div class="grid grid-main">
      <div class="card">
        <div class="card-head">
          <div><div class="card-title">分类排行</div><div class="card-sub">${kind === 'expense' ? '支出' : '收入'}合计 ${yuan(rankTotal)}</div></div>
        </div>
        <div class="card-body">${rankBody}</div>
      </div>
      <div class="stack">
        ${heatCard(bId, m)}
        <div class="card">
          <div class="card-head"><div><div class="card-title">同比 / 环比</div><div class="card-sub">对比上月与去年同月</div></div></div>
          <div class="card-body">
            <table class="compare-table">
              <thead><tr><th></th><th>本月</th><th>上月</th><th>环比</th><th>同比</th></tr></thead>
              <tbody>
                ${compareRows.map(([label, cur, p, y, goodUp]) => `
                  <tr>
                    <td>${label}</td>
                    <td>${money(cur)}</td>
                    <td class="muted">${money(p)}</td>
                    <td>${deltaEl(cur, p, goodUp)}</td>
                    <td>${deltaEl(cur, y, goodUp)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
            <div class="divider" style="margin:14px 0 12px"></div>
            <div class="card-sub" style="margin-bottom:4px">近 6 个月支出</div>
            <div class="month-bars">
              ${months.map((mm, i) => `
                <div class="month-bar ${mm === m ? 'active' : ''}" title="${monthText(mm)} ${yuan(monthVals[i])}">
                  <i style="height:${Math.max(3, Math.round((monthVals[i] / maxV) * 64))}px"></i>
                  <span>${shortMonth(mm)}</span>
                </div>`).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

/* ============================================================
   7. 预算 + 周期账单
   ============================================================ */

function ruleText(rule) {
  if (!rule) return '—';
  if (rule.freq === 'monthly') return `每月 ${rule.day} 日`;
  if (rule.freq === 'weekly') return `每周${WEEK_CN[Number(rule.day) % 7]}`;
  return '每天';
}

function renderBudget() {
  const bId = ui.bookId, m = ui.month;
  const bud = budgetRows(bId, m);
  const dim = daysInMonth(m);
  const elapsed = m === curMonth() ? Number(today().slice(8, 10)) : (m < curMonth() ? dim : 0);
  const leftDays = Math.max(1, dim - elapsed + 1);
  const rules = state.recurring.filter(r => r.bookId === bId);
  const pending = state.pending.filter(p => p.bookId === bId);

  const totalBlock = bud.total
    ? `<div class="budget-overview">
         <div>
           <div class="card-sub">本月已用 / 总预算</div>
           <div class="budget-amount" style="margin-top:4px">${money(bud.total.used)}<span style="font-size:14px;color:var(--ink-3);font-weight:400"> / ${money(bud.total.amount)}</span></div>
         </div>
         <div style="text-align:right">
           <div class="card-sub">${bud.total.remaining < 0 ? '已超支' : '剩余'}</div>
           <div class="budget-amount" style="margin-top:4px;color:${bud.total.remaining < 0 ? 'var(--red)' : 'var(--ink)'}">${yuan(Math.abs(bud.total.remaining))}</div>
         </div>
       </div>
       <div class="bar"><div class="bar-fill ${bud.total.usage > 1 ? 'over' : bud.total.usage > 0.85 ? 'warn' : ''}" style="width:${Math.min(100, bud.total.usage * 100)}%"></div></div>
       <div class="budget-foot"><span>已用 ${pctText(bud.total.usage)}</span><span>${bud.total.remaining < 0 ? '本月已超支，建议压缩非必要支出' : `剩余 ${leftDays} 天，日均可用 ${yuan(bud.total.remaining / leftDays)}`}</span></div>`
    : emptyState('还没有设置总预算，设一个上限更容易控制花费', { act: 'add-budget', label: '设置总预算', icon: 'i-target' });

  const catItems = bud.cats.length
    ? bud.cats.map(r => `
      <div class="budget-item">
        <div class="top">
          <span class="name">${catDot(r.color)}${esc(r.name)}</span>
          <span class="nums"><b>${money(r.used)}</b> / ${money(r.amount)}</span>
          <div class="actions">
            <button class="icon-btn" data-act="edit-budget" data-id="${r.id}" title="编辑"><svg class="icon"><use href="#i-pencil"/></svg></button>
            <button class="icon-btn danger" data-act="del-budget" data-id="${r.id}" title="删除"><svg class="icon"><use href="#i-trash"/></svg></button>
          </div>
        </div>
        <div class="bar thin"><div class="bar-fill ${r.usage > 1 ? 'over' : r.usage > 0.85 ? 'warn' : ''}" style="width:${Math.min(100, r.usage * 100)}%"></div></div>
        <div class="budget-foot"><span>${r.remaining < 0 ? `超支 ${yuan(-r.remaining)}` : `剩余 ${yuan(r.remaining)}`}</span><span>${pctText(r.usage)}</span></div>
      </div>`).join('')
    : `<div class="hint" style="padding:8px 0">还没有分类预算。分类预算可以和总预算同时使用，互不冲突。</div>`;

  const ruleItems = rules.length
    ? rules.map(r => `
      <div class="budget-item">
        <div class="top">
          <span class="name">${catDot((catById(r.categoryId) || {}).color || 'var(--ink-3)')}${esc(r.name)}</span>
          <span class="nums"><b>${yuan(r.amount)}</b> · ${ruleText(r.rule)}</span>
          <div class="actions">
            <button class="icon-btn" data-act="edit-recurring" data-id="${r.id}" title="编辑"><svg class="icon"><use href="#i-pencil"/></svg></button>
            <button class="icon-btn danger" data-act="del-recurring" data-id="${r.id}" title="删除"><svg class="icon"><use href="#i-trash"/></svg></button>
          </div>
        </div>
        <div class="budget-foot">
          <span>下次 ${esc(r.nextDate)} · ${accById(r.accountId) ? esc(accById(r.accountId).name) : '未指定账户'}</span>
          <span>${r.active ? (r.auto ? '<span class="tag brand">自动入账</span>' : '<span class="tag warn">待确认</span>') : '<span class="tag">已暂停</span>'}</span>
        </div>
      </div>`).join('')
    : `<div class="hint" style="padding:8px 0">把房租、会员、还款这类固定支出设成周期账单，到点自动生成，不用每月手填。</div>`;

  const pendingBlock = pending.length ? `
    <div class="card mt">
      <div class="card-head">
        <div><div class="card-title">待入账</div><div class="card-sub">周期账单已到点，确认后写入明细</div></div>
        <div class="card-actions"><button class="btn sm" data-act="pending-all" data-id="${bId}">全部入账</button></div>
      </div>
      <div class="card-body">
        ${pending.map(p => `
          <div class="budget-item">
            <div class="top">
              <span class="name">${catDot((catById(p.categoryId) || {}).color || 'var(--ink-3)')}${esc(p.name)}</span>
              <span class="nums">${yuan(p.amount)} · ${esc(p.date)}</span>
              <div class="actions" style="opacity:1">
                <button class="btn sm" data-act="pending-confirm" data-id="${p.id}">入账</button>
                <button class="btn sm plain" data-act="pending-skip" data-id="${p.id}">忽略</button>
              </div>
            </div>
          </div>`).join('')}
      </div>
    </div>` : '';

  return `
    <div class="page-head">
      <div>
        <h1 class="page-title">预算与周期</h1>
        <p class="page-sub">${monthText(m)} · 预算吃本月流水，周期账单到点自动生成</p>
      </div>
      <div class="page-actions">
        <button class="btn" data-act="copy-budget"><svg class="icon"><use href="#i-copy"/></svg>复制上月预算</button>
        <button class="btn" data-act="add-recurring"><svg class="icon"><use href="#i-refresh"/></svg>新增周期账单</button>
        <button class="btn solid" data-act="add-budget"><svg class="icon"><use href="#i-plus"/></svg>新增预算</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div><div class="card-title">总预算</div><div class="card-sub">${bud.total && bud.total.month === 'ALL' ? '每月通用' : '仅本月'}</div></div>
        ${bud.total ? `<div class="card-actions">
          <button class="icon-btn" data-act="edit-budget" data-id="${bud.total.id}" title="编辑"><svg class="icon"><use href="#i-pencil"/></svg></button>
          <button class="icon-btn danger" data-act="del-budget" data-id="${bud.total.id}" title="删除"><svg class="icon"><use href="#i-trash"/></svg></button>
        </div>` : ''}
      </div>
      <div class="card-body">${totalBlock}</div>
    </div>

    <div class="grid grid-2 mt">
      <div class="card">
        <div class="card-head">
          <div><div class="card-title">分类预算</div><div class="card-sub">${bud.cats.length} 项</div></div>
        </div>
        <div class="card-body">${catItems}</div>
      </div>
      <div class="card">
        <div class="card-head">
          <div><div class="card-title">周期账单</div><div class="card-sub">${rules.length} 项</div></div>
        </div>
        <div class="card-body">${ruleItems}</div>
      </div>
    </div>
    ${pendingBlock}`;
}

/* ============================================================
   8. 账户与账本
   ============================================================ */

function renderAccounts() {
  const bId = ui.bookId;
  const accs = bookAccounts(bId);
  const total = accs.reduce((a, ac) => a + accountBalance(ac), 0);
  const month = ui.month;
  const book = bookOf(bId);

  const cards = accs.length ? accs.map(a => {
    const bal = accountBalance(a);
    const flow = accountFlows(a, month);
    return `
      <div class="acc">
        <div class="actions">
          <button class="icon-btn" data-act="edit-account" data-id="${a.id}" title="编辑"><svg class="icon"><use href="#i-pencil"/></svg></button>
          <button class="icon-btn danger" data-act="del-account" data-id="${a.id}" title="删除"><svg class="icon"><use href="#i-trash"/></svg></button>
        </div>
        <div class="top"><span class="name">${esc(a.name)}</span><span class="badge-type">${ACC_TYPES[a.type] || '其他'}</span></div>
        <div class="bal ${bal < 0 ? 'neg' : ''}">${signedYuan(bal)}</div>
        <div class="flows"><span>本月流入 <b style="color:var(--green)">+${money(flow.inflow)}</b></span><span>流出 <b>−${money(flow.outflow)}</b></span></div>
      </div>`;
  }).join('') : emptyState('这个账本还没有账户', { act: 'add-account', label: '新建账户', icon: 'i-card' });

  const bookRows = state.books.map(b => {
    const cnt = state.txns.filter(t => t.bookId === b.id).length;
    const accCnt = state.accounts.filter(a => a.bookId === b.id).length;
    return `
      <div class="debt-item">
        <div class="debt-avatar" style="background:${esc(b.color || 'var(--surface-3)')}1a;color:${esc(b.color || 'var(--ink)')}">${esc(b.name.slice(0, 1))}</div>
        <div class="debt-main">
          <div class="who">${esc(b.name)} ${b.id === bId ? '<span class="tag brand">当前</span>' : ''}</div>
          <div class="meta">${cnt} 笔记录 · ${accCnt} 个账户</div>
        </div>
        <div class="actions" style="opacity:1">
          <button class="icon-btn" data-act="edit-book" data-id="${b.id}" title="重命名"><svg class="icon"><use href="#i-pencil"/></svg></button>
          <button class="icon-btn danger" data-act="del-book" data-id="${b.id}" title="删除账本"><svg class="icon"><use href="#i-trash"/></svg></button>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="page-head">
      <div>
        <h1 class="page-title">账户与账本</h1>
        <p class="page-sub">${esc(book ? book.name : '')} · 净资产 ${yuan(total)}（余额 = 初始 + 流入 − 流出，随流水自动重算）</p>
      </div>
      <div class="page-actions">
        <button class="btn" data-act="add-book"><svg class="icon"><use href="#i-book"/></svg>新建账本</button>
        <button class="btn solid" data-act="add-account"><svg class="icon"><use href="#i-plus"/></svg>新建账户</button>
      </div>
    </div>

    <div class="acc-grid">${cards}</div>

    <div class="card mt">
      <div class="card-head"><div><div class="card-title">账本</div><div class="card-sub">账本之间数据独立，统计互不干扰</div></div></div>
      <div class="card-body">${bookRows}</div>
    </div>`;
}

/* ============================================================
   9. 负债 / 应收应付
   ============================================================ */

function debtTotals(bookId) {
  let recv = 0, pay = 0;
  for (const d of state.debts) {
    if (d.bookId !== bookId || d.settled) continue;
    if (d.direction === 'out') recv += d.amount; else pay += d.amount;
  }
  return { recv: round2(recv), pay: round2(pay), net: round2(recv - pay) };
}

function debtItem(d) {
  const overdue = !d.settled && d.dueDate && d.dueDate < today();
  return `
    <div class="debt-item">
      <div class="debt-avatar" style="background:${d.direction === 'out' ? 'var(--green-soft)' : 'var(--red-soft)'};color:${d.direction === 'out' ? 'var(--green)' : 'var(--red)'}">${esc(d.person.slice(0, 1))}</div>
      <div class="debt-main">
        <div class="who">${esc(d.person)}${overdue ? '<span class="tag warn">已逾期</span>' : ''}</div>
        <div class="meta">${esc(d.date)}${d.dueDate ? ` · 约定 ${esc(d.dueDate)}` : ''}${d.note ? ` · ${esc(d.note)}` : ''}</div>
      </div>
      <div class="debt-amt ${d.direction === 'out' ? 'recv' : 'pay'}">${d.direction === 'out' ? '+' : '−'}${yuan(d.amount)}</div>
      <div class="actions">
        ${d.settled
          ? `<button class="btn sm plain" data-act="unsettle-debt" data-id="${d.id}">撤销结清</button>`
          : `<button class="btn sm" data-act="settle-debt" data-id="${d.id}"><svg class="icon"><use href="#i-check"/></svg>${d.direction === 'out' ? '收回' : '还清'}</button>`}
        <button class="icon-btn" data-act="del-debt" data-id="${d.id}" title="删除"><svg class="icon"><use href="#i-trash"/></svg></button>
      </div>
    </div>`;
}

function renderDebts() {
  const bId = ui.bookId;
  const all = state.debts.filter(d => d.bookId === bId);
  const recv = all.filter(d => d.direction === 'out' && !d.settled).sort((a, b) => (a.dueDate || '9') < (b.dueDate || '9') ? -1 : 1);
  const pay = all.filter(d => d.direction === 'in' && !d.settled).sort((a, b) => (a.dueDate || '9') < (b.dueDate || '9') ? -1 : 1);
  const settled = all.filter(d => d.settled);
  const tot = debtTotals(bId);

  return `
    <div class="page-head">
      <div>
        <h1 class="page-title">应收应付</h1>
        <p class="page-sub">借出与借入不计入收支统计，只影响账户余额</p>
      </div>
      <div class="page-actions">
        <button class="btn solid" data-act="add-debt"><svg class="icon"><use href="#i-plus"/></svg>记一笔借贷</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-body">
        <div class="debt-sum">
          <div class="item"><div class="label">别人欠我</div><div class="value" style="color:var(--green)">${yuan(tot.recv)}</div></div>
          <div class="item"><div class="label">我欠别人</div><div class="value" style="color:var(--red)">${yuan(tot.pay)}</div></div>
          <div class="item"><div class="label">净头寸</div><div class="value">${signedYuan(tot.net)}</div></div>
          <div class="item"><div class="label">已结清</div><div class="value" style="color:var(--ink-3)">${settled.length} 笔</div></div>
        </div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><div><div class="card-title">应收</div><div class="card-sub">我借出去的 ${recv.length} 笔</div></div></div>
        <div class="card-body">${recv.length ? recv.map(debtItem).join('') : '<div class="hint" style="padding:6px 0">没有待收的款项</div>'}</div>
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">应付</div><div class="card-sub">我借进来的 ${pay.length} 笔</div></div></div>
        <div class="card-body">${pay.length ? pay.map(debtItem).join('') : '<div class="hint" style="padding:6px 0">没有待还的款项</div>'}</div>
      </div>
    </div>

    ${settled.length ? `
      <div class="card mt">
        <div class="card-head"><div><div class="card-title">已结清</div><div class="card-sub">${settled.length} 笔</div></div></div>
        <div class="card-body">${settled.map(debtItem).join('')}</div>
      </div>` : ''}`;
}

/* ============================================================
   10. AI 消费分析
   ============================================================ */

/* ---------- 配置清洗：粘贴常带引号、空格、换行 ---------- */
function cleanStr(v) {
  return String(v ?? '')
    .trim()
    .replace(/^["'`“”‘’]+/, '')
    .replace(/["'`“”‘’]+$/, '')
    .trim();
}

function aiCfg() {
  const c = (state && state.settings && state.settings.ai) || {};
  return {
    baseUrl: cleanStr(c.baseUrl),
    apiKey: cleanStr(c.apiKey),
    model: cleanStr(c.model),
    temperature: num(c.temperature),
    sendDetail: !!c.sendDetail,
  };
}

function aiConfig() { return state.settings.ai; }

function aiReady() {
  const c = aiCfg();
  return !!(c.baseUrl && c.apiKey && c.model);
}

function chatUrl(baseUrl) {
  const base = cleanStr(baseUrl).replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(base)) return base;
  return base + '/chat/completions';
}

/* 统一的接口调用，返回结构化结果，不直接操作 UI */
async function aiRequest(messages, maxTokens, timeoutMs, override) {
  const cfg = Object.assign(aiCfg(), override || {});
  cfg.baseUrl = cleanStr(cfg.baseUrl);
  cfg.apiKey = cleanStr(cfg.apiKey);
  cfg.model = cleanStr(cfg.model);
  const url = chatUrl(cfg.baseUrl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 60000);
  const started = Date.now();
  if (!cfg.baseUrl) { clearTimeout(timer); return { ok: false, status: 0, error: 'Base URL 为空', url, cfg, ms: 0 }; }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: Number.isFinite(cfg.temperature) ? cfg.temperature : 0.4,
        max_tokens: maxTokens || 1200,
        stream: false,
      }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* 非 JSON 响应保留原文 */ }
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, data, text, url, cfg, ms: Date.now() - started };
  } catch (err) {
    clearTimeout(timer);
    const aborted = err && err.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      error: aborted ? `请求超时（${Math.round((timeoutMs || 60000) / 1000)} 秒）` : (err && err.message) || '网络错误',
      url, cfg, ms: Date.now() - started,
    };
  }
}

/* 无鉴权探测主机是否可达：拿到任何 HTTP 状态都说明网络/跨域没问题 */
async function probeHost(baseUrl) {
  const base = cleanStr(baseUrl).replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
  if (!base) return { ok: false, error: 'Base URL 为空', url: '' };
  const url = base + '/models';
  try {
    const init = { method: 'GET' };
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(8000);
    const res = await fetch(url, init);
    return { ok: true, status: res.status, url };
  } catch (err) {
    return { ok: false, error: (err && err.message) || '无法连接', url };
  }
}

function statusHint(status) {
  switch (status) {
    case 401: return 'API Key 无效或已过期。复制时别带上引号、空格或换行；也要确认 Key 和 Base URL 属于同一个平台。';
    case 402: return '账户余额不足，去平台充值后再试。';
    case 403: return '没有访问权限，可能是账号或地区限制。';
    case 404: return '接口路径不对。DeepSeek 的 Base URL 填 https://api.deepseek.com/v1；用中转站就按它给的地址填。';
    case 429: return '触发限流或额度用尽，等一会儿再试。';
    case 400: return '请求参数或模型名不被接受。DeepSeek 官方可用：deepseek-chat、deepseek-reasoner。';
    case 500:
    case 502:
    case 503:
    case 504: return '对方服务端出错，稍后重试。';
    default: return status ? `接口返回 ${status}，具体看上面的响应内容。` : '';
  }
}

/* 综合状态码与响应内容给出人话解释 */
function failureHint(r) {
  const html = /^\s*<(!doctype|html)/i.test(r.text || '');
  if (html) {
    return '返回的是网页（HTML）而不是接口 JSON，说明这个地址不是 API 地址——platform.deepseek.com 是网页控制台，不能当接口用。把 Base URL 改成 https://api.deepseek.com/v1 再试。';
  }
  return statusHint(r.status);
}

/* 把常见的错误地址自动纠正（网页控制台 ≠ API） */
function normalizeStoredAI() {
  const ai = state && state.settings && state.settings.ai;
  if (!ai) return false;
  const u = cleanStr(ai.baseUrl);
  const bad = /^https?:\/\/(platform|chat|www)\.deepseek\.com(\/|$)/i.test(u);
  if (!bad) return false;
  ai.baseUrl = 'https://api.deepseek.com/v1';
  return true;
}

async function showApiFailure(r) {
  const cfg = r.cfg || aiCfg();
  let probe = null;
  if (!r.status) probe = await probeHost(cfg.baseUrl);
  const masked = cfg.apiKey ? `${cfg.apiKey.slice(0, 3)}…${cfg.apiKey.slice(-4)}（${cfg.apiKey.length} 位）` : '（空）';
  const page = location.protocol === 'file:' ? 'file:// 本地文件' : location.origin;
  let hint;
  if (r.status) {
    hint = failureHint(r);
  } else if (probe && probe.ok && [401, 403, 429, 404].includes(probe.status)) {
    hint = `主机是通的，但探测接口返回 ${probe.status}，说明请求被拒。最可能的原因是 Base URL 填成了网页控制台（platform.deepseek.com），正确地址是 https://api.deepseek.com/v1。`;
  } else {
    hint = '请求没有拿到任何 HTTP 响应，通常是网络、代理、DNS，或者接口不允许浏览器直连。';
  }
  const probeText = probe ? (probe.ok ? `可达（${probe.url} 返回 ${probe.status}）` : `不可达：${probe.error}`) : '';
  const raw = r.status ? (r.text || '').slice(0, 800) : (r.error || '');
  const diag = [
    '账页 AI 接口诊断',
    '时间：' + new Date().toLocaleString('zh-CN', { hour12: false }),
    '页面：' + page,
    '请求地址：' + r.url,
    '模型：' + (cfg.model || '（空）'),
    'Key：' + masked,
    '状态：' + (r.status || '无响应'),
    '耗时：' + r.ms + 'ms',
    '网络自检：' + (probeText || '未执行'),
    '响应：' + (raw || '（空）'),
  ].join('\n');
  ui.lastDiag = diag;

  openModal(`
    <div class="modal">
      <div class="modal-head">
        <div>
          <div class="modal-title">${r.status ? `接口返回 ${r.status}` : '接口连接失败'}</div>
          <div class="modal-sub">${esc(r.status ? '请求已发出，服务器拒绝了这次调用' : '请求没有拿到响应')}</div>
        </div>
        <button class="icon-btn" data-act="close-modal" aria-label="关闭"><svg class="icon"><use href="#i-x"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="kv"><span class="k">请求地址</span><span class="v" style="word-break:break-all">${esc(r.url)}</span></div>
        <div class="kv"><span class="k">模型</span><span class="v">${esc(cfg.model || '（空）')}</span></div>
        <div class="kv"><span class="k">Key</span><span class="v">${esc(masked)}</span></div>
        <div class="kv"><span class="k">耗时</span><span class="v">${r.ms} ms</span></div>
        ${probe ? `<div class="kv"><span class="k">网络自检</span><span class="v" style="color:${probe.ok ? 'var(--green)' : 'var(--red)'}">${esc(probeText)}</span></div>` : ''}
        <div class="card-sub" style="margin:14px 0 6px">服务器原始响应</div>
        <pre class="json">${esc(raw || '（空）')}</pre>
        <div class="hint" style="margin-top:12px;line-height:1.7">${esc(hint)}</div>
        ${probe && probe.ok && !r.status ? '<div class="hint" style="margin-top:6px">主机是通的，说明是这次请求被拦或接口不允许浏览器直连——可以把这段诊断发给我，我加一个本地代理。</div>' : ''}
      </div>
      <div class="modal-foot">
        <button class="btn" data-act="copy-diag"><svg class="icon"><use href="#i-copy"/></svg>复制诊断信息</button>
        <div class="spacer"></div>
        <button class="btn" data-act="close-modal">关闭</button>
        <button class="btn solid" data-act="retry-ai">重新测试</button>
      </div>
    </div>`);
}

function copyText(text) {
  if (!text) return;
  const done = () => toast('已复制，可以直接发给我');
  const fail = () => toast('复制失败，手动选中文本复制吧', 'error');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(fail);
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch { fail(); }
    ta.remove();
  }
}

function buildSummary() {
  const bId = ui.bookId, m = ui.month;
  const book = bookOf(bId);
  const t = monthTotals(bId, m);
  const prev = monthTotals(bId, addMonths(m, -1));
  const yoy = monthTotals(bId, addMonths(m, -12));
  const elapsed = daysElapsed(m);
  const dim = daysInMonth(m);
  const cats = catTotals(bId, m, 'expense');
  const prevCat = new Map(catTotals(bId, addMonths(m, -1), 'expense').map(c => [c.categoryId, c.amount]));
  const days = dayTotals(bId, m);
  const dayVals = [...days.entries()].sort((a, b) => b[1] - a[1]);
  const bud = budgetRows(bId, m);
  const monthTx = txnsOf(bId, m).filter(x => x.kind !== 'transfer');
  const topTx = [...monthTx].sort((a, b) => b.amount - a.amount).slice(0, 5)
    .map(x => ({ 日期: x.date, 分类: txLabel(x), 金额: x.amount, 备注: x.note || '' }));
  const noteCount = new Map();
  for (const x of monthTx) {
    if (!x.note) continue;
    noteCount.set(x.note, (noteCount.get(x.note) || 0) + 1);
  }
  const topNotes = [...noteCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, c]) => `${n}×${c}`);
  const dt = debtTotals(bId);
  const pct1 = n => Math.round(num(n) * 1000) / 10;

  return {
    账本: book ? book.name : '',
    月份: m,
    币种: 'CNY',
    收入: t.income,
    支出: t.expense,
    结余: t.net,
    储蓄率: t.income ? pct1(t.net / t.income) : null,
    支出环比: prev.expense ? pct1((t.expense - prev.expense) / prev.expense) : null,
    支出同比: yoy.expense ? pct1((t.expense - yoy.expense) / yoy.expense) : null,
    收入环比: prev.income ? pct1((t.income - prev.income) / prev.income) : null,
    记账天数: days.size,
    已过天数: elapsed,
    月天数: dim,
    日均支出: Math.round((t.expense / elapsed) * 100) / 100,
    最大单日: dayVals[0] ? { 日期: dayVals[0][0], 金额: dayVals[0][1] } : null,
    分类支出: cats.slice(0, 10).map(c => ({
      分类: c.name,
      金额: c.amount,
      占比: pct1(c.share),
      环比: prevCat.get(c.categoryId) ? pct1((c.amount - prevCat.get(c.categoryId)) / prevCat.get(c.categoryId)) : null,
    })),
    预算: bud.total ? {
      总预算: bud.total.amount,
      已用: bud.total.used,
      使用率: pct1(bud.total.usage),
      剩余: bud.total.remaining,
    } : null,
    分类预算: bud.cats.map(c => ({ 分类: c.name, 预算: c.amount, 已用: c.used, 使用率: pct1(c.usage) })),
    大额支出: topTx,
    高频备注: topNotes,
    应收: dt.recv,
    应付: dt.pay,
    ...(aiCfg().sendDetail
      ? { 明细: monthTx.slice(0, 80).map(x => ({ 日期: x.date, 分类: txLabel(x), 金额: x.amount, 备注: x.note || '' })) }
      : {}),
  };
}

function buildPrompt(summary) {
  return `你是一位严谨、务实的个人理财顾问。下面是一个中国用户本月的个人记账聚合数据（单位：人民币元，已排除借贷与转账）。请基于这些数字给出分析，不要编造数据中没有的信息，不要空泛鼓励。

要求：
1. 开头用一句话给出本月消费的总体判断（要有具体数字支撑）。
2. 列 3 个关键发现，每条都要引用数据（金额、占比、环比或使用率），并解释这意味着什么。
3. 给出 4~5 条可执行建议，每条尽量带上具体金额或次数上限，并说明能省下多少。
4. 最后给出下月总预算与 2~3 个重点分类预算的建议金额，并简述理由。
5. 使用简体中文和 Markdown（小标题 + 列表），总字数控制在 550 字以内，不要写代码块。

数据：
${JSON.stringify(summary, null, 2)}`;
}

function localInsights(summary) {
  const s = summary;
  const lines = [];
  const n = v => '¥' + money(v);
  const cat0 = s.分类支出[0];
  const over = (s.分类预算 || []).filter(c => c.使用率 >= 85);
  const daily = s.日均支出 || 0;

  let verdict = `本月支出 ${n(s.支出)}`;
  if (s.支出环比 !== null) verdict += `，环比 ${s.支出环比 > 0 ? '增加' : '减少'} ${Math.abs(s.支出环比).toFixed(1)}%`;
  if (s.支出同比 !== null) verdict += `，同比 ${s.支出同比 > 0 ? '增加' : '减少'} ${Math.abs(s.支出同比).toFixed(1)}%`;
  verdict += s.储蓄率 !== null ? `，储蓄率 ${(s.储蓄率 * 100).toFixed(1)}%。` : '。';
  lines.push(`### 一句话结论`, verdict);

  lines.push(`### 关键发现`);
  if (cat0) lines.push(`- **${cat0.分类}是最大支出项**：${n(cat0.金额)}，占本月支出 ${(cat0.占比 * 100).toFixed(1)}%${cat0.环比 !== null ? `，环比 ${cat0.环比 > 0 ? '+' : ''}${cat0.环比.toFixed(1)}%` : ''}。`);
  if (s.预算) {
    lines.push(`- **预算使用率 ${(s.预算.使用率 * 100).toFixed(1)}%**：总预算 ${n(s.预算.总预算)}，已用 ${n(s.预算.已用)}，${s.预算.剩余 >= 0 ? `还剩 ${n(s.预算.剩余)}` : `已超支 ${n(-s.预算.剩余)}`}。`);
  } else {
    lines.push(`- **尚未设置总预算**：没有上限就难以判断是否超支，建议先设一个。`);
  }
  if (s.最大单日) lines.push(`- **单日峰值 ${s.最大单日.日期}**：${n(s.最大单日.金额)}，是日均的 ${(s.最大单日.金额 / Math.max(1, daily)).toFixed(1)} 倍。`);
  if (s.大额支出 && s.大额支出.length) lines.push(`- **最大单笔**：${s.大额支出[0].分类} ${n(s.大额支出[0].金额)}（${s.大额支出[0].日期}${s.大额支出[0].备注 ? '，' + s.大额支出[0].备注 : ''}）。`);

  lines.push(`### 可执行建议`);
  const tips = [];
  if (cat0 && cat0.占比 > 0.3) tips.push(`把 **${cat0.分类}** 从每月 ${n(cat0.金额)} 压到 ${n(cat0.金额 * 0.85)}，每月省 ${n(cat0.金额 * 0.15)}。`);
  if (over.length) tips.push(`**${over.map(c => c.分类).join('、')}** 已超或接近预算上限，下月优先从这里砍，至少减 ${n(over.reduce((a, c) => a + c.已用 * 0.1, 0))}。`);
  if (daily > 0) tips.push(`日均支出 ${n(daily)}，设一个「单笔超过 ${n(Math.max(200, Math.round(daily * 3 / 100) * 100))} 就延迟 24 小时决定」的规则，能拦住大部分冲动消费。`);
  if (s.高频备注 && s.高频备注.length) tips.push(`高频项「${s.高频备注[0]}」重复出现，考虑改成周预算或套餐形式，通常能省 10%~20%。`);
  if (s.储蓄率 !== null && s.储蓄率 < 0.2) tips.push(`储蓄率仅 ${(s.储蓄率 * 100).toFixed(1)}%，建议发薪日先转出 ${n(s.收入 * 0.2)} 到单独账户，剩下的再花。`);
  if (!tips.length) tips.push('记录还比较少，先坚持记满一个月，再回来看这一页的结论会更准。');
  tips.forEach(t => lines.push(`- ${t}`));

  lines.push(`### 下月预算建议`);
  const base = cat0 ? cat0.金额 * 0.9 : s.支出 * 0.9;
  lines.push(`- 总预算建议 **${n(Math.round((s.支出 || base) * 0.9 / 100) * 100)}**（本月支出的 90%，留出压缩空间）。`);
  const top2 = (s.分类支出 || []).slice(0, 2);
  top2.forEach(c => lines.push(`- ${c.分类}：**${n(Math.round(c.金额 * 0.9 / 10) * 10)}**（本月 ${n(c.金额)} 的 90%）。`));
  return lines.join('\n');
}

function mdToHtml(src) {
  let s = esc(src || '').replace(/\r\n/g, '\n');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const lines = s.split('\n');
  let out = '', list = null;
  const flush = () => {
    if (list) { out += `<${list.tag}>` + list.items.map(i => `<li>${i}</li>`).join('') + `</${list.tag}>`; list = null; }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flush(); const lv = Math.min(3, m[1].length); out += `<h${lv}>${m[2]}</h${lv}>`; continue; }
    if (/^([-*_])\1{2,}$/.test(line)) { flush(); out += '<hr>'; continue; }
    if (/^&gt;\s?/.test(line)) { flush(); out += `<blockquote>${line.replace(/^&gt;\s?/, '')}</blockquote>`; continue; }
    if ((m = line.match(/^[-*+]\s+(.*)$/))) {
      if (!list || list.tag !== 'ul') { flush(); list = { tag: 'ul', items: [] }; }
      list.items.push(m[1]); continue;
    }
    if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
      if (!list || list.tag !== 'ol') { flush(); list = { tag: 'ol', items: [] }; }
      list.items.push(m[1]); continue;
    }
    flush();
    out += `<p>${line}</p>`;
  }
  flush();
  return out;
}

function currentReport() {
  const reports = state.aiReports;
  if (!reports.length) return null;
  if (ui.reportId) {
    const r = reports.find(x => x.id === ui.reportId);
    if (r) return r;
  }
  return reports.find(r => r.month === ui.month) || reports[0];
}

function renderAI() {
  const cfg = aiCfg();
  const ready = aiReady();
  const summary = buildSummary();
  const report = currentReport();
  const reports = state.aiReports;

  const reportBlock = ui.aiBusy
    ? `<div class="ai-loading"><span class="spinner"></span>正在请求模型，通常需要 5~20 秒…</div>`
    : report
      ? `<div class="ai-out">${mdToHtml(report.content)}</div>`
      : `<div class="empty sm"><svg class="icon"><use href="#i-spark"/></svg><p>还没有分析结果，点上面的按钮生成一份</p></div>`;

  const history = reports.length ? `<div class="report-list">${reports.slice(0, 8).map(r => `
    <button class="report-item" data-act="open-report" data-id="${r.id}">
      <div style="flex:1">
        <div class="report-month">${monthText(r.month)} ${r.id === (report && report.id) ? '<span class="tag brand">查看中</span>' : ''}</div>
        <div class="report-meta">${esc(new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false }))} · ${esc(r.source === 'local' ? '本地规则' : r.model || 'AI')}</div>
      </div>
      <span class="icon-btn" data-act="del-report" data-id="${r.id}" title="删除"><svg class="icon"><use href="#i-trash"/></svg></span>
    </button>`).join('')}</div>` : '<div class="hint">历史报告会存在本机，方便对比。</div>';

  return `
    <div class="page-head">
      <div>
        <h1 class="page-title">AI 消费分析</h1>
        <p class="page-sub">${monthText(ui.month)} · 只在你点按钮时把聚合摘要发给你自己填的模型接口</p>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-body">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <div class="ai-status">
            <span class="dot-state ${ready ? 'ok' : 'off'}"></span>
            <span>${ready ? `已配置 · ${esc(cfg.model)}` : '未配置接口，暂时只能用本地规则分析'}</span>
          </div>
          <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" data-act="ai-local"><svg class="icon"><use href="#i-chart"/></svg>本地快析</button>
            <button class="btn solid" data-act="ai-run" ${ui.aiBusy || !ready ? 'disabled' : ''}>
              <svg class="icon"><use href="#i-spark"/></svg>${ui.aiBusy ? '生成中…' : '生成 AI 分析'}
            </button>
          </div>
        </div>
        ${ready ? '' : `<div class="hint" style="margin-top:10px">去 <button class="linkish" data-act="nav" data-view="settings">设置</button> 里填 Base URL、Key 和模型名即可启用。支持任何 OpenAI 兼容接口（DeepSeek、OpenAI、Ollama 等）。</div>`}
      </div>
    </div>

    <div class="grid grid-main">
      <div class="stack">
        <div class="card">
          <div class="card-head">
            <div>
              <div class="card-title">${report ? `${monthText(report.month)} · 分析报告` : '分析报告'}</div>
              <div class="card-sub">${report ? `${esc(new Date(report.createdAt).toLocaleString('zh-CN', { hour12: false }))} · ${esc(report.source === 'local' ? '本地规则引擎' : report.model || 'AI')}` : '尚未生成'}</div>
            </div>
            <div class="card-actions">
              <button class="btn sm plain" data-act="ai-copy" ${report ? '' : 'disabled'}><svg class="icon"><use href="#i-copy"/></svg>复制</button>
            </div>
          </div>
          <div class="card-body">${reportBlock}</div>
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><div class="card-title">历史报告</div><div class="card-sub">${reports.length} 份</div></div></div>
          <div class="card-body">${history}</div>
        </div>
        <div class="card">
          <div class="card-head"><div><div class="card-title">将发送的数据</div><div class="card-sub">聚合摘要，不含逐条明细</div></div></div>
          <div class="card-body">
            <details class="raw">
              <summary>展开查看 JSON</summary>
              <pre class="json">${esc(JSON.stringify(summary, null, 2))}</pre>
            </details>
            <div class="hint" style="margin-top:8px">数据先在你本机聚合，点「生成」时才发给模型接口。API Key 只存在本地存储里。</div>
          </div>
        </div>
      </div>
    </div>`;
}

async function runAIAnalysis() {
  if (ui.aiBusy) return;
  const cfg = aiCfg();
  if (!aiReady()) { toast('先在设置里填好 Base URL、Key 和模型名'); goto('settings'); return; }
  const summary = buildSummary();
  ui.aiBusy = true;
  render();
  const r = await aiRequest([
    { role: 'system', content: '你是一位严谨、务实的个人理财顾问，只基于给定数据分析，输出简体中文 Markdown。' },
    { role: 'user', content: buildPrompt(summary) },
  ], 1400, 90000);
  ui.aiBusy = false;

  if (!r.ok) {
    render();
    toast(r.status ? `接口返回 ${r.status}，已打开诊断` : '请求失败，已打开诊断', 'error');
    await showApiFailure(r);
    return;
  }
  const content = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message && r.data.choices[0].message.content;
  if (!content || !String(content).trim()) {
    render();
    await showApiFailure({ ...r, ok: false, status: r.status, text: r.text || '（响应里没有 choices[0].message.content）' });
    return;
  }
  addReport(String(content).trim(), 'ai', cfg.model);
  render();
  toast('分析已生成');
}

function addReport(content, source, model) {
  const report = {
    id: uid('rp'),
    month: ui.month,
    createdAt: new Date().toISOString(),
    content,
    source,
    model: model || '',
  };
  state.aiReports.unshift(report);
  state.aiReports = state.aiReports.slice(0, 30);
  ui.reportId = report.id;
  save();
}

async function testAI() {
  if (ui.aiTestBusy) return;
  const form = readAiForm();
  if (!cleanStr(form.baseUrl) || !cleanStr(form.apiKey) || !cleanStr(form.model)) {
    toast('三项都要填：Base URL、Key、模型名');
    return;
  }
  ui.aiTestBusy = true;
  const btn = document.querySelector('[data-act="test-ai"]');
  if (btn) { btn.disabled = true; btn.textContent = '测试中…'; }
  const r = await aiRequest([{ role: 'user', content: '回复 ok 两个字符即可' }], 64, 30000, form);
  ui.aiTestBusy = false;
  if (btn) { btn.disabled = false; btn.textContent = '测试连接'; }

  if (!r.ok) {
    await showApiFailure(r);
    return;
  }
  state.settings.ai = {
    ...state.settings.ai,
    baseUrl: r.cfg.baseUrl,
    apiKey: r.cfg.apiKey,
    model: r.cfg.model,
    temperature: r.cfg.temperature,
    sendDetail: !!form.sendDetail,
  };
  save();
  render();
  const content = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message && r.data.choices[0].message.content;
  const used = r.data && r.data.model ? `，实际模型 ${r.data.model}` : '';
  toast(String(content || '').trim()
    ? `连接成功${used}，配置已保存`
    : `连接成功${used}（回复为空，但鉴权与路径正常）`);
}

function readAiForm() {
  return {
    baseUrl: ($('#aiBaseUrl') || {}).value || '',
    apiKey: ($('#aiKey') || {}).value || '',
    model: ($('#aiModel') || {}).value || '',
    temperature: num(($('#aiTemp') || {}).value),
    sendDetail: !!($('#aiDetail') && $('#aiDetail').checked),
  };
}

/* ============================================================
   11. 设置
   ============================================================ */

function renderSettings() {
  const cfg = aiCfg();
  const sizeKB = (() => {
    try { return (new Blob([JSON.stringify(state)]).size / 1024).toFixed(1); } catch { return '—'; }
  })();
  const catPills = (kind) => bookCats(ui.bookId, kind).map(c => `
    <div class="cat-pill">
      ${catDot(c.color)}<span>${esc(c.name)}</span>
      <button class="x" data-act="edit-cat" data-id="${c.id}" title="编辑"><svg class="icon"><use href="#i-pencil"/></svg></button>
      <button class="x" data-act="del-cat" data-id="${c.id}" title="删除"><svg class="icon"><use href="#i-x"/></svg></button>
    </div>`).join('');

  return `
    <div class="page-head">
      <div>
        <h1 class="page-title">设置</h1>
        <p class="page-sub">接口配置、分类管理、数据备份</p>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head">
          <div><div class="card-title">AI 接口</div><div class="card-sub">OpenAI 兼容协议，配置只存本机</div></div>
          <div class="card-actions"><span class="dot-state ${aiReady() ? 'ok' : 'off'}" style="display:inline-block"></span></div>
        </div>
        <div class="card-body">
          <div class="form">
            <div class="field">
              <label class="field-label" for="aiBaseUrl">Base URL</label>
              <input class="input" id="aiBaseUrl" value="${esc(cfg.baseUrl)}" placeholder="https://api.deepseek.com/v1" spellcheck="false">
              <div class="hint">填到 <code>/v1</code> 这一层即可，程序会自动拼 <code>/chat/completions</code>。也可直接填完整地址。</div>
              <div class="hint" style="margin-top:4px">实际请求：<code>${esc(cfg.baseUrl ? chatUrl(cfg.baseUrl) : '（先填 Base URL）')}</code></div>
            </div>
            <div class="form-row">
              <div class="field">
                <label class="field-label" for="aiModel">模型名</label>
                <input class="input" id="aiModel" value="${esc(cfg.model)}" placeholder="deepseek-chat" spellcheck="false">
              </div>
              <div class="field">
                <label class="field-label" for="aiTemp">温度</label>
                <input class="input" id="aiTemp" type="number" min="0" max="2" step="0.1" value="${esc(cfg.temperature)}">
              </div>
            </div>
            <div class="field">
              <label class="field-label" for="aiKey">API Key</label>
              <input class="input" id="aiKey" type="password" value="${esc(cfg.apiKey)}" placeholder="sk-…" spellcheck="false" autocomplete="off">
              <div class="hint">仅保存在浏览器 localStorage，不做任何加密。自用电脑没问题，公用电脑请勿填写。</div>
            </div>
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              <label class="switch">
                <input type="checkbox" id="aiDetail" ${cfg.sendDetail ? 'checked' : ''}>
                <span class="track"></span>
                <span>分析时附带逐条明细（更细但更耗 token）</span>
              </label>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn solid" data-act="save-ai">保存</button>
              <button class="btn" data-act="test-ai" ${ui.aiTestBusy ? 'disabled' : ''}>${ui.aiTestBusy ? '测试中…' : '测试连接'}</button>
              <button class="btn plain" data-act="ai-preset">填入官方默认值</button>
            </div>
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head"><div><div class="card-title">外观</div><div class="card-sub">奶油纸张 + 马卡龙色</div></div></div>
          <div class="card-body">
            <div class="segmented">
              ${[['light', '浅色'], ['dark', '深色'], ['auto', '跟随系统']].map(([k, label]) =>
                `<button class="seg ${(state.settings.theme || 'light') === k ? 'active' : ''}" data-act="set-theme" data-id="${k}">${label}</button>`).join('')}
            </div>
            <div class="hint" style="margin-top:10px">浅色是默认；深色适合晚上记账。</div>
            <div class="divider" style="margin:14px 0 12px"></div>
            <div class="field-label" style="margin-bottom:8px">字体</div>
            <div class="segmented">
              ${[['song', '宋体'], ['kai', '楷体'], ['sans', '无衬线']].map(([k, label]) =>
                `<button class="seg ${(state.settings.font || 'song') === k ? 'active' : ''}" data-act="set-font" data-id="${k}">${label}</button>`).join('')}
            </div>
            <div class="hint" style="margin-top:10px">宋体是书籍印刷体，最贴合「一本书」的感觉；楷体更手写；无衬线最清晰。</div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div><div class="card-title">数据</div><div class="card-sub">已用 ${sizeKB} KB · ${state.txns.length} 笔记录</div></div>
          </div>
          <div class="card-body">
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn" data-act="export-json"><svg class="icon"><use href="#i-download"/></svg>导出 JSON 备份</button>
              <button class="btn" data-act="import-json"><svg class="icon"><use href="#i-upload"/></svg>导入 JSON</button>
              <button class="btn" data-act="tx-export-csv"><svg class="icon"><use href="#i-download"/></svg>导出 CSV</button>
            </div>
            <div class="hint" style="margin-top:10px">JSON 备份包含接口 Key，转给别人前请先删掉 <code>settings.ai.apiKey</code>。</div>
            <div class="divider" style="margin:14px 0"></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn" data-act="seed-demo">载入示例数据（覆盖现有）</button>
              <button class="btn danger" data-act="reset-all"><svg class="icon"><use href="#i-trash"/></svg>清空全部数据</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-2 mt">
      <div class="card">
        <div class="card-head">
          <div><div class="card-title">支出分类</div><div class="card-sub">${bookCats(ui.bookId, 'expense').length} 个</div></div>
          <div class="card-actions"><button class="btn sm plain" data-act="add-cat" data-id="expense"><svg class="icon"><use href="#i-plus"/></svg>新增</button></div>
        </div>
        <div class="card-body"><div class="cat-manage">${catPills('expense') || '<span class="hint">还没有支出分类</span>'}</div></div>
      </div>
      <div class="card">
        <div class="card-head">
          <div><div class="card-title">收入分类</div><div class="card-sub">${bookCats(ui.bookId, 'income').length} 个</div></div>
          <div class="card-actions"><button class="btn sm plain" data-act="add-cat" data-id="income"><svg class="icon"><use href="#i-plus"/></svg>新增</button></div>
        </div>
        <div class="card-body"><div class="cat-manage">${catPills('income') || '<span class="hint">还没有收入分类</span>'}</div></div>
      </div>
    </div>

    <div class="card mt">
      <div class="card-head"><div><div class="card-title">关于</div><div class="card-sub">账页 v0.1 · 纯本地静态页面</div></div></div>
      <div class="card-body">
        <div class="kv"><span class="k">存储方式</span><span class="v">localStorage · ${esc(STORAGE_KEY)}</span></div>
        <div class="kv"><span class="k">数据规模</span><span class="v">${state.txns.length} 笔流水 · ${state.accounts.length} 个账户 · ${state.books.length} 个账本</span></div>
        <div class="kv"><span class="k">依赖</span><span class="v">无框架、无 CDN、零构建</span></div>
        <div class="kv"><span class="k">快捷键</span><span class="v"><kbd>N</kbd> 记一笔 · <kbd>Esc</kbd> 关闭弹窗</span></div>
      </div>
    </div>`;
}

/* ============================================================
   12. 弹窗基础设施
   ============================================================ */

let modalResolve = null;

function openModal(html) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-root"><div class="modal-backdrop" data-act="close-modal"></div>${html}</div>`;
  document.body.style.overflow = 'hidden';
  const focus = root.querySelector('[data-autofocus]');
  if (focus) setTimeout(() => { focus.focus(); if (focus.select && focus.value) focus.select(); }, 40);
}

function closeModal() {
  const root = $('#modalRoot');
  if (!root) return;
  root.innerHTML = '';
  document.body.style.overflow = '';
  if (modalResolve) { const r = modalResolve; modalResolve = null; r(false); }
}

function confirmDialog({ title, message, okText = '确定', danger = false }) {
  return new Promise(resolve => {
    modalResolve = resolve;
    openModal(`
      <div class="modal narrow">
        <div class="modal-head">
          <div class="modal-title">${esc(title)}</div>
          <button class="icon-btn" data-act="close-modal" aria-label="关闭"><svg class="icon"><use href="#i-x"/></svg></button>
        </div>
        <div class="modal-body"><p style="font-size:13px;color:var(--ink-2);line-height:1.75">${message}</p></div>
        <div class="modal-foot">
          <div class="spacer"></div>
          <button class="btn" data-act="cm-answer" data-id="0">取消</button>
          <button class="btn ${danger ? 'danger' : 'solid'}" data-act="cm-answer" data-id="1">${esc(okText)}</button>
        </div>
      </div>`);
  });
}

function toast(msg, type = '') {
  const root = $('#toastRoot');
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.innerHTML = `<svg class="icon"><use href="#${type === 'error' ? 'i-alert' : 'i-check'}"/></svg><span>${esc(msg)}</span>`;
  root.appendChild(el);
  while (root.children.length > 3) root.firstElementChild.remove();
  setTimeout(() => {
    el.style.transition = 'opacity .2s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 240);
  }, 2600);
}

/* ============================================================
   13. 记一笔弹窗（强耦合核心）
   ============================================================ */

let txDraft = null;

function defaultDateForMonth(m) {
  const cm = curMonth();
  if (m === cm) return today();
  if (m < cm) return `${m}-${pad2(daysInMonth(m))}`;
  return `${m}-01`;
}

function lastCatFor(bookId, kind) {
  const list = state.txns.filter(t => t.bookId === bookId && t.kind === kind && t.categoryId);
  list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
  return list[0] ? list[0].categoryId : '';
}

function openTxnModal(txn, prefill) {
  const bId = (txn && txn.bookId) || ui.bookId;
  const accs = bookAccounts(bId);
  if (!accs.length) { toast('先建一个账户，再记账'); goto('accounts'); return; }
  const isEdit = !!(txn && txn.id);
  const p = prefill || {};

  txDraft = {
    id: isEdit ? txn.id : null,
    bookId: bId,
    kind: isEdit ? txn.kind : (p.kind || 'expense'),
    categoryId: isEdit ? (txn.categoryId || '') : (p.categoryId || ''),
    accountId: isEdit ? (txn.accountId || '') : (p.accountId || ''),
    toAccountId: isEdit ? (txn.toAccountId || '') : '',
    date: isEdit ? txn.date : (p.date || defaultDateForMonth(ui.month)),
    note: isEdit ? (txn.note || '') : '',
    amount: isEdit ? txn.amount : '',
    createdAt: isEdit ? txn.createdAt : null,
    accountTouched: isEdit,
    recurringId: isEdit ? txn.recurringId : null,
    debtId: isEdit ? txn.debtId : null,
  };

  if (!txDraft.accountId || !accs.some(a => a.id === txDraft.accountId)) txDraft.accountId = accs[0].id;
  if (!txDraft.toAccountId) txDraft.toAccountId = accs.find(a => a.id !== txDraft.accountId) ? accs.find(a => a.id !== txDraft.accountId).id : accs[0].id;

  if (txDraft.kind !== 'transfer' && !txDraft.categoryId) {
    const last = lastCatFor(bId, txDraft.kind);
    const cats = bookCats(bId, txDraft.kind);
    txDraft.categoryId = (cats.some(c => c.id === last) ? last : (cats[0] || {}).id) || '';
  }
  if (!txDraft.accountTouched && txDraft.categoryId && state.lastAccountByCat[txDraft.categoryId]) {
    const a = state.lastAccountByCat[txDraft.categoryId];
    if (accs.some(x => x.id === a)) txDraft.accountId = a;
  }

  openModal(txnModalHtml(accs));
  wireTxnModal(accs);
}

function txnModalHtml(accs) {
  const d = txDraft;
  const book = bookOf(d.bookId);
  return `
    <form class="modal wide" id="txForm" autocomplete="off" novalidate>
      <div class="modal-head">
        <div>
          <div class="modal-title">${d.id ? '编辑记录' : '记一笔'}</div>
          <div class="modal-sub">${esc(book ? book.name : '')} · ${esc(dateLabel(d.date))}</div>
        </div>
        <button type="button" class="icon-btn" data-act="close-modal" aria-label="关闭"><svg class="icon"><use href="#i-x"/></svg></button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:15px">
        <div class="segmented" id="txKindSeg">
          ${[['expense', '支出'], ['income', '收入'], ['transfer', '转账']].map(([k, label]) =>
            `<button type="button" class="seg ${d.kind === k ? 'active' : ''}" data-kind="${k}">${label}</button>`).join('')}
        </div>
        <div class="amount-wrap">
          <span class="cur">¥</span>
          <input class="input amount-input" id="txAmount" name="amount" inputmode="decimal" placeholder="0.00"
                 value="${d.amount !== '' ? esc(d.amount) : ''}" ${d.id ? '' : 'data-autofocus'}>
        </div>
        <div id="txCatField" ${d.kind === 'transfer' ? 'hidden' : ''}>
          <div class="field-label" style="margin-bottom:7px">分类</div>
          <div class="cat-picker" id="txCats"></div>
        </div>
        <div class="form-row">
          <div class="field">
            <label class="field-label" id="txAccLabel">${d.kind === 'transfer' ? '转出账户' : '账户'}</label>
            <select class="input" name="accountId" id="txAccount">
              ${accs.map(a => `<option value="${a.id}" ${a.id === d.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label class="field-label">日期</label>
            <input class="input" type="date" name="date" id="txDate" value="${esc(d.date)}">
          </div>
        </div>
        <div class="field" id="txToAccField" ${d.kind === 'transfer' ? '' : 'hidden'}>
          <label class="field-label">转入账户</label>
          <select class="input" name="toAccountId" id="txToAccount">
            ${accs.map(a => `<option value="${a.id}" ${a.id === d.toAccountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field-label">备注</label>
          <input class="input" name="note" id="txNote" placeholder="例如：午餐、地铁、房租" value="${esc(d.note)}">
          <div class="quick-notes" id="txQuick" style="margin-top:7px"></div>
        </div>
      </div>
      <div class="modal-foot">
        ${d.id ? `<button type="button" class="btn danger" data-act="tx-del"><svg class="icon"><use href="#i-trash"/></svg>删除</button>` : ''}
        <div class="spacer"></div>
        <button type="button" class="btn" data-act="close-modal">取消</button>
        <button type="button" class="btn" id="txSaveNext">保存并继续</button>
        <button type="submit" class="btn solid">保存</button>
      </div>
    </form>`;
}

function wireTxnModal(accs) {
  const root = $('#modalRoot');

  root.querySelector('#txKindSeg').addEventListener('click', e => {
    const btn = e.target.closest('[data-kind]');
    if (!btn || btn.dataset.kind === txDraft.kind) return;
    txDraft.kind = btn.dataset.kind;
    if (txDraft.kind === 'transfer') {
      txDraft.categoryId = '';
    } else {
      const cats = bookCats(txDraft.bookId, txDraft.kind);
      if (!cats.some(c => c.id === txDraft.categoryId)) {
        const last = lastCatFor(txDraft.bookId, txDraft.kind);
        txDraft.categoryId = (cats.some(c => c.id === last) ? last : (cats[0] || {}).id) || '';
      }
    }
    syncTxKindUi(root);
  });

  root.querySelector('#txAccount').addEventListener('change', e => {
    txDraft.accountId = e.target.value;
    txDraft.accountTouched = true;
  });
  root.querySelector('#txToAccount').addEventListener('change', e => { txDraft.toAccountId = e.target.value; });
  root.querySelector('#txAmount').addEventListener('input', e => { txDraft.amount = e.target.value; });
  root.querySelector('#txNote').addEventListener('input', e => { txDraft.note = e.target.value; });
  root.querySelector('#txDate').addEventListener('change', e => {
    txDraft.date = e.target.value || today();
    const sub = root.querySelector('.modal-sub');
    if (sub) sub.textContent = `${bookOf(txDraft.bookId) ? bookOf(txDraft.bookId).name : ''} · ${dateLabel(txDraft.date)}`;
  });

  root.querySelector('#txForm').addEventListener('submit', e => { e.preventDefault(); commitTxn(false); });
  root.querySelector('#txSaveNext').addEventListener('click', () => commitTxn(true));

  const del = root.querySelector('[data-act="tx-del"]');
  if (del) del.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: '删除这条记录', message: '删除后不可恢复，账户余额会同步重算。', okText: '删除', danger: true });
    if (!ok) return;
    state.txns = state.txns.filter(t => t.id !== txDraft.id);
    save(); closeModal(); render(); toast('已删除');
  });

  syncTxKindUi(root);
}

function syncTxKindUi(root) {
  const d = txDraft;
  $$('#txKindSeg .seg', root).forEach(b => b.classList.toggle('active', b.dataset.kind === d.kind));
  const catField = root.querySelector('#txCatField');
  const toField = root.querySelector('#txToAccField');
  const label = root.querySelector('#txAccLabel');
  if (catField) catField.hidden = d.kind === 'transfer';
  if (toField) toField.hidden = d.kind !== 'transfer';
  if (label) label.textContent = d.kind === 'transfer' ? '转出账户' : '账户';
  renderCatsInto(root);
  renderQuickNotes(root);
}

function renderCatsInto(root) {
  const wrap = root.querySelector('#txCats');
  if (!wrap || txDraft.kind === 'transfer') return;
  const cats = bookCats(txDraft.bookId, txDraft.kind);
  wrap.innerHTML = cats.length
    ? cats.map(c => `<button type="button" class="cat-tile ${txDraft.categoryId === c.id ? 'active' : ''}" data-cat="${c.id}">${catDot(c.color)}<span>${esc(c.name)}</span></button>`).join('')
    : '<div class="hint">这个账本还没有分类，去设置里新增一个</div>';
  $$('[data-cat]', wrap).forEach(btn => {
    btn.addEventListener('click', () => {
      txDraft.categoryId = btn.dataset.cat;
      if (!txDraft.accountTouched) {
        const last = state.lastAccountByCat[txDraft.categoryId];
        if (last && bookAccounts(txDraft.bookId).some(a => a.id === last)) {
          txDraft.accountId = last;
          const sel = root.querySelector('#txAccount');
          if (sel) sel.value = last;
        }
      }
      renderCatsInto(root);
      renderQuickNotes(root);
    });
  });
}

function recentTxns(bookId) {
  const list = state.txns.filter(t => t.bookId === bookId);
  list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
  return list;
}

function renderQuickNotes(root) {
  const wrap = root.querySelector('#txQuick');
  if (!wrap) return;
  const d = txDraft;
  const chips = [];
  const pool = recentTxns(d.bookId).filter(t => t.kind === d.kind && t.note && t.note !== d.note);
  if (d.kind !== 'transfer' && d.categoryId) {
    const last = pool.find(t => t.categoryId === d.categoryId);
    if (last) {
      chips.push(`<button type="button" class="quick-note" data-amount="${last.amount}" data-note="${esc(last.note)}" title="套用上次的金额和备注">上次 ¥${money(last.amount)} · ${esc(last.note)}</button>`);
    }
  }
  const seen = new Set();
  for (const t of pool) {
    if (d.kind !== 'transfer' && d.categoryId && t.categoryId !== d.categoryId) continue;
    if (seen.has(t.note)) continue;
    seen.add(t.note);
    chips.push(`<button type="button" class="quick-note" data-note="${esc(t.note)}">${esc(t.note)}</button>`);
    if (seen.size >= 4) break;
  }
  wrap.innerHTML = chips.join('');
  $$('.quick-note', wrap).forEach(btn => {
    btn.addEventListener('click', () => {
      const noteEl = root.querySelector('#txNote');
      const amtEl = root.querySelector('#txAmount');
      noteEl.value = btn.dataset.note || '';
      txDraft.note = noteEl.value;
      if (btn.dataset.amount) {
        amtEl.value = btn.dataset.amount;
        txDraft.amount = btn.dataset.amount;
        amtEl.focus();
      }
    });
  });
}

function commitTxn(andNext) {
  const root = $('#modalRoot');
  const amount = round2(root.querySelector('#txAmount').value);
  const date = root.querySelector('#txDate').value || today();
  const note = root.querySelector('#txNote').value.trim();
  const accountId = root.querySelector('#txAccount').value;
  const kind = txDraft.kind;
  const categoryId = kind === 'transfer' ? '' : txDraft.categoryId;

  if (!(amount > 0)) { toast('金额要大于 0'); root.querySelector('#txAmount').focus(); return; }
  if (kind !== 'transfer' && !categoryId) { toast('先选一个分类'); return; }

  let toAccountId = '';
  if (kind === 'transfer') {
    toAccountId = root.querySelector('#txToAccount').value;
    if (!accountId || !toAccountId) { toast('选好转出和转入账户'); return; }
    if (accountId === toAccountId) { toast('转出和转入不能是同一个账户'); return; }
  }

  if (txDraft.id) {
    const t = state.txns.find(x => x.id === txDraft.id);
    if (t) {
      Object.assign(t, { kind, categoryId, accountId, amount, date, note });
      if (kind === 'transfer') { t.toAccountId = toAccountId; } else { delete t.toAccountId; }
    }
  } else {
    const obj = { id: uid('tx'), createdAt: Date.now(), bookId: txDraft.bookId, kind, categoryId, accountId, amount, date, note };
    if (kind === 'transfer') obj.toAccountId = toAccountId;
    if (txDraft.recurringId) obj.recurringId = txDraft.recurringId;
    if (txDraft.debtId) obj.debtId = txDraft.debtId;
    state.txns.push(obj);
  }
  if (categoryId) state.lastAccountByCat[categoryId] = accountId;

  save();
  const kept = { kind, categoryId, accountId, date };
  closeModal();
  render();
  toast(andNext ? `已记录 ${yuan(amount)}，继续记下一笔` : `已记录 ${yuan(amount)}`);
  if (andNext) openTxnModal(null, kept);
}

/* ============================================================
   14. 预算 / 账户 / 账本 / 分类 / 借贷 / 周期 表单
   ============================================================ */

function openBudgetModal(budget) {
  const b = budget || { categoryId: '', amount: '', month: 'ALL' };
  const cats = bookCats(ui.bookId, 'expense');
  openModal(`
    <form class="modal" id="budgetForm" novalidate>
      <div class="modal-head">
        <div><div class="modal-title">${budget ? '编辑预算' : '新增预算'}</div><div class="modal-sub">${monthText(ui.month)}</div></div>
        <button type="button" class="icon-btn" data-act="close-modal" aria-label="关闭"><svg class="icon"><use href="#i-x"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="form">
          <div class="field">
            <label class="field-label">预算范围</label>
            <select class="input" id="bdScope">
              <option value="">总预算（整月合计）</option>
              ${cats.map(c => `<option value="${c.id}" ${b.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <div class="field">
              <label class="field-label">金额</label>
              <input class="input" id="bdAmount" type="number" min="0" step="0.01" value="${b.amount || ''}" data-autofocus placeholder="0.00">
            </div>
            <div class="field">
              <label class="field-label">生效范围</label>
              <select class="input" id="bdMonth">
                <option value="ALL" ${b.month === 'ALL' ? 'selected' : ''}>每月通用</option>
                <option value="${ui.month}" ${b.month === ui.month ? 'selected' : ''}>仅 ${monthText(ui.month)}</option>
              </select>
            </div>
          </div>
          <div class="hint">分类预算和总预算可以同时存在，互不冲突；「每月通用」会自动套用到每个月，某个月单独设置的优先。</div>
        </div>
      </div>
      <div class="modal-foot">
        ${budget ? '<button type="button" class="btn danger" data-act="bd-del"><svg class="icon"><use href="#i-trash"/></svg>删除</button>' : ''}
        <div class="spacer"></div>
        <button type="button" class="btn" data-act="close-modal">取消</button>
        <button type="submit" class="btn solid">保存</button>
      </div>
    </form>`);

  const root = $('#modalRoot');
  root.querySelector('#budgetForm').addEventListener('submit', e => {
    e.preventDefault();
    const amount = round2(root.querySelector('#bdAmount').value);
    const categoryId = root.querySelector('#bdScope').value;
    const month = root.querySelector('#bdMonth').value;
    if (!(amount > 0)) { toast('金额要大于 0'); return; }
    if (budget) {
      Object.assign(budget, { amount, categoryId, month });
    } else {
      const dup = state.budgets.find(x => x.bookId === ui.bookId && x.categoryId === categoryId && x.month === month);
      if (dup) {
        dup.amount = amount;
        toast('该预算已存在，已更新金额');
      } else {
        state.budgets.push({ id: uid('bd'), bookId: ui.bookId, month, categoryId, amount });
      }
    }
    save(); closeModal(); render();
  });
  const del = root.querySelector('[data-act="bd-del"]');
  if (del) del.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: '删除预算', message: '删除后该范围不再有预算上限，流水不受影响。', okText: '删除', danger: true });
    if (!ok) return;
    state.budgets = state.budgets.filter(x => x.id !== budget.id);
    save(); closeModal(); render(); toast('已删除预算');
  });
}

function openAccountModal(acc) {
  openModal(`
    <form class="modal" id="accForm" novalidate>
      <div class="modal-head">
        <div><div class="modal-title">${acc ? '编辑账户' : '新建账户'}</div><div class="modal-sub">${esc(bookOf(ui.bookId) ? bookOf(ui.bookId).name : '')}</div></div>
        <button type="button" class="icon-btn" data-act="close-modal" aria-label="关闭"><svg class="icon"><use href="#i-x"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="form">
          <div class="form-row">
            <div class="field">
              <label class="field-label">账户名称</label>
              <input class="input" id="acName" value="${esc(acc ? acc.name : '')}" placeholder="微信零钱" data-autofocus>
            </div>
            <div class="field">
              <label class="field-label">类型</label>
              <select class="input" id="acType">
                ${Object.entries(ACC_TYPES).map(([k, label]) => `<option value="${k}" ${acc && acc.type === k ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field">
            <label class="field-label">初始余额</label>
            <input class="input" id="acBalance" type="number" step="0.01" value="${acc ? acc.initialBalance : ''}" placeholder="0.00">
            <div class="hint">只填开始记账那一刻的余额。之后余额 = 初始 + 流入 − 流出，随流水自动变化。</div>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button type="button" class="btn" data-act="close-modal">取消</button>
        <button type="submit" class="btn solid">保存</button>
      </div>
    </form>`);

  const root = $('#modalRoot');
  root.querySelector('#accForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = root.querySelector('#acName').value.trim();
    if (!name) { toast('账户名称不能为空'); return; }
    const type = root.querySelector('#acType').value;
    const initialBalance = round2(root.querySelector('#acBalance').value);
    if (acc) Object.assign(acc, { name, type, initialBalance });
    else state.accounts.push({ id: uid('ac'), bookId: ui.bookId, name, type, initialBalance, archived: false });
    save(); closeModal(); render(); toast('已保存账户');
  });
}

function openBookModal(book) {
  openModal(`
    <form class="modal narrow" id="bookForm" novalidate>
      <div class="modal-head">
        <div><div class="modal-title">${book ? '编辑账本' : '新建账本'}</div><div class="modal-sub">账本之间数据完全独立</div></div>
        <button type="button" class="icon-btn" data-act="close-modal" aria-label="关闭"><svg class="icon"><use href="#i-x"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="form">
          <div class="field">
            <label class="field-label">账本名称</label>
            <input class="input" id="bkName" value="${esc(book ? book.name : '')}" placeholder="日常 / 旅行 / 装修" data-autofocus>
          </div>
          <div class="field">
            <label class="field-label">标识色</label>
            <input class="input" id="bkColor" type="color" value="${esc(book ? book.color || '#2FA36B' : '#2FA36B')}" style="padding:4px;height:42px">
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button type="button" class="btn" data-act="close-modal">取消</button>
        <button type="submit" class="btn solid">保存</button>
      </div>
    </form>`);

  const root = $('#modalRoot');
  root.querySelector('#bookForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = root.querySelector('#bkName').value.trim();
    if (!name) { toast('账本名称不能为空'); return; }
    const color = root.querySelector('#bkColor').value;
    if (book) {
      Object.assign(book, { name, color });
    } else {
      const nb = { id: uid('bk'), name, color };
      state.books.push(nb);
      state.categories.push(...defaultCatsFor(nb.id));
      ui.bookId = nb.id;
    }
    save(); closeModal(); render(); toast('已保存账本');
  });
}

const DEFAULT_CATS = [
  ['餐饮', 'expense'], ['交通', 'expense'], ['购物', 'expense'], ['住房', 'expense'],
  ['居家', 'expense'], ['娱乐', 'expense'], ['医疗', 'expense'], ['学习', 'expense'], ['其他', 'expense'],
  ['工资', 'income'], ['兼职', 'income'], ['红包', 'income'], ['报销', 'income'],
];

function defaultCatsFor(bookId) {
  return DEFAULT_CATS.map(([name, kind]) => ({ id: uid('ct'), bookId, name, kind, color: catColor(name), archived: false }));
}

function openCatModal(cat, kind) {
  const k = cat ? cat.kind : kind;
  openModal(`
    <form class="modal narrow" id="catForm" novalidate>
      <div class="modal-head">
        <div><div class="modal-title">${cat ? '编辑分类' : '新增分类'}</div><div class="modal-sub">${k === 'income' ? '收入分类' : '支出分类'}</div></div>
        <button type="button" class="icon-btn" data-act="close-modal" aria-label="关闭"><svg class="icon"><use href="#i-x"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="form">
          <div class="field">
            <label class="field-label">分类名称</label>
            <input class="input" id="ctName" value="${esc(cat ? cat.name : '')}" placeholder="例如：宠物、健身" data-autofocus>
          </div>
          <div class="field">
            <label class="field-label">颜色</label>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap" id="ctColors">
              ${PALETTE.map((c, i) => `<button type="button" class="cat-tile" data-color="${c}" style="width:34px;height:34px;padding:0;justify-content:center;border-radius:9px"><i class="cat-dot" style="width:14px;height:14px;border-radius:4px;background:${c}"></i></button>`).join('')}
              <input class="input" id="ctColor" type="color" value="${esc(cat ? cat.color : PALETTE[0])}" style="width:44px;height:34px;padding:3px">
            </div>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button type="button" class="btn" data-act="close-modal">取消</button>
        <button type="submit" class="btn solid">保存</button>
      </div>
    </form>`);

  const root = $('#modalRoot');
  root.querySelectorAll('[data-color]').forEach(b => b.addEventListener('click', () => {
    root.querySelector('#ctColor').value = b.dataset.color;
    root.querySelectorAll('[data-color]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  }));
  root.querySelector('#catForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = root.querySelector('#ctName').value.trim();
    if (!name) { toast('分类名称不能为空'); return; }
    const color = root.querySelector('#ctColor').value;
    if (cat) Object.assign(cat, { name, color });
    else state.categories.push({ id: uid('ct'), bookId: ui.bookId, name, kind: k, color, archived: false });
    save(); closeModal(); render(); toast('已保存分类');
  });
}

function openDebtModal(debt) {
  const accs = bookAccounts(ui.bookId);
  if (!accs.length) { toast('先建一个账户'); goto('accounts'); return; }
  const d = debt || { direction: 'out', person: '', amount: '', date: today(), dueDate: '', note: '', accountId: accs[0].id };
  openModal(`
    <form class="modal" id="debtForm" novalidate>
      <div class="modal-head">
        <div><div class="modal-title">${debt ? '编辑借贷' : '记一笔借贷'}</div><div class="modal-sub">不计入收支统计，只影响账户余额</div></div>
        <button type="button" class="icon-btn" data-act="close-modal" aria-label="关闭"><svg class="icon"><use href="#i-x"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="form">
          <div class="segmented" id="dbDirSeg">
            <button type="button" class="seg ${d.direction === 'out' ? 'active' : ''}" data-dir="out">我借出去</button>
            <button type="button" class="seg ${d.direction === 'in' ? 'active' : ''}" data-dir="in">我借进来</button>
          </div>
          <div class="form-row">
            <div class="field">
              <label class="field-label">对方</label>
              <input class="input" id="dbPerson" value="${esc(d.person)}" placeholder="张伟" data-autofocus>
            </div>
            <div class="field">
              <label class="field-label">金额</label>
              <input class="input" id="dbAmount" type="number" step="0.01" min="0" value="${d.amount}" placeholder="0.00">
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label class="field-label">发生日期</label>
              <input class="input" id="dbDate" type="date" value="${d.date || today()}">
            </div>
            <div class="field">
              <label class="field-label">约定还期（可选）</label>
              <input class="input" id="dbDue" type="date" value="${d.dueDate || ''}">
            </div>
          </div>
          <div class="field">
            <label class="field-label">资金账户</label>
            <select class="input" id="dbAccount">
              ${accs.map(a => `<option value="${a.id}" ${a.id === d.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
            </select>
            <div class="hint" id="dbAccHint">记录后这笔钱会从该账户扣出，余额自动重算。</div>
          </div>
          <div class="field">
            <label class="field-label">备注</label>
            <input class="input" id="dbNote" value="${esc(d.note || '')}" placeholder="用途、约定细节">
          </div>
          ${debt ? '' : `<label class="switch"><input type="checkbox" id="dbMakeTxn" checked><span class="track"></span><span>同时生成一笔资金流水</span></label>`}
        </div>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button type="button" class="btn" data-act="close-modal">取消</button>
        <button type="submit" class="btn solid">保存</button>
      </div>
    </form>`);

  const root = $('#modalRoot');
  let direction = d.direction;
  root.querySelector('#dbDirSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-dir]');
    if (!b) return;
    direction = b.dataset.dir;
    root.querySelectorAll('#dbDirSeg .seg').forEach(x => x.classList.toggle('active', x.dataset.dir === direction));
    root.querySelector('#dbAccHint').textContent = direction === 'out'
      ? '记录后这笔钱会从该账户扣出，余额自动重算。'
      : '记录后这笔钱会进入该账户，余额自动重算。';
  });
  root.querySelector('#debtForm').addEventListener('submit', e => {
    e.preventDefault();
    const person = root.querySelector('#dbPerson').value.trim();
    const amount = round2(root.querySelector('#dbAmount').value);
    const date = root.querySelector('#dbDate').value || today();
    const dueDate = root.querySelector('#dbDue').value || '';
    const accountId = root.querySelector('#dbAccount').value;
    const note = root.querySelector('#dbNote').value.trim();
    if (!person) { toast('填一下对方是谁'); return; }
    if (!(amount > 0)) { toast('金额要大于 0'); return; }

    if (debt) {
      Object.assign(debt, { direction, person, amount, date, dueDate, accountId, note });
    } else {
      const nd = { id: uid('db'), bookId: ui.bookId, direction, person, amount, date, dueDate, note, accountId, settled: false };
      state.debts.push(nd);
      if (root.querySelector('#dbMakeTxn') && root.querySelector('#dbMakeTxn').checked) {
        const t = { id: uid('tx'), createdAt: Date.now(), bookId: ui.bookId, kind: 'transfer', categoryId: '', amount, date, debtId: nd.id, note: direction === 'out' ? `借出给${person}` : `向${person}借入` };
        if (direction === 'out') t.accountId = accountId; else t.toAccountId = accountId;
        state.txns.push(t);
      }
    }
    save(); closeModal(); render(); toast('已保存借贷');
  });
}

function openRecurringModal(rule) {
  const accs = bookAccounts(ui.bookId);
  const catsExp = bookCats(ui.bookId, 'expense');
  const catsInc = bookCats(ui.bookId, 'income');
  if (!accs.length) { toast('先建一个账户'); goto('accounts'); return; }
  const r = rule || { name: '', kind: 'expense', amount: '', categoryId: (catsExp[0] || {}).id || '', accountId: accs[0].id, rule: { freq: 'monthly', day: 1 }, nextDate: `${curMonth()}-01`, auto: false, active: true };
  const allCats = [...catsExp, ...catsInc];
  openModal(`
    <form class="modal" id="rcForm" novalidate>
      <div class="modal-head">
        <div><div class="modal-title">${rule ? '编辑周期账单' : '新增周期账单'}</div><div class="modal-sub">房租、会员、还款这类固定支出</div></div>
        <button type="button" class="icon-btn" data-act="close-modal" aria-label="关闭"><svg class="icon"><use href="#i-x"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="form">
          <div class="form-row">
            <div class="field">
              <label class="field-label">名称</label>
              <input class="input" id="rcName" value="${esc(r.name)}" placeholder="房租 / 视频会员" data-autofocus>
            </div>
            <div class="field">
              <label class="field-label">金额</label>
              <input class="input" id="rcAmount" type="number" step="0.01" min="0" value="${r.amount}" placeholder="0.00">
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label class="field-label">类型</label>
              <select class="input" id="rcKind">
                <option value="expense" ${r.kind === 'expense' ? 'selected' : ''}>支出</option>
                <option value="income" ${r.kind === 'income' ? 'selected' : ''}>收入</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label">分类</label>
              <select class="input" id="rcCat">
                ${allCats.map(c => `<option value="${c.id}" ${c.id === r.categoryId ? 'selected' : ''} data-kind="${c.kind}">${esc(c.name)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label class="field-label">账户</label>
              <select class="input" id="rcAccount">
                ${accs.map(a => `<option value="${a.id}" ${a.id === r.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label class="field-label">频率</label>
              <select class="input" id="rcFreq">
                <option value="monthly" ${r.rule.freq === 'monthly' ? 'selected' : ''}>每月</option>
                <option value="weekly" ${r.rule.freq === 'weekly' ? 'selected' : ''}>每周</option>
                <option value="daily" ${r.rule.freq === 'daily' ? 'selected' : ''}>每天</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="field" id="rcDayField">
              <label class="field-label" id="rcDayLabel">每月几号</label>
              <input class="input" id="rcDay" type="number" min="1" max="31" value="${r.rule.day || 1}">
            </div>
            <div class="field">
              <label class="field-label">下次入账日期</label>
              <input class="input" id="rcNext" type="date" value="${esc(r.nextDate || today())}">
            </div>
          </div>
          <div class="hint">到点后：开启「自动入账」会直接写入明细；关闭则出现在「待入账」里，由你确认。</div>
          <label class="switch"><input type="checkbox" id="rcAuto" ${r.auto ? 'checked' : ''}><span class="track"></span><span>自动入账</span></label>
          <label class="switch"><input type="checkbox" id="rcActive" ${r.active ? 'checked' : ''}><span class="track"></span><span>启用</span></label>
        </div>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button type="button" class="btn" data-act="close-modal">取消</button>
        <button type="submit" class="btn solid">保存</button>
      </div>
    </form>`);

  const root = $('#modalRoot');
  const freqEl = root.querySelector('#rcFreq');
  const syncDay = () => {
    const f = freqEl.value;
    const label = root.querySelector('#rcDayLabel');
    const field = root.querySelector('#rcDay');
    if (f === 'monthly') { label.textContent = '每月几号'; field.type = 'number'; field.min = 1; field.max = 31; field.value = field.value || 1; }
    else if (f === 'weekly') { label.textContent = '星期几'; field.type = 'number'; field.min = 1; field.max = 7; field.value = Math.min(7, Math.max(1, Number(field.value) || 1)); }
    else { label.textContent = '每天（无需设置）'; field.value = 1; field.disabled = true; return; }
    field.disabled = false;
  };
  freqEl.addEventListener('change', syncDay);
  syncDay();
  const kindEl = root.querySelector('#rcKind');
  if (kindEl) syncDay();

  root.querySelector('#rcForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = root.querySelector('#rcName').value.trim();
    const amount = round2(root.querySelector('#rcAmount').value);
    if (!name) { toast('名称不能为空'); return; }
    if (!(amount > 0)) { toast('金额要大于 0'); return; }
    const freq = freqEl.value;
    const day = Math.min(freq === 'weekly' ? 7 : 31, Math.max(1, Number(root.querySelector('#rcDay').value) || 1));
    const payload = {
      name,
      kind: root.querySelector('#rcKind').value,
      amount,
      categoryId: root.querySelector('#rcCat').value,
      accountId: root.querySelector('#rcAccount').value,
      rule: { freq, day },
      nextDate: root.querySelector('#rcNext').value || today(),
      auto: root.querySelector('#rcAuto').checked,
      active: root.querySelector('#rcActive').checked,
    };
    if (rule) Object.assign(rule, payload);
    else state.recurring.push({ id: uid('rc'), bookId: ui.bookId, ...payload });
    save(); closeModal(); render(); toast('已保存周期账单');
  });
}

/* ============================================================
   15. 周期账单引擎 + 借贷结清
   ============================================================ */

function advanceDate(iso, rule) {
  if (!rule) return addDays(iso, 30);
  if (rule.freq === 'daily') return addDays(iso, 1);
  if (rule.freq === 'weekly') return addDays(iso, 7);
  const d = parseYmd(iso);
  const day = Math.min(Number(rule.day) || d.getDate(), 28);
  const next = new Date(d.getFullYear(), d.getMonth() + 1, day, 12);
  return ymd(next);
}

function runRecurring() {
  const t = today();
  let created = 0;
  for (const r of state.recurring) {
    if (!r.active || !r.nextDate) continue;
    let guard = 0;
    while (r.nextDate <= t && guard < 60) {
      guard++;
      if (r.auto) {
        state.txns.push({
          id: uid('tx'), createdAt: Date.now(),
          bookId: r.bookId, kind: r.kind, categoryId: r.categoryId, accountId: r.accountId,
          amount: r.amount, date: r.nextDate, note: r.name, recurringId: r.id, auto: true,
        });
      } else {
        state.pending.push({
          id: uid('pd'), recurringId: r.id, bookId: r.bookId, name: r.name,
          kind: r.kind, amount: r.amount, categoryId: r.categoryId, accountId: r.accountId, date: r.nextDate,
        });
      }
      created++;
      r.nextDate = advanceDate(r.nextDate, r.rule);
    }
  }
  if (created) save();
  return created;
}

function confirmPending(id) {
  const p = state.pending.find(x => x.id === id);
  if (!p) return;
  state.txns.push({
    id: uid('tx'), createdAt: Date.now(),
    bookId: p.bookId, kind: p.kind, categoryId: p.categoryId, accountId: p.accountId,
    amount: p.amount, date: p.date, note: p.name, recurringId: p.recurringId, auto: false,
  });
  state.pending = state.pending.filter(x => x.id !== id);
  save(); render(); toast(`已入账 ${yuan(p.amount)}`);
}

async function settleDebt(id, silent) {
  const d = state.debts.find(x => x.id === id);
  if (!d || d.settled) return;
  const acc = (d.accountId && accById(d.accountId)) || bookAccounts(d.bookId)[0];
  if (!acc) { toast('没有可用账户'); return; }
  if (!silent) {
    const ok = await confirmDialog({
      title: d.direction === 'out' ? '确认收回' : '确认还清',
      message: `「${esc(d.person)}」${yuan(d.amount)}，将记一笔${d.direction === 'out' ? '转入' : '转出'}到「${esc(acc.name)}」，并标记为已结清。这笔不计入收支统计。`,
      okText: '确认',
    });
    if (!ok) return;
  }
  const t = {
    id: uid('tx'), createdAt: Date.now(), bookId: d.bookId, kind: 'transfer', categoryId: '',
    amount: d.amount, date: today(), debtId: d.id, debtFlow: 'settle',
    note: d.direction === 'out' ? `收回 ${d.person} 的借款` : `归还 ${d.person} 的借款`,
  };
  if (d.direction === 'out') t.toAccountId = acc.id; else t.accountId = acc.id;
  state.txns.push(t);
  d.settled = true;
  d.settledAt = today();
  save(); render(); toast('已结清');
}

function unsettleDebt(id) {
  const d = state.debts.find(x => x.id === id);
  if (!d) return;
  state.txns = state.txns.filter(t => !(t.debtId === d.id && t.debtFlow === 'settle'));
  d.settled = false;
  delete d.settledAt;
  save(); render(); toast('已撤销结清');
}

/* ============================================================
   16. 导入 / 导出 / 清空
   ============================================================ */

function exportJson() {
  const payload = { app: '账页', version: state.version, exportedAt: new Date().toISOString(), ...state };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  download(`账页备份-${stamp}.json`, JSON.stringify(payload, null, 2));
  toast('已导出 JSON 备份');
}

function exportCsv() {
  const rows = [['日期', '类型', '分类', '账户', '金额', '备注']];
  const list = state.txns.filter(t => t.bookId === ui.bookId).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const t of list) {
    const kindText = t.kind === 'expense' ? '支出' : t.kind === 'income' ? '收入' : '转账';
    rows.push([t.date, kindText, txLabel(t), txAccountName(t), t.amount.toFixed(2), t.note || '']);
  }
  const csv = '\uFEFF' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  download(`账页明细-${bookOf(ui.bookId) ? bookOf(ui.bookId).name : '账本'}-${today()}.csv`, csv, 'text/csv');
  toast(`已导出 ${list.length} 条明细`);
}

function starterState() {
  const s = blankState();
  s.settings.seeded = true;
  const book = { id: uid('bk'), name: '日常', color: '#2FA36B' };
  s.books = [book];
  s.accounts = [{ id: uid('ac'), bookId: book.id, name: '微信零钱', type: 'wechat', initialBalance: 0, archived: false }];
  s.categories = defaultCatsFor(book.id);
  return s;
}

async function resetAll() {
  const ok = await confirmDialog({
    title: '清空全部数据',
    message: '将删除所有账本、账户、分类、流水、预算、周期账单和借贷。接口配置会保留。此操作不可撤销，建议先导出备份。',
    okText: '全部清空',
    danger: true,
  });
  if (!ok) return;
  const keepAI = structuredClone(state.settings.ai);
  const keepTheme = state.settings.theme;
  const keepFont = state.settings.font;
  state = starterState();
  state.settings.ai = keepAI;
  state.settings.theme = keepTheme;
  state.settings.font = keepFont;
  ui.bookId = state.books[0].id;
  ui.month = curMonth();
  ui.view = 'dashboard';
  ui.reportId = null;
  save(); render(); toast('已清空，可以开始记账了');
}

async function seedAgain() {
  const ok = await confirmDialog({ title: '载入示例数据', message: '会覆盖当前全部数据，载入后可以直接体验所有功能。', okText: '载入', danger: true });
  if (!ok) return;
  const keepAI = structuredClone(state.settings.ai);
  const keepTheme = state.settings.theme;
  const keepFont = state.settings.font;
  state = seedDemo();
  state.settings.ai = keepAI;
  state.settings.theme = keepTheme;
  state.settings.font = keepFont;
  ui.bookId = 'bk_main';
  ui.month = curMonth();
  ui.view = 'dashboard';
  save(); render(); toast('已载入示例数据');
}

/* ============================================================
   17. 事件绑定
   ============================================================ */

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id || '';

  switch (act) {
    case 'nav':
      goto(el.dataset.view || 'dashboard');
      return;
    case 'flip':
      flip(Number(el.dataset.dir) || 1);
      return;
    case 'close-modal':
      closeModal();
      return;
    case 'cm-answer': {
      const r = modalResolve;
      modalResolve = null;
      closeModal();
      if (r) r(id === '1');
      return;
    }
    case 'month': {
      const dir = el.dataset.dir;
      if (dir === 'now') ui.month = curMonth();
      else if (dir === '-1') ui.month = addMonths(ui.month, -1);
      else if (dir === '1') ui.month = addMonths(ui.month, 1);
      else ui.month = curMonth();
      ui.tx.shown = 300;
      render();
      return;
    }
    case 'theme': {
      state.settings.theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
      save(); render();
      return;
    }
    case 'set-theme':
      state.settings.theme = id;
      save(); render();
      return;
    case 'set-font':
      state.settings.font = id;
      save(); render();
      return;
    case 'add-txn':
      openTxnModal(null);
      return;
    case 'edit-txn':
      openTxnModal(state.txns.find(t => t.id === id) || null);
      return;
    case 'tx-kind':
      ui.tx.kind = id;
      ui.tx.cat = '';
      ui.tx.shown = 300;
      render();
      return;
    case 'stats-kind':
      ui.statsKind = id;
      render();
      return;
    case 'tx-reset':
      ui.tx = { kind: 'all', cat: '', acc: '', q: '', shown: 300 };
      render();
      return;
    case 'tx-more':
      ui.tx.shown += 300;
      render();
      return;

    case 'add-budget':
      openBudgetModal(null);
      return;
    case 'edit-budget':
      openBudgetModal(state.budgets.find(b => b.id === id) || null);
      return;
    case 'del-budget': {
      const b = state.budgets.find(x => x.id === id);
      if (!b) return;
      const ok = await confirmDialog({ title: '删除预算', message: '删除后不再有该预算上限，流水不受影响。', okText: '删除', danger: true });
      if (!ok) return;
      state.budgets = state.budgets.filter(x => x.id !== id);
      save(); render(); toast('已删除预算');
      return;
    }
    case 'copy-budget': {
      const prevMonth = addMonths(ui.month, -1);
      const src = state.budgets.filter(b => b.bookId === ui.bookId && b.month === prevMonth);
      if (!src.length) { toast('上月没有单独设置的预算可复制'); return; }
      let n = 0;
      for (const b of src) {
        const dup = state.budgets.find(x => x.bookId === ui.bookId && x.categoryId === b.categoryId && x.month === ui.month);
        if (dup) { dup.amount = b.amount; } else { state.budgets.push({ id: uid('bd'), bookId: ui.bookId, month: ui.month, categoryId: b.categoryId, amount: b.amount }); }
        n++;
      }
      save(); render(); toast(`已复制 ${n} 条预算到 ${monthText(ui.month)}`);
      return;
    }
    case 'add-recurring':
      openRecurringModal(null);
      return;
    case 'edit-recurring':
      openRecurringModal(state.recurring.find(r => r.id === id) || null);
      return;
    case 'del-recurring': {
      const ok = await confirmDialog({ title: '删除周期账单', message: '删除后不再自动生成；已经生成的流水不会删除。', okText: '删除', danger: true });
      if (!ok) return;
      state.recurring = state.recurring.filter(r => r.id !== id);
      state.pending = state.pending.filter(p => p.recurringId !== id);
      save(); render(); toast('已删除');
      return;
    }
    case 'pending-confirm':
      confirmPending(id);
      return;
    case 'pending-skip':
      state.pending = state.pending.filter(p => p.id !== id);
      save(); render();
      return;
    case 'pending-all': {
      const list = state.pending.filter(p => p.bookId === (id || ui.bookId));
      if (!list.length) return;
      const total = list.reduce((a, p) => a + p.amount, 0);
      for (const p of list) {
        state.txns.push({
          id: uid('tx'), createdAt: Date.now(), bookId: p.bookId, kind: p.kind, categoryId: p.categoryId,
          accountId: p.accountId, amount: p.amount, date: p.date, note: p.name, recurringId: p.recurringId, auto: false,
        });
      }
      state.pending = state.pending.filter(p => p.bookId !== (id || ui.bookId));
      save(); render(); toast(`已入账 ${list.length} 笔，共 ${yuan(total)}`);
      return;
    }

    case 'add-account':
      openAccountModal(null);
      return;
    case 'edit-account':
      openAccountModal(state.accounts.find(a => a.id === id) || null);
      return;
    case 'del-account': {
      const a = state.accounts.find(x => x.id === id);
      if (!a) return;
      const used = state.txns.filter(t => t.accountId === id || t.toAccountId === id).length;
      if (used) { toast(`该账户还有 ${used} 笔流水，先处理掉再删除`); return; }
      const ok = await confirmDialog({ title: '删除账户', message: `删除「${esc(a.name)}」？账户余额不会计入任何地方。`, okText: '删除', danger: true });
      if (!ok) return;
      state.accounts = state.accounts.filter(x => x.id !== id);
      save(); render(); toast('已删除账户');
      return;
    }
    case 'add-book':
      openBookModal(null);
      return;
    case 'edit-book':
      openBookModal(state.books.find(b => b.id === id) || null);
      return;
    case 'del-book': {
      const b = state.books.find(x => x.id === id);
      if (!b) return;
      if (state.books.length <= 1) { toast('至少保留一个账本'); return; }
      const cnt = state.txns.filter(t => t.bookId === id).length;
      const ok = await confirmDialog({
        title: '删除账本',
        message: `删除「${esc(b.name)}」会同时删除它的 ${cnt} 笔记录、账户、分类、预算和周期账单。不可恢复。`,
        okText: '删除账本',
        danger: true,
      });
      if (!ok) return;
      state.books = state.books.filter(x => x.id !== id);
      state.txns = state.txns.filter(t => t.bookId !== id);
      state.accounts = state.accounts.filter(a => a.bookId !== id);
      state.categories = state.categories.filter(c => c.bookId !== id);
      state.budgets = state.budgets.filter(x => x.bookId !== id);
      state.recurring = state.recurring.filter(r => r.bookId !== id);
      state.pending = state.pending.filter(p => p.bookId !== id);
      state.debts = state.debts.filter(d => d.bookId !== id);
      if (ui.bookId === id) ui.bookId = state.books[0] ? state.books[0].id : null;
      save(); render(); toast('账本已删除');
      return;
    }

    case 'add-debt':
      openDebtModal(null);
      return;
    case 'settle-debt':
      settleDebt(id);
      return;
    case 'unsettle-debt':
      unsettleDebt(id);
      return;
    case 'del-debt': {
      const d = state.debts.find(x => x.id === id);
      if (!d) return;
      const linked = state.txns.filter(t => t.debtId === id).length;
      const ok = await confirmDialog({
        title: '删除借贷',
        message: `删除「${esc(d.person)}」的这笔记录${linked ? `，并同时删除关联的 ${linked} 笔资金流水` : ''}。不可恢复。`,
        okText: '删除',
        danger: true,
      });
      if (!ok) return;
      state.debts = state.debts.filter(x => x.id !== id);
      state.txns = state.txns.filter(t => t.debtId !== id);
      save(); render(); toast('已删除');
      return;
    }

    case 'add-cat':
      openCatModal(null, id || 'expense');
      return;
    case 'edit-cat':
      openCatModal(state.categories.find(c => c.id === id) || null, 'expense');
      return;
    case 'del-cat': {
      const c = state.categories.find(x => x.id === id);
      if (!c) return;
      const used = state.txns.filter(t => t.categoryId === id).length;
      if (used) { toast(`该分类下还有 ${used} 笔流水，先改掉再删除`); return; }
      const ok = await confirmDialog({ title: '删除分类', message: `删除「${esc(c.name)}」？`, okText: '删除', danger: true });
      if (!ok) return;
      state.categories = state.categories.filter(x => x.id !== id);
      save(); render(); toast('已删除分类');
      return;
    }

    case 'export-json':
      exportJson();
      return;
    case 'import-json':
      $('#importFile').click();
      return;
    case 'tx-export-csv':
      exportCsv();
      return;
    case 'seed-demo':
      seedAgain();
      return;
    case 'reset-all':
      resetAll();
      return;
    case 'demo-clear':
      resetAll();
      return;
    case 'demo-dismiss':
      state.settings.demo = false;
      save(); render();
      return;

    case 'save-ai': {
      const cfg = readAiForm();
      state.settings.ai = { ...state.settings.ai, ...cfg };
      save(); render(); toast('接口配置已保存');
      return;
    }
    case 'test-ai':
      testAI();
      return;
    case 'ai-preset': {
      const base = $('#aiBaseUrl');
      const model = $('#aiModel');
      if (base) base.value = 'https://api.deepseek.com/v1';
      if (model) model.value = 'deepseek-chat';
      toast('已填入官方地址与模型，点「保存」或「测试连接」生效');
      return;
    }

    case 'ai-run':
      runAIAnalysis();
      return;
    case 'ai-local': {
      const summary = buildSummary();
      const content = localInsights(summary);
      addReport(content, 'local', '本地规则');
      render(); toast('本地分析已生成');
      return;
    }
    case 'ai-copy': {
      const r = currentReport();
      if (!r) return;
      copyText(r.content);
      return;
    }
    case 'copy-diag':
      copyText(ui.lastDiag);
      return;
    case 'retry-ai':
      closeModal();
      testAI();
      return;
    case 'open-report':
      ui.reportId = id;
      render();
      return;
    case 'del-report': {
      const ok = await confirmDialog({ title: '删除报告', message: '删除后不可恢复。', okText: '删除', danger: true });
      if (!ok) return;
      state.aiReports = state.aiReports.filter(r => r.id !== id);
      if (ui.reportId === id) ui.reportId = null;
      save(); render();
      return;
    }
    default:
      return;
  }
});

document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el) {
    if (el.dataset.change === 'tx-cat') { ui.tx.cat = el.value; ui.tx.shown = 300; render(); }
    if (el.dataset.change === 'tx-acc') { ui.tx.acc = el.value; ui.tx.shown = 300; render(); }
  }
  if (e.target.id === 'bookSelect') {
    ui.bookId = e.target.value;
    ui.tx = { kind: 'all', cat: '', acc: '', q: '', shown: 300 };
    render();
  }
});

let searchTimer = null;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'txSearch') return;
  const val = e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    ui.tx.q = val;
    ui.tx.shown = 300;
    render();
    const el = $('#txSearch');
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, 180);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(); return; }
  const tag = (e.target && e.target.tagName || '').toLowerCase();
  const typing = ['input', 'textarea', 'select'].includes(tag) || (e.target && e.target.isContentEditable);
  if (typing) return;
  if (!$('#modalRoot').children.length) {
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openTxnModal(null); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); flip(1); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); flip(-1); return; }
  }
});

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.books) || !Array.isArray(data.txns)) throw new Error('不是有效的账页备份文件');
    const ok = await confirmDialog({
      title: '导入备份',
      message: `将用这份备份替换当前全部数据（${data.txns.length} 笔记录、${data.books.length} 个账本）。当前数据会丢失，建议先导出备份。`,
      okText: '导入并覆盖',
      danger: true,
    });
    if (!ok) return;
    state = normalize(data);
    save();
    ui.bookId = state.books[0] ? state.books[0].id : null;
    ui.month = curMonth();
    ui.view = 'dashboard';
    ui.reportId = null;
    runRecurring();
    render();
    toast(`导入完成，共 ${state.txns.length} 笔记录`);
  } catch (err) {
    toast('导入失败：' + ((err && err.message) || '文件格式不对'), 'error');
  }
});

/* ============================================================
   18. 启动
   ============================================================ */

(function init() {
  load();
  const fixedAI = normalizeStoredAI();
  const paletteChanged = migratePalette();
  if (!ui.bookId) ui.bookId = state.books[0] ? state.books[0].id : null;
  ui.month = curMonth();
  const created = runRecurring();
  render();
  if (fixedAI || paletteChanged) save();
  if (fixedAI) {
    setTimeout(() => toast('Base URL 已自动修正为 https://api.deepseek.com/v1（原地址是网页控制台）'), 700);
  }
  if (created) setTimeout(() => toast(`已生成 ${created} 笔周期账单，可在「预算」页确认`), 1200);
})();



