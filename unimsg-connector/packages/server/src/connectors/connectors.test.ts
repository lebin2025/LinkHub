/**
 * 连接器单测（node:test，无需额外依赖）。
 * 覆盖文档要求：样例事件解析、统一格式映射、Mock 验签与回写记录。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Platform, MsgStatus } from '@unimsg/shared';
import { feishuConnector } from './feishu';
import { dingtalkConnector } from './dingtalk';
import { wecomConnector } from './wecom';
import { sentBox } from './base';
import { feishuSample, dingtalkSample, wecomSample } from './samples';

test('飞书样例事件 -> 统一消息（待办高亮 + 字段正确）', () => {
  const msg = feishuConnector.receive(feishuSample);
  assert.equal(msg.platform, Platform.FEISHU);
  assert.equal(msg.status, MsgStatus.RECEIVED);
  assert.equal(msg.body, '周五前交周报');
  assert.equal(msg.type, 'todo'); // "周报" 命中待办关键词
  assert.equal(msg.sender.id, 'u_feishu_demo');
});

test('钉钉样例事件 -> 统一消息（保留昵称）', () => {
  const msg = dingtalkConnector.receive(dingtalkSample);
  assert.equal(msg.platform, Platform.DINGTALK);
  assert.equal(msg.body, '周五前交周报');
  assert.equal(msg.sender.name, '钉钉小王');
});

test('企业微信样例事件 -> 统一消息', () => {
  const msg = wecomConnector.receive(wecomSample);
  assert.equal(msg.platform, Platform.WECOM);
  assert.equal(msg.body, '周五前交周报');
});

test('convert 把统一消息映射回平台发送格式', () => {
  const base = wecomConnector.receive(wecomSample);
  const out = wecomConnector.convert(base) as any;
  assert.equal(out.text.content, '周五前交周报');
});

test('Mock 模式验签通过，回写落入 sentBox', async () => {
  assert.equal(feishuConnector.verify({}, 'mock'), true);
  const msg = feishuConnector.receive(feishuSample); // 先拿到真正的统一消息
  const before = sentBox[Platform.FEISHU].length;
  const r = await feishuConnector.send(msg);
  assert.equal(r.ok, true);
  assert.equal(sentBox[Platform.FEISHU].length, before + 1);
});
