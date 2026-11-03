/**
 * 企业微信真实适配器单测：SHA1 验签、AES 加解密、XML 解析、字段映射、发送请求形状、GET 握手。
 * 不触网：所有平台接口用 stub 的 fetch 打桩；HTTP 用例只走 127.0.0.1 回环。
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDecipheriv } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Platform, MsgStatus } from '@unimsg/shared';
import { config } from '../config';
import { createApp } from '../app';
import { InMemoryRepository } from '../db/repository';
import { connectors } from './registry';
import { LlmService } from '../services/llm';
import { OcrService } from '../services/ocr';
import { RateLimiter } from '../services/rateLimiter';
import { MessageService } from '../services/message';
import { wecomConnector, encryptReply } from './wecom';
import { buildXml, parseXml } from './wecomXml';
import { wecomDecrypt, wecomEncrypt, wecomSign } from './crypto';
import { resetTokenCache } from './real';

const TOKEN = 'wecom_token_test';
const AES_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY'; // 43 位，解出 32 字节
const CORP_ID = 'ww50b121ddd82a2350';
const OTHER_CORP = 'ww0000000000000000';
const AGENT_ID = '1000002';
const SECRET = 'wecom_secret_test';
const NONCE = 'nonce-1700000000';

const origFetch = globalThis.fetch;
const origMock = config.mock;

/** 内层明文：企微真实推送的字段都在这一层 */
const INNER_XML = [
  '<xml>',
  `<ToUserName><![CDATA[${CORP_ID}]]></ToUserName>`,
  '<FromUserName><![CDATA[XiChunZhi]]></FromUserName>',
  '<CreateTime>1700000000</CreateTime>',
  '<MsgType><![CDATA[text]]></MsgType>',
  '<Content><![CDATA[周五前交周报]]></Content>',
  '<MsgId>4365213456</MsgId>',
  '<AgentID><![CDATA[1000002]]></AgentID>',
  '</xml>',
].join('');

function nowTs(): string {
  return String(Math.floor(Date.now() / 1000));
}

/** 企微推送的外层信封：只有 Encrypt 是密文，签名也算在它头上 */
function envelope(encrypt: string): string {
  return buildXml({ ToUserName: CORP_ID, Encrypt: encrypt, AgentID: AGENT_ID });
}

interface Call {
  url: string;
  init: RequestInit;
  body: any;
}

function stubFetch(replies: unknown[]): Call[] {
  const calls: Call[] = [];
  let i = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(url), init, body });
    const reply = replies[Math.min(i++, replies.length - 1)];
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return calls;
}

async function withFetchStub<T>(replies: unknown[], run: (calls: Call[]) => Promise<T>): Promise<T> {
  const calls = stubFetch(replies);
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = origFetch;
  }
}

const repo = new InMemoryRepository();
const svc = new MessageService(
  repo, connectors, new LlmService(), new OcrService(), new RateLimiter(3, 5), () => {},
);
let server: http.Server;
let base = '';

before(async () => {
  config.mock = false;
  // 富化环节锁死本地 Mock，保证单测不外呼
  config.llm.provider = 'mock';
  config.ocr.provider = 'mock';
  config.platforms.wecom.token = TOKEN;
  config.platforms.wecom.aesKey = AES_KEY;
  config.platforms.wecom.corpId = CORP_ID;
  config.platforms.wecom.agentId = AGENT_ID;
  config.platforms.wecom.secret = SECRET;

  server = http.createServer(createApp(svc));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  globalThis.fetch = origFetch;
  config.mock = origMock;
  resetTokenCache();
  server.close();
});

beforeEach(() => resetTokenCache());

// ---------- 签名 ----------

test('企微验签：SHA1 签名匹配通过，篡改 timestamp 拒绝', () => {
  const ts = nowTs();
  const encrypt = wecomEncrypt(AES_KEY, INNER_XML, CORP_ID);
  const sig = wecomSign(TOKEN, ts, NONCE, encrypt);
  const body = wecomConnector.decrypt!(envelope(encrypt)) as any;

  assert.equal(body.Encrypt, encrypt, 'decrypt 必须保留原始密文供验签');
  assert.equal(wecomConnector.verify(body, sig, { msg_signature: sig, timestamp: ts, nonce: NONCE }), true);
  // 篡改 timestamp（签名没跟着变）
  assert.equal(
    wecomConnector.verify(body, sig, { msg_signature: sig, timestamp: String(Number(ts) + 1), nonce: NONCE }),
    false,
  );
  // 篡改 nonce / 直接伪造签名
  assert.equal(wecomConnector.verify(body, sig, { msg_signature: sig, timestamp: ts, nonce: 'other' }), false);
  assert.equal(wecomConnector.verify(body, 'a'.repeat(40), { msg_signature: 'a'.repeat(40), timestamp: ts, nonce: NONCE }), false);
});

