import { beforeEach, describe, expect, it } from 'vitest';
import { EmitterRealtime } from '../realtime';
import { MockApi } from './mockApi';
import { MsgStatus, Platform } from '../../types';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeApi() {
  const realtime = new EmitterRealtime();
  const api = new MockApi(realtime, { latency: 0, sendDelay: 5, syncDelay: 5, enrichDelay: 5 });
  return { realtime, api };
}

describe('MockApi', () => {
  let api: MockApi;
  let realtime: EmitterRealtime;

  beforeEach(() => {
    const ctx = makeApi();
    api = ctx.api;
    realtime = ctx.realtime;
  });

  it('三平台消息都能被列出，且按平台筛选正确', async () => {
    const all = await api.list();
    expect(all.length).toBeGreaterThanOrEqual(12);

    const feishu = await api.list({ platform: Platform.FEISHU });
    expect(feishu.length).toBeGreaterThan(0);
    expect(feishu.every((m) => m.platform === Platform.FEISHU)).toBe(true);

    const wecom = await api.list({ platform: Platform.WECOM });
    expect(wecom.length).toBeGreaterThan(0);
    expect(wecom.every((m) => m.platform === Platform.WECOM)).toBe(true);
  });

  it('关键字与「需人工确认」筛选', async () => {
    const hit = await api.list({ keyword: '周报' });
    expect(hit.length).toBeGreaterThan(0);

    const review = await api.list({ onlyReview: true });
    expect(review.length).toBeGreaterThan(0);
    expect(review.every((m) => m.needsReview)).toBe(true);
  });

  it('回复后状态 replied，异步推进到 sent → synced，并留下闭环日志', async () => {
    const [first] = await api.list();
    const ack = await api.reply(first.traceId, '收到，我会在截止前完成。');
    expect(ack.message.status).toBe(MsgStatus.REPLIED);
    expect(ack.taskId).toBe(first.traceId);

    await wait(40);
    const updated = await api.get(first.traceId);
    expect(updated?.status).toBe(MsgStatus.SYNCED);
    // Mock 回写必须如实标注投递方式：mode=mock，绝不伪装成真实平台回执
    expect(updated?.delivery?.mode).toBe('mock');
    expect(updated?.delivery?.at).toBeTruthy();

    const trace = await api.trace(first.traceId);
    const events = trace.log.map((e) => e.event);
    for (const event of ['received', 'intent', 'processing', 'replied', 'sent', 'synced']) {
      expect(events).toContain(event);
    }
    const sentEvent = trace.log.find((e) => e.event === 'sent' && e.detail?.includes('模拟发送'));
    expect(sentEvent).toBeTruthy();
  });

  it('演示「发送失败」分支会进入 failed 并累计失败指标', async () => {
    // 选一条尚未成功投递过的消息：失败后不应凭空出现 delivery
    const target = (await api.list()).find((m) => m.status === MsgStatus.RECEIVED);
    expect(target).toBeTruthy();
    const sentMockBefore = (await api.health()).sentMock ?? 0;
    api.armNextSendFailure();
    await api.reply(target!.traceId, '这条会失败');
    await wait(40);
    const updated = await api.get(target!.traceId);
    expect(updated?.status).toBe(MsgStatus.FAILED);
    // 失败不是成功投递：不写 delivery，也不累计模拟发送次数
    expect(updated?.delivery).toBeUndefined();
    const health = await api.health();
    expect(health.failed).toBeGreaterThan(0);
    expect(health.sentMock ?? 0).toBe(sentMockBefore);
  });

  it('账号状态含四类数据源与邮箱多账号，嵌套数据是深拷贝', async () => {
    const accounts = await api.accounts();
    expect(accounts.map((a) => a.platform)).toEqual([
      Platform.FEISHU,
      Platform.DINGTALK,
      Platform.WECOM,
      Platform.MAIL,
    ]);

    const mail = accounts.find((a) => a.platform === Platform.MAIL);
    expect(mail?.configured).toBe(true);
    expect(mail?.mode).toBe('real');
    expect(mail?.accounts?.length).toBeGreaterThanOrEqual(1);
    expect(mail?.accounts?.[0]).toMatchObject({
      key: 'qq',
      address: 'me@qq.com',
      imapHost: 'imap.qq.com',
      smtpHost: 'smtp.qq.com',
    });

    // 修改返回值不应污染种子数据（深拷贝）
    mail?.accounts?.[0]?.folders.push('Spam');
    const again = await api.accounts();
    expect(again.find((a) => a.platform === Platform.MAIL)?.accounts?.[0]?.folders).not.toContain('Spam');
  });

  it('Mock 模拟发送单独累计 sentMock', async () => {
    const before = (await api.health()).sentMock ?? 0;
    const [first] = await api.list();
    await api.reply(first.traceId, '收到');
    await wait(40);
    expect((await api.health()).sentMock).toBe(before + 1);
  });

  it('标记完成写入 done 与 done 事件', async () => {
    const todos = (await api.list({ type: 'todo' })).filter((m) => !m.done);
    const target = todos[0];
    const updated = await api.markDone(target.traceId);
    expect(updated.done).toBe(true);
    const trace = await api.trace(target.traceId);
    expect(trace.log.some((e) => e.event === 'done')).toBe(true);
  });

  it('模拟推送会发出 message.received 事件并进入列表', async () => {
    const before = (await api.list()).length;
    const events: string[] = [];
    realtime.subscribe((e) => events.push(e.type));
    const incoming = await api.simulateIncoming();
    expect(events).toContain('message.received');
    expect((await api.list()).length).toBe(before + 1);
    expect(incoming.status).toBe(MsgStatus.RECEIVED);
  });
});