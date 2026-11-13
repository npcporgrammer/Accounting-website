/* 静态自检：class 覆盖率 + CSS 变量完整性（没有浏览器时的退而求其次）
   用法：node _dev/css-check.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const used = new Set();
for (const src of [js, html]) {
  for (const m of src.matchAll(/class="([^"$]*)"/g)) {
    m[1].split(/\s+/).filter(Boolean).forEach(c => used.add(c));
  }
  for (const m of src.matchAll(/class="([^"]*\$\{[^"]*)"/g)) {
    m[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean).forEach(c => used.add(c));
  }
}
// 运行时拼接出来的 class
['lv-1', 'lv-2', 'lv-3', 'lv-4', 'active', 'empty', 'blank', 'today', 'warn', 'over', 'income',
  'expense', 'transfer', 'recv', 'pay', 'neg', 'ok', 'off', 'good-up', 'good-down', 'up', 'down',
  'flat', 'solid', 'danger', 'sm', 'plain', 'wide', 'narrow', 'thin', 'flush', 'tight',
  'modal-root', 'hide-month', 'brand', 'hide-sm'].forEach(c => used.add(c));

const defined = new Set();
for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(m[1]);

const missing = [...used].filter(c => !defined.has(c) && c !== 'sprite').sort();

const declared = new Set([...css.matchAll(/--([a-zA-Z0-9-]+)\s*:/g)].map(m => m[1]));
const refs = new Set([...css.matchAll(/var\(--([a-zA-Z0-9-]+)/g)].map(m => m[1]));
const jsRefs = new Set([...js.matchAll(/var\(--([a-zA-Z0-9-]+)\)/g)].map(m => m[1]));
const undef = [...new Set([...refs, ...jsRefs])].filter(v => !declared.has(v)).sort();

console.log('=== 未定义样式的 class ===');
console.log(missing.length ? missing.join('\n') : '（无）');
console.log('\n=== 未声明的 CSS 变量 ===');
console.log(undef.length ? undef.join('\n') : '（无）');
console.log(`\nclass 使用 ${used.size} 个 / 定义 ${defined.size} 个；变量声明 ${declared.size} 个`);
process.exitCode = missing.length || undef.length ? 1 : 0;
