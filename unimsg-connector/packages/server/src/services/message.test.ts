import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Platform, MsgStatus } from '@unimsg/shared';
import { InMemoryRepository } from '../db/repository';
import { connectors } from '../connectors/registry';
import { LlmService } from './llm';
import { OcrService } from './ocr';
import { RateLimiter } from './rateLimiter';
import { MessageService } from './message';
import { feishuSample, dingtalkSample } from '../connectors/samples';
import { sentBox } from '../connectors/base';

function makeSvc() {
  const repo = new InMemoryRepository();
  const svc = new MessageService(
    repo, connectors, new LlmService(), new OcrService(), new RateLimiter(3, 5), () => {},
  );
  return { repo, svc };
}
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));

test('ingest：同 externalId 重推幂等，不重复入库', async () => {
  const { svc, repo } = makeSvc();
  const a = await svc.ingest(Platform.FEISHU, feishuSample);
  const b = await svc.ingest(Platform.FEISHU, feishuSample);
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(repo.list().length, 1);
  assert.equal(a.message.traceId, b.message.traceId);
});

test('reply：走完状态机并真实回写（Mock）', async () => {
  const { svc, repo } = makeSvc();
  const { message } = await svc.ingest(Platform.FEISHU, feishuSample);
  const before = sentBox[Platform.FEISHU].length;
  const ack = await svc.reply(message.traceId, '收到，周五前交周报');
  assert.equal(ack.message.status, MsgStatus.REPLIED);
  await wait();
  const m = repo.get(message.traceId)!;
  assert.equal(m.status, MsgStatus.SYNCED);
  assert.equal(sentBox[Platform.FEISHU].length, before + 1);
  const events = repo.getLoopLog(message.traceId).map((e) => e.event);
  for (const ev of ['received', 'processing', 'replied', 'sent', 'synced']) {
    assert.ok(events.includes(ev), `missing trace: ${ev}`);
  }
});

test('syncStatus：平台回流更新本地状态', async () => {
  const { svc, repo } = makeSvc();
  const { message } = await svc.ingest(Platform.DINGTALK, dingtalkSample);
  await svc.syncStatus(message.traceId, 'synced');
  assert.equal(repo.get(message.traceId)!.status, MsgStatus.SYNCED);
});

test('markDone：待办标记完成', async () => {
  const { svc, repo } = makeSvc();
  const { message } = await svc.ingest(Platform.FEISHU, feishuSample);
  await svc.markDone(message.traceId);
  assert.equal(repo.get(message.traceId)!.done, true);
});
