/**
 * 真实适配器单测：加解密、签名校验、发送请求形状。
 * 不触网：fetch 全部打桩，凭据用测试值覆盖。
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Platform, MsgStatus } from '@unimsg/shared';
import { config } from '../config';
import { feishuConnector } from './feishu';
import { dingtalkConnector } from './dingtalk';
import { feishuEncrypt, dingtalkEncrypt, dingtalkSign } from './crypto';
import { resetTokenCache } from './real';

const origFetch = globalThis.fetch;
const origMock = config.mock;

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

before(() => {
  config.mock = false;
  config.platforms.feishu.appId = 'cli_test';
  config.platforms.feishu.appSecret = 'secret_test';
  config.platforms.feishu.verifyToken = 'verify_test';
  config.platforms.feishu.encryptKey = 'encrypt_test_key_1234567890abcd';
  config.platforms.dingtalk.appKey = 'ding_test';
  config.platforms.dingtalk.appSecret = 'ding_secret_test';
  config.platforms.dingtalk.robotCode = 'robot_test';
  config.platforms.dingtalk.aesToken = 'aes_token_test';
  config.platforms.dingtalk.aesKey = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY';
});

after(() => {
  globalThis.fetch = origFetch;
  config.mock = origMock;
  resetTokenCache();
});

beforeEach(() => {
  resetTokenCache();
});

test('飞书 AES 解密：本地加密后能还原并识别 challenge', () => {
  const plain = JSON.stringify({ type: 'url_verification', challenge: 'c-123', token: 'verify_test' });
  const encrypted = feishuEncrypt(config.platforms.feishu.encryptKey, plain);
  const decoded = feishuConnector.decrypt?.({ encrypt: encrypted }) as any;
  assert.equal(decoded.challenge, 'c-123');
  assert.deepEqual(feishuConnector.challenge?.(decoded), { challenge: 'c-123' });
});

test('飞书验签：token 匹配通过，错误 token 拒绝', () => {
  assert.equal(feishuConnector.verify({ header: { token: 'verify_test' } }, ''), true);
  assert.equal(feishuConnector.verify({ header: { token: 'wrong' } }, ''), false);
  assert.equal(feishuConnector.verify({}, ''), false);
});

test('飞书 receive：v2 事件带出 conversation', () => {
  const msg = feishuConnector.receive({
    schema: '2.0',
    header: { event_type: 'im.message.receive_v1' },
    event: {
      message: {
        message_id: 'om_1',
        chat_id: 'oc_1',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: '周五前交周报' }),
        sender: { sender_id: { user_id: 'u_1' } },
      },
    },
  });
  assert.equal(msg.conversation?.id, 'oc_1');
  assert.equal(msg.conversation?.type, 'group');
  assert.equal(msg.externalId, 'om_1');
  assert.equal(msg.type, 'todo');
});

test('飞书真实发送：换取 tenant_access_token 并调用 im/v1/messages', async () => {
  const calls = stubFetch([
    { code: 0, tenant_access_token: 't-123', expire: 7200 },
    { code: 0, data: { message_id: 'om_sent_1' } },
  ]);
  const msg = {
    traceId: 't1',
    platform: Platform.FEISHU,
    externalId: 'om_1',
    sender: { id: 'u_1', name: 'u_1' },
    conversation: { id: 'oc_1', type: 'group' as const },
    type: 'text' as const,
    body: '原文',
    reply: '回写内容',
    status: MsgStatus.REPLIED,
    createdAt: '',
    updatedAt: '',
  };
  const r = await feishuConnector.send(msg);
  assert.equal(r.ok, true);
  assert.equal(r.platformReply, 'om_sent_1');
  assert.match(calls[0].url, /tenant_access_token\/internal$/);
  assert.deepEqual(calls[0].body, { app_id: 'cli_test', app_secret: 'secret_test' });
  assert.match(calls[1].url, /im\/v1\/messages\?receive_id_type=chat_id$/);
  assert.equal(calls[1].body.receive_id, 'oc_1');
  assert.equal(calls[1].body.msg_type, 'text');
  assert.deepEqual(JSON.parse(calls[1].body.content), { text: '回写内容' });
  assert.equal((calls[1].init.headers as any).Authorization, 'Bearer t-123');
});

test('飞书真实发送：没有会话时抛错而不是静默失败', async () => {
  const msg: any = {
    traceId: 't2', platform: Platform.FEISHU, externalId: 'om_2',
    sender: { id: 'u_1', name: 'u_1' }, type: 'text', body: 'x', status: MsgStatus.REPLIED,
    createdAt: '', updatedAt: '',
  };
  await assert.rejects(() => feishuConnector.send(msg), /conversation\.id/);
});

test('钉钉签名：正确签名通过，篡改时间戳拒绝', () => {
  const ts = String(Date.now());
  const sign = dingtalkSign('aes_token_test', ts, config.platforms.dingtalk.aesKey);
  assert.equal(dingtalkConnector.verify({}, '', { timestamp: ts, sign }), true);
  assert.equal(dingtalkConnector.verify({}, '', { timestamp: String(Date.now() - 2 * 3600_000), sign }), false);
  assert.equal(dingtalkConnector.verify({}, '', { timestamp: ts, sign: 'bad' }), false);
});

test('钉钉 AES 解密：32 字节块填充可还原', () => {
  const plain = JSON.stringify({ msgId: 'm1', text: { content: '周报' }, conversationId: 'cid1', conversationType: '2' });
  const encrypted = dingtalkEncrypt(config.platforms.dingtalk.aesKey, plain);
  const decoded = dingtalkConnector.decrypt?.({ encrypt: encrypted }) as any;
  assert.equal(decoded.msgId, 'm1');
  assert.equal(decoded.conversationId, 'cid1');
});

test('钉钉 receive：群会话与发送者映射', () => {
  const msg = dingtalkConnector.receive({
    msgId: 'm1', msgtype: 'text', text: { content: '周五前交周报' },
    senderId: 'u1', senderStaffId: 'staff1', senderNick: '小王',
    conversationId: 'cid1', conversationType: '2',
  });
  assert.equal(msg.sender.id, 'staff1');
  assert.equal(msg.sender.name, '小王');
  assert.equal(msg.conversation?.id, 'cid1');
  assert.equal(msg.conversation?.type, 'group');
});

test('钉钉真实发送：群消息走 groupMessages/send', async () => {
  const calls = stubFetch([
    { accessToken: 'd-123', expireIn: 7200 },
    { processQueryKey: 'pqk_1' },
  ]);
  const msg: any = {
    traceId: 't3', platform: Platform.DINGTALK, externalId: 'm1',
    sender: { id: 'staff1', name: '小王' },
    conversation: { id: 'cid1', type: 'group' },
    type: 'text', body: '原文', reply: '回写内容', status: MsgStatus.REPLIED,
    createdAt: '', updatedAt: '',
  };
  const r = await dingtalkConnector.send(msg);
  assert.equal(r.ok, true);
  assert.equal(r.platformReply, 'pqk_1');
  assert.match(calls[0].url, /oauth2\/accessToken$/);
  assert.deepEqual(calls[0].body, { appKey: 'ding_test', appSecret: 'ding_secret_test' });
  assert.match(calls[1].url, /robot\/groupMessages\/send$/);
  assert.equal(calls[1].body.robotCode, 'robot_test');
  assert.equal(calls[1].body.openConversationId, 'cid1');
  assert.equal(calls[1].body.msgKey, 'sampleText');
  assert.deepEqual(JSON.parse(calls[1].body.msgParam), { content: '回写内容' });
  assert.equal((calls[1].init.headers as any)['x-acs-dingtalk-access-token'], 'd-123');
});

test('钉钉真实发送：单聊走 oToMessages/batchSend', async () => {
  const calls = stubFetch([
    { accessToken: 'd-123', expireIn: 7200 },
    { processQueryKey: 'pqk_2' },
  ]);
  const msg: any = {
    traceId: 't4', platform: Platform.DINGTALK, externalId: 'm2',
    sender: { id: 'staff1', name: '小王' },
    conversation: { id: 'cid2', type: 'p2p' },
    type: 'text', body: '原文', reply: '回写内容', status: MsgStatus.REPLIED,
    createdAt: '', updatedAt: '',
  };
  await dingtalkConnector.send(msg);
  assert.match(calls[1].url, /robot\/oToMessages\/batchSend$/);
  assert.deepEqual(calls[1].body.userIds, ['staff1']);
  assert.equal(calls[1].body.openConversationId, undefined);
});