test('企微验签：缺参数或明文回调一律拒绝（真实模式不放水）', () => {
  const ts = nowTs();
  const encrypt = wecomEncrypt(AES_KEY, INNER_XML, CORP_ID);
  const sig = wecomSign(TOKEN, ts, NONCE, encrypt);
  const body = wecomConnector.decrypt!(envelope(encrypt)) as any;

  assert.equal(wecomConnector.verify(body, sig, {}), false, 'query 里没有 msg_signature/timestamp/nonce');
  assert.equal(wecomConnector.verify({ Content: '明文直推' }, sig, { msg_signature: sig, timestamp: ts, nonce: NONCE }), false);
  // 过期时间戳（防重放）
  const old = String(Math.floor(Date.now() / 1000) - 7200);
  const oldSig = wecomSign(TOKEN, old, NONCE, encrypt);
  assert.equal(wecomConnector.verify(body, oldSig, { msg_signature: oldSig, timestamp: old, nonce: NONCE }), false);
});

// ---------- AES ----------

test('企微 AES 往返：可解密并校验 receiveId，corpId 不符抛错', () => {
  const encrypt = wecomEncrypt(AES_KEY, INNER_XML, CORP_ID);
  const plain = wecomDecrypt(AES_KEY, encrypt, CORP_ID);
  assert.equal(plain.message, INNER_XML);
  assert.equal(plain.receiveId, CORP_ID);

  // 每次加密的随机前缀不同 → 密文不同，但都能还原
  const other = wecomEncrypt(AES_KEY, INNER_XML, CORP_ID);
  assert.notEqual(other, encrypt);
  assert.equal(wecomDecrypt(AES_KEY, other, CORP_ID).message, INNER_XML);

  assert.throws(() => wecomDecrypt(AES_KEY, encrypt, OTHER_CORP), /receiveId/);
  assert.throws(() => wecomConnector.decrypt!(envelope(wecomEncrypt(AES_KEY, INNER_XML, OTHER_CORP))), /receiveId/);
});

test('企微密文结构：16 字节随机前缀 + 4 字节网络序长度 + XML + receiveId', () => {
  const prefix = Buffer.alloc(16, 7);
  const encrypt = wecomEncrypt(AES_KEY, INNER_XML, CORP_ID, prefix);
  const key = Buffer.from(`${AES_KEY}=`, 'base64');
  assert.equal(key.length, 32);

  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const raw = Buffer.concat([decipher.update(Buffer.from(encrypt, 'base64')), decipher.final()]);
  assert.equal(raw.length % 32, 0, '32 字节块填充');
  const pad = raw[raw.length - 1];
  const body = raw.subarray(0, raw.length - pad);

  assert.deepEqual(body.subarray(0, 16), prefix, '前 16 字节随机前缀');
  const len = body.readUInt32BE(16);
  assert.equal(len, Buffer.byteLength(INNER_XML, 'utf8'), '4 字节网络序长度 = XML 字节数');
  assert.equal(body.subarray(20, 20 + len).toString('utf8'), INNER_XML);
  assert.equal(body.subarray(20 + len).toString('utf8'), CORP_ID);
});

test('企微 AES：43 位以外的 EncodingAESKey 直接抛错', () => {
  assert.throws(() => wecomEncrypt('shortkey', 'x', CORP_ID), /43 位/);
  assert.throws(() => wecomDecrypt('shortkey', 'AAAA'), /43 位/);
});

// ---------- XML ----------

test('企微 XML：CDATA、嵌套、重复节点转数组、实体与中文', () => {
  const obj = parseXml([
    '<?xml version="1.0" encoding="utf-8"?>',
    '<xml>',
    '<!--注释被忽略-->',
    `<ToUserName><![CDATA[${CORP_ID}]]></ToUserName>`,
    '<Content>&lt;周报&gt; &amp; &#26399;五截止</Content>',
    '<CreateTime>1700000000</CreateTime>',
    '<Empty/>',
    '<Articles>',
    '<item><Title>标题一</Title><Url><![CDATA[https://example.com/a]]></Url></item>',
    '<item><Title>标题二</Title></item>',
    '</Articles>',
    '</xml>',
  ].join('')) as any;

  assert.equal(obj.ToUserName, CORP_ID);
  assert.equal(obj.CreateTime, '1700000000');
  assert.equal(obj.Empty, '');
  assert.equal(obj.Content, '<周报> & 期五截止', '实体解码且中文原样保留');
  assert.deepEqual(
    obj.Articles.item.map((x: any) => x.Title),
    ['标题一', '标题二'],
    '同名重复节点 → 数组',
  );
  assert.equal(obj.Articles.item[0].Url, 'https://example.com/a');
});

