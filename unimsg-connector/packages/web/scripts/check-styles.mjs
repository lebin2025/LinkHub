/**
 * 样式护栏（比 stylelint 更贴近本项目的那几条规矩）。
 *
 * 逐条都是"踩过一次的坑"，写死成检查，避免下次重构时又退化：
 *
 *  1. 字号必须 rem —— px 不跟浏览器默认字号缩放，等于关掉了无障碍放大。
 *  2. 裸 hex 只允许出现在令牌块（:root / [data-theme] / @supports not）——
 *     色值散落在规则里就会出现"三处真相"，改一处忘三处。
 *  3. 禁止 transition/animation 动 top/left/width —— 那是动画改布局，
 *     每帧都要重排；位移一律走 transform。
 *  4. 暗色块里不许出现 !important —— 主题差异应该是"成对令牌"，
 *     靠 !important 硬压内联样式说明色板来源没收敛。
 *  5. 圆角只能用尺阶令牌（--r-6/8/10/12/16/pill）或 50% —— 否则又会漂出
 *     4px、7px、11px、14px 这一串"看起来差不多、改起来不知道用哪个"的值。
 *
 * 用法：node scripts/check-styles.mjs
 */
import { readFileSync } from 'node:fs';

const FILE = 'src/styles/app.css';
const lines = readFileSync(FILE, 'utf8').split('\n');

const violations = [];
const push = (line, rule, text) => violations.push({ line, rule, text: text.trim() });

/** 记录每个字符所在的块上下文（是否在令牌块内） */
function tokenBlockRanges(text) {
  const ranges = [];
  const stack = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '{') {
      const preludeStart = text.lastIndexOf('}', i) + 1;
      // 前导注释要剥掉，否则 `/* ... */\n:root` 认不出是令牌块
      const raw = text.slice(preludeStart, i).replace(/\/\*[\s\S]*?\*\//g, '');
      stack.push({ prelude: raw.trim(), start: i });
    } else if (text[i] === '}') {
      const block = stack.pop();
      if (block) ranges.push({ start: block.start, end: i, prelude: block.prelude });
    }
    i += 1;
  }
  return ranges;
}

const source = lines.join('\n');
const blocks = tokenBlockRanges(source);

/** 该偏移是否落在令牌块里 */
function inTokenBlock(offset) {
  for (const block of blocks) {
    if (offset < block.start || offset > block.end) continue;
    // 只认直接拥有该行的最内层块
    const isToken =
      block.prelude.startsWith(':root') ||
      block.prelude.startsWith('[data-theme') ||
      block.prelude.startsWith('@supports not');
    if (isToken) return true;
  }
  return false;
}

let offset = 0;
const offsets = lines.map((line) => {
  const current = offset;
  offset += line.length + 1;
  return current;
});

lines.forEach((line, index) => {
  const lineNo = index + 1;
  const text = line.replace(/\/\*.*?\*\//g, '');

  // 规则 1：字号必须是 rem / 变量
  if (/font-size:\s*[0-9.]+px/.test(text)) push(lineNo, 'font-size 用 rem', text);

  // 规则 4：暗色块里的 !important
  if (text.includes('!important') && inDarkBlock(offsets[index])) push(lineNo, '暗色块禁用 !important', text);

  // 规则 2：令牌块外的裸 hex（rgba() 不算）。块头本身（:root / [data-theme] / @supports）放行
  const isBlockHeader = /^\s*(:root|\[data-theme|@supports)/.test(text);
  if (!isBlockHeader && !inTokenBlock(offsets[index]) && /#[0-9a-fA-F]{3,8}\b/.test(text)) {
    push(lineNo, '色值应走令牌', text);
  }

  // 规则 3：动 top/left/width/height 的过渡
  if (/(transition|animation)[^;]*(^|\s)(top|left|width)\s/.test(text)) push(lineNo, '位移走 transform', text);
  if (/will-change:\s*[^;]*\btop\b/.test(text)) push(lineNo, 'will-change 不该含 top', text);

  // 规则 5：圆角只用尺阶
  if (/border-radius:\s*[0-9.]+px/.test(text)) push(lineNo, '圆角用尺阶令牌', text);
});

function inDarkBlock(offset) {
  for (const block of blocks) {
    if (offset < block.start || offset > block.end) continue;
    if (block.prelude.includes("[data-theme='dark']")) return true;
  }
  return false;
}

if (violations.length === 0) {
  console.log('✓ 样式护栏通过（字号 rem / 色值令牌 / 合成层动效 / 主题无硬压）');
  process.exit(0);
}

console.log(`✗ ${violations.length} 处违规：`);
for (const v of violations) console.log(`  ${FILE}:${v.line}  [${v.rule}]  ${v.text}`);
process.exit(1);
