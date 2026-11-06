import { describe, expect, it } from 'vitest';
import { INJECT_PLATFORMS, buildSample } from './demoSamples';
import { Platform } from '../types';

describe('空态注入样例', () => {
  it('只覆盖有 webhook 的三个平台（邮箱是 IMAP 轮询，不能假装能推）', () => {
    expect(INJECT_PLATFORMS).toEqual([Platform.FEISHU, Platform.DINGTALK, Platform.WECOM]);
    expect(INJECT_PLATFORMS).not.toContain(Platform.MAIL);
  });

  it('飞书按 2.0 事件格式、正文是 JSON 字符串', () => {
    const { path, body } = buildSample(Platform.FEISHU, 0);
    expect(path).toBe('/api/webhook/feishu');
    const event = (body as { event: { message: Record<string, unknown> } }).event.message;
    expect(event.message_type).toBe('text');
    expect(typeof event.content).toBe('string');
    expect(JSON.parse(event.content as string)).toHaveProperty('text');
  });

  it('钉钉/企微按各自的字段名发送', () => {
    const ding = buildSample(Platform.DINGTALK, 0).body as Record<string, unknown>;
    expect(ding).toMatchObject({ msgtype: 'text' });
    expect((ding.text as { content: string }).content.length).toBeGreaterThan(0);

    const wecom = buildSample(Platform.WECOM, 0).body as Record<string, unknown>;
    expect(wecom).toMatchObject({ MsgType: 'text' });
    expect(String(wecom.Content).length).toBeGreaterThan(0);
  });

  it('messageId 不重复，避免被服务端幂等去重吃掉', () => {
    const a = buildSample(Platform.FEISHU, 0).body as {
      event: { message: { message_id: string } };
    };
    const b = buildSample(Platform.FEISHU, 1).body as {
      event: { message: { message_id: string } };
    };
    expect(a.event.message.message_id).not.toBe(b.event.message.message_id);
  });

  it('样例会轮转，连续注入不会都是同一条', () => {
    const first = JSON.stringify(buildSample(Platform.FEISHU, 0).body);
    const second = JSON.stringify(buildSample(Platform.FEISHU, 1).body);
    expect(first).not.toBe(second);
  });
});