test('企微 XML：CDATA 内含 ]]> 与 <xml> 字符时 build/parse 可往返', () => {
  const tricky = '收尾 ]]> 与 <标签> 以及 & 符号 中文';
  const xml = buildXml({ Content: tricky, AgentID: 1000002, ToUserName: CORP_ID });
  const obj = parseXml(xml) as any;
  assert.equal(obj.Content, tricky);
  assert.equal(obj.AgentID, '1000002');
  assert.equal(obj.ToUserName, CORP_ID);
  assert.equal(parseXml('   ').ToUserName, undefined, '空报文返回空对象');
});

test('企微 receive：XML 字段映射为统一消息', () => {
  const msg = wecomConnector.receive(parseXml(INNER_XML));
  assert.equal(msg.platform, Platform.WECOM);
  assert.equal(msg.status, MsgStatus.RECEIVED);
  assert.equal(msg.externalId, '4365213456');
  assert.equal(msg.sender.id, 'XiChunZhi');
  assert.equal(msg.body, '周五前交周报');
  assert.equal(msg.type, 'todo', '"周报" 命中待办关键词');
  assert.equal(msg.conversation, undefined, '单聊没有 ChatId');
  assert.ok(msg.traceId);
});

test('企微 receive：群聊 ChatId 进 conversation，图片/文件类型分流', () => {
  const group = wecomConnector.receive(parseXml(buildXml({
    FromUserName: 'XiChunZhi', MsgType: 'text', Content: '记得开会', MsgId: 'g-1', ChatId: 'chatid_001',
  })));
  assert.equal(group.conversation?.id, 'chatid_001');
  assert.equal(group.conversation?.type, 'group');
  assert.equal(group.type, 'text');

  const image = wecomConnector.receive(parseXml(buildXml({
    FromUserName: 'XiChunZhi', MsgType: 'image', Content: '', MsgId: 'g-2',
  })));
  assert.equal(image.type, 'image');
});

test('企微 convert：touser / agentid / text.content 形状', () => {
  const received = wecomConnector.receive(parseXml(INNER_XML));
  const out = wecomConnector.convert({ ...received, reply: '回写内容' }) as any;
  assert.equal(out.touser, 'XiChunZhi');
  assert.equal(out.msgtype, 'text');
  assert.equal(out.agentid, 1000002);
  assert.deepEqual(out.text, { content: '回写内容' });
});

// ---------- 被动回复加密 ----------

test('企微被动回复：encryptReply 产出的密文能被自己的 decrypt 还原', () => {
  const replyXml = encryptReply({ MsgType: 'text', Content: '收到', ToUserName: 'XiChunZhi', FromUserName: CORP_ID });
  const back = wecomConnector.decrypt!(replyXml) as any;
  assert.equal(back.MsgType, 'text');
  assert.equal(back.Content, '收到');
  assert.match(replyXml, /<MsgSignature>/);
});

// ---------- 发送 ----------

function unified(over: Partial<any> = {}): any {
  const msg: any = wecomConnector.receive(parseXml(INNER_XML));
  return { ...msg, reply: '回写内容', status: MsgStatus.REPLIED, ...over };
}

test('企微真实发送：gettoken 带 corpid/corpsecret，access_token 拼在 send 的 query 上', async () => {
  const r = await withFetchStub([
    { errcode: 0, access_token: 'wx-token-1', expires_in: 7200 },
    { errcode: 0, errmsg: 'ok', msgid: 9001 },
  ], async (calls) => {
    const sent = await wecomConnector.send(unified());
    return { sent, calls };
  });
  assert.equal(r.sent.ok, true);
  assert.equal(r.sent.platformReply, '9001');

  const tokenUrl = new URL(r.calls[0].url);
  assert.equal(r.calls[0].init.method, 'GET');
  assert.equal(tokenUrl.origin + tokenUrl.pathname, 'https://qyapi.weixin.qq.com/cgi-bin/gettoken');
  assert.equal(tokenUrl.searchParams.get('corpid'), CORP_ID);
  assert.equal(tokenUrl.searchParams.get('corpsecret'), SECRET);

  const sendUrl = new URL(r.calls[1].url);
  assert.equal(sendUrl.origin + sendUrl.pathname, 'https://qyapi.weixin.qq.com/cgi-bin/message/send');
  assert.equal(sendUrl.searchParams.get('access_token'), 'wx-token-1');
  assert.equal(r.calls[1].init.method, 'POST');
  assert.equal(r.calls[1].body.touser, 'XiChunZhi');
  assert.equal(r.calls[1].body.agentid, 1000002);
  assert.equal(r.calls[1].body.msgtype, 'text');
  assert.deepEqual(r.calls[1].body.text, { content: '回写内容' });
});

