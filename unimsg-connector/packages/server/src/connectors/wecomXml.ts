/**
 * 极简 XML ↔ 对象转换（企业微信回调报文专用，无第三方依赖）。
 *
 * 企微推送的是 text/xml，形如 `<xml><A><B>v</B></A></xml>`，且叶子节点普遍包一层 CDATA。
 * 这里只实现平台报文真正用到的能力：
 *  - 嵌套元素 → 对象；同名重复节点（如 Articles/item）→ 数组
 *  - CDATA 段原样取内容（不做实体解码）
 *  - 文本节点解码基础实体与数字实体（amp / lt / 数字实体等），中文按 UTF-8 原样保留
 *  - 自闭合标签、XML 声明、注释、DOCTYPE 忽略；空元素解析为空字符串
 * 不支持属性（企微报文不带属性），也不做命名空间。
 */

export type XmlObject = Record<string, unknown>;

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
};

/** CDATA 起止标记拆开写：字面量紧贴模板串的美元花括号会让 TS 词法扫描器误判 */
const CDATA_HEAD = '<![' + 'CDATA[';
const CDATA_TAIL = ']]' + '>';

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (all, name: string) => {
    if (name[0] === '#') {
      const code = /^#x/i.test(name)
        ? Number.parseInt(name.slice(2), 16)
        : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[name] ?? all;
  });
}

interface TextPiece {
  cdata: boolean;
  text: string;
}

interface Element {
  name: string;
  pieces: TextPiece[];
  children: XmlObject;
}

function isNameStop(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '/' || ch === '>';
}

/** 从 i 开始找到当前标签的 '>'，跳过引号内的内容（属性值里可能出现 '>'）。 */
function findTagEnd(xml: string, i: number): number {
  let quote = '';
  for (let j = i; j < xml.length; j += 1) {
    const ch = xml[j];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return j;
    }
  }
  return -1;
}

/** 跳过空白 / 注释 / 处理指令 / DOCTYPE，返回下一个元素 '<' 的下标；没有则返回 -1。 */
function nextElement(xml: string, i: number): number {
  for (let j = i; j < xml.length;) {
    const ch = xml[j];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { j += 1; continue; }
    if (ch !== '<') return -1;
    if (xml.startsWith('<!--', j)) {
      const end = xml.indexOf('-->', j + 4);
      if (end < 0) return -1;
      j = end + 3;
      continue;
    }
    if (xml.startsWith(CDATA_HEAD, j)) return j;
    if (xml.startsWith('<?', j)) {
      const end = xml.indexOf('?>', j + 2);
      if (end < 0) return -1;
      j = end + 2;
      continue;
    }
    if (xml.startsWith('<!', j)) {
      const end = xml.indexOf('>', j + 2);
      if (end < 0) return -1;
      j = end + 1;
      continue;
    }
    if (j + 1 < xml.length && !isNameStop(xml[j + 1]) && xml[j + 1] !== '/') return j;
    return -1;
  }
  return -1;
}

function merge(target: XmlObject, key: string, value: unknown): void {
  if (!(key in target)) {
    target[key] = value;
    return;
  }
  const cur = target[key];
  if (Array.isArray(cur)) cur.push(value);
  else target[key] = [cur, value];
}

/** 解析一个元素；pos 指向 '<'。返回元素结构与剩余文本的起点。 */
function parseElement(xml: string, pos: number): { el: Element; next: number } {
  let i = pos + 1;
  let name = '';
  while (i < xml.length && !isNameStop(xml[i])) { name += xml[i]; i += 1; }

  const el: Element = { name, pieces: [], children: {} };
  const end = findTagEnd(xml, i);
  if (end < 0) throw new Error(`XML 标签未闭合：<${name}`);
  let cursor = end + 1;
  if (xml[end - 1] === '/') return { el, next: cursor }; // 自闭合：空元素

  for (;;) {
    if (cursor >= xml.length) throw new Error(`XML 缺少结束标签：</${name}>`);
    if (xml.startsWith('</', cursor)) {
      const close = findTagEnd(xml, cursor + 2);
      if (close < 0) throw new Error(`XML 结束标签未闭合：</${name}>`);
      return { el, next: close + 1 };
    }
    if (xml.startsWith(CDATA_HEAD, cursor)) {
      const open = cursor + CDATA_HEAD.length;
      const close = xml.indexOf(CDATA_TAIL, open);
      if (close < 0) throw new Error('XML CDATA 未闭合');
      el.pieces.push({ cdata: true, text: xml.slice(open, close) });
      cursor = close + CDATA_TAIL.length;
      continue;
    }
    if (xml[cursor] === '<') {
      const start = nextElement(xml, cursor);
      if (start < 0) throw new Error(`XML 结构非法（位置 ${cursor}）`);
      const child = parseElement(xml, start);
      merge(el.children, child.el.name, nodeValue(child.el));
      cursor = child.next;
      continue;
    }
    const lt = xml.indexOf('<', cursor);
    const raw = xml.slice(cursor, lt < 0 ? xml.length : lt);
    if (raw) el.pieces.push({ cdata: false, text: raw });
    cursor = lt < 0 ? xml.length : lt;
  }
}

function nodeValue(el: Element): unknown {
  const text = el.pieces
    .map((p) => (p.cdata ? p.text : decodeEntities(p.text)))
    .join('')
    .trim();
  if (Object.keys(el.children).length === 0) return text;
  if (!text) return el.children;
  return { ...el.children, '#text': text };
}

/**
 * XML → 对象。返回根元素的内容（企微即 xml 根节点下的字段表）。
 * 解析不出根元素时返回空对象，交由调用方按"无字段"处理。
 */
export function parseXml(input: string): XmlObject {
  const xml = input.replace(/^\uFEFF/, '');
  const start = nextElement(xml, 0);
  if (start < 0) return {};
  const { el } = parseElement(xml, start);
  const value = nodeValue(el);
  if (typeof value === 'string') return { [el.name]: value };
  return value as XmlObject;
}

function toEntries(value: unknown): [string, unknown][] {
  return Object.entries(value as XmlObject);
}

/** 字符串值包一层 CDATA；内容里的 CDATA 结束标记按规范拆段续接。 */
function cdata(text: string): string {
  const escaped = text.split(CDATA_TAIL).join(']]' + CDATA_TAIL + CDATA_HEAD + '>');
  return CDATA_HEAD + escaped + CDATA_TAIL;
}

function render(key: string, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map((v) => render(key, v)).join('');
  if (typeof value === 'object') {
    return `<${key}>${toEntries(value).map(([k, v]) => render(k, v)).join('')}</${key}>`;
  }
  return `<${key}>${cdata(String(value))}</${key}>`;
}

/** 对象 → XML（被动回复加密报文用）。默认根节点 xml，与企微一致。 */
export function buildXml(obj: XmlObject, root = 'xml'): string {
  return `<${root}>${toEntries(obj).map(([k, v]) => render(k, v)).join('')}</${root}>`;
}