test('企微真实发送：access_token 命中缓存时只请求一次 send', async () => {
  const calls = await withFetchStub([
    { errcode: 0, access_token: 'wx-token-cached', expires_in: 7200 },
    { errcode: 0, msgid: 1 },
  ], async (c) => {
    await wecomConnector.send(unified());
    await wecomConnector.send(unified());
    return c;
  });
  assert.equal(calls.length, 3, '1 次 gettoken + 2 次 send');
  assert.match(calls[2].url, /access_token=wx-token-cached/);
});

test('企微真实发送：errcode 非 0 抛错而不是静默成功', async () => {
  await withFetchStub([
    { errcode: 0, access_token: 'wx-token-2', expires_in: 7200 },
    { errcode: 60020, errmsg: 'not allow to access from your ip', invaliduser: 'XiChunZhi' },
  ], async () => {
    await assert.rejects(() => wecomConnector.send(unified()), /60020.*invaliduser=XiChunZhi/);
  });
});

test('企微真实发送：换 token 失败抛错，不再打 send', async () => {
  const seen = await withFetchStub([{ errcode: 40013, errmsg: 'invalid corpid' }], async (calls) => {
    await assert.rejects(() => wecomConnector.send(unified()), /access_token 获取失败.*40013/);
    return calls.length;
  });
  assert.equal(seen, 1);
});

test('企微真实发送：缺 agentId / 缺接收人先抛错，不发请求', async () => {
  const savedAgent = config.platforms.wecom.agentId;
  config.platforms.wecom.agentId = '';
  let calls = await withFetchStub([{ errcode: 0, msgid: 1 }], async (c) => {
    await assert.rejects(() => wecomConnector.send(unified()), /WECOM_AGENT_ID/);
    return c.length;
  });
  assert.equal(calls, 0);
  config.platforms.wecom.agentId = savedAgent;

  calls = await withFetchStub([{ errcode: 0, msgid: 1 }], async (c) => {
    await assert.rejects(() => wecomConnector.send(unified({ sender: { id: 'unknown', name: 'unknown' } })), /touser/);
    return c.length;
  });
  assert.equal(calls, 0);
});

// ---------- HTTP：GET 握手 / POST 回调 ----------

test('GET /api/webhook/wecom：返回解密后的 echostr 明文', async () => {
  const echostrPlain = 'str6suwn9bjfFwKN8cP0Zd9中文-回环';
  const ts = nowTs();
  const encrypted = wecomEncrypt(AES_KEY, echostrPlain, CORP_ID);
  const qs = new URLSearchParams({
    msg_signature: wecomSign(TOKEN, ts, NONCE, encrypted),
    timestamp: ts,
    nonce: NONCE,
    echostr: encrypted,
  });

  const res = await fetch(`${base}/api/webhook/wecom?${qs.toString()}`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), echostrPlain, '企微要求原样回明文');

  // 签名被篡改 → 拒绝握手
  const tampered = new URLSearchParams(qs);
  tampered.set('timestamp', String(Number(ts) + 5));
  const bad = await fetch(`${base}/api/webhook/wecom?${tampered.toString()}`);
  assert.equal(bad.status, 400);
});

test('POST /api/webhook/wecom：XML 密文回调验签入库并回 success', async () => {
  const ts = nowTs();
  const encrypted = wecomEncrypt(AES_KEY, INNER_XML, CORP_ID);
  const qs = new URLSearchParams({
    msg_signature: wecomSign(TOKEN, ts, NONCE, encrypted),
    timestamp: ts,
    nonce: NONCE,
  });

  const res = await fetch(`${base}/api/webhook/wecom?${qs.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'text/xml' },
    body: envelope(encrypted),
  });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'success');

  const saved = repo.list({ platform: Platform.WECOM }).find((m) => m.externalId === '4365213456');
  assert.ok(saved, '回调应落成统一消息');
  assert.equal(saved!.body, '周五前交周报');
  assert.equal(saved!.sender.id, 'XiChunZhi');
  assert.equal(saved!.status, MsgStatus.RECEIVED);

  // 同一条消息换个坏签名再推 → 401，不落库
  const forged = new URLSearchParams({ msg_signature: 'b'.repeat(40), timestamp: nowTs(), nonce: NONCE });
  const rejected = await fetch(`${base}/api/webhook/wecom?${forged.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'text/xml' },
    body: envelope(encrypted),
  });
  assert.equal(rejected.status, 401);
});

test('POST /api/webhook/wecom：receiveId 与 corpId 不符的密文被 400 拒绝', async () => {
  const ts = nowTs();
  const encrypted = wecomEncrypt(AES_KEY, INNER_XML, OTHER_CORP);
  const qs = new URLSearchParams({
    msg_signature: wecomSign(TOKEN, ts, NONCE, encrypted),
    timestamp: ts,
    nonce: NONCE,
  });
  const res = await fetch(`${base}/api/webhook/wecom?${qs.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'text/xml' },
    body: envelope(encrypted),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /receiveId/);
});
