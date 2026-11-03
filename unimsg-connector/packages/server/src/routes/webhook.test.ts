/**
 * Webhook HTTP 级加固测试（node:http + 127.0.0.1 回环，绝不触网）：
 *  1. 空 body / 空 XML 壳 / 缺消息 ID → 400，且不写 trace、不占幂等键（P0）；
 *  2. 正常三平台样例仍 200，返回体形状保持 `{ok:true,duplicate}` / 企微明文 `success`；
 *  3. 状态回流前进 → 200 更新；倒退 → 仍 200 但状态不动并写 `sync_ignored`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Platform, MsgStatus } from '@unimsg/shared';
import { createApp } from '../app';
import { config } from '../config';
import { InMemoryRepository } from '../db/repository';
import { connectors } from '../connectors/registry';
import { LlmService } from '../services/llm';
import { OcrService } from '../services/ocr';
import { RateLimiter } from '../services/rateLimiter';
import { MessageService } from '../services/message';
import { feishuSample, dingtalkSample, wecomSample } from '../connectors/samples';

// 富化阶段锁死本地 Mock，保证 HTTP 用例不外呼
config.llm.provider = 'mock';
config.ocr.provider = 'mock';

interface Ctx {
  repo: InMemoryRepository;
  svc: MessageService;
  base: string;
}

interface Reply {
  status: number;
  text: string;
  json: any;
}

/** 每个用例独立 app + 空仓储，避免用例间计数/幂等键互相污染 */
async function withApp(fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  const repo = new InMemoryRepository();
  const svc = new MessageService(
    repo, connectors, new LlmService(), new OcrService(), new RateLimiter(3, 5), () => {},
  );
  // corsOrigins=null：显式关闭白名单，聚焦本文件的 webhook 行为
  const server = http.createServer(createApp(svc, { corsOrigins: null }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await fn({ repo, svc, base });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function post(base: string, path: string, body: string | undefined, contentType = 'application/json'): Promise<Reply> {
  const init: RequestInit = { method: 'POST' };
  if (contentType) init.headers = { 'content-type': contentType };
  if (body !== undefined) init.body = body;
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, text, json };
}

const json = (value: unknown): string => JSON.stringify(value);

// ---------- 空 / 畸形事件 ----------

test('空 body / 空对象：三平台一律 400，且不写任何消息、不占 unknown 幂等键', async () => {
  await withApp(async ({ base, repo }) => {
    for (const platform of ['feishu', 'dingtalk', 'wecom']) {
      const noBody = await post(base, `/api/webhook/${platform}`, undefined);
      assert.equal(noBody.status, 400, `${platform} 无 body 必须 400`);
      assert.equal(noBody.json?.ok, false, `${platform} 空 body 应回 JSON {ok:false}`);

      const emptyObject = await post(base, `/api/webhook/${platform}`, '{}');
      assert.equal(emptyObject.status, 400, `${platform} {} 必须 400`);
      assert.equal(emptyObject.json?.ok, false);
    }
    assert.equal(repo.list().length, 0, '空事件绝不能入库');
    for (const platform of [Platform.FEISHU, Platform.DINGTALK, Platform.WECOM]) {
      assert.equal(repo.findByExternal(platform, 'unknown'), undefined, `${platform} unknown 去重键必须空闲`);
    }
  });
});

test('企业微信 XML 空壳：400 且绝不返回 success（mock 验签也不能放行进库）', async () => {
  await withApp(async ({ base, repo }) => {
    const emptyShell = await post(base, '/api/webhook/wecom', '<xml></xml>', 'text/xml');
    assert.equal(emptyShell.status, 400);
    assert.notEqual(emptyShell.text, 'success', '空壳不能回 success，否则企微认为已处理');
    assert.equal(emptyShell.json?.ok, false);

    const blank = await post(base, '/api/webhook/wecom', '   ', 'text/plain');
    assert.equal(blank.status, 400);
    assert.equal(repo.list().length, 0);
  });
});

test('缺消息唯一 ID：飞书/钉钉/企微 400 且不写 trace；随后正常消息仍能入库', async () => {
  await withApp(async ({ base, repo }) => {
    const feishuNoId = {
      schema: '2.0',
      event: {
        message: {
          message_type: 'text',
          content: json({ text: '没有消息 ID' }),
          sender: { sender_id: { user_id: 'u_no_id' } },
        },
      },
    };
    const feishu = await post(base, '/api/webhook/feishu', json(feishuNoId));
    assert.equal(feishu.status, 400);
    assert.match(String(feishu.json?.error), /externalId/);

    const dingtalk = await post(base, '/api/webhook/dingtalk', json({
      msgtype: 'text', text: { content: '没有消息 ID' }, senderId: 'u_no_id',
    }));
    assert.equal(dingtalk.status, 400);

    const wecom = await post(base, '/api/webhook/wecom', json({ MsgType: 'text', Content: '没有消息 ID' }));
    assert.equal(wecom.status, 400);

    assert.equal(repo.list().length, 0, '畸形事件不得写消息/幂等表');
    assert.equal(repo.findByExternal(Platform.FEISHU, 'unknown'), undefined);
    assert.equal(repo.findByExternal(Platform.DINGTALK, 'unknown'), undefined);

    // 幂等键没有被占死：同平台随后的真实消息正常入库
    const ok = await post(base, '/api/webhook/feishu', json(feishuSample));
    assert.equal(ok.status, 200);
    assert.equal(ok.json?.ok, true);
    assert.equal(repo.list().length, 1);
  });
});

test('畸形 JSON：400 可读 JSON 错误，而不是 Express 默认 HTML 栈', async () => {
  await withApp(async ({ base }) => {
    const res = await post(base, '/api/webhook/feishu', '{"broken": ');
    assert.equal(res.status, 400);
    assert.equal(res.json?.ok, false);
    assert.match(String(res.json?.error), /JSON/);
  });
});

// ---------- 正常样例：行为与返回形状不能变 ----------

test('正常飞书样例：200 {ok:true,duplicate:false}，重推幂等 duplicate:true', async () => {
  await withApp(async ({ base, repo }) => {
    const first = await post(base, '/api/webhook/feishu', json(feishuSample));
    assert.equal(first.status, 200);
    assert.deepEqual({ ok: first.json?.ok, duplicate: first.json?.duplicate }, { ok: true, duplicate: false });

    const again = await post(base, '/api/webhook/feishu', json(feishuSample));
    assert.equal(again.status, 200);
    assert.equal(again.json?.duplicate, true, '幂等语义保持不变');
    assert.equal(repo.list().length, 1);

    const saved = repo.findByExternal(Platform.FEISHU, 'om_demo_001');
    assert.ok(saved);
    assert.equal(saved!.body, '周五前交周报');
  });
});

test('正常钉钉样例：200 {ok:true}', async () => {
  await withApp(async ({ base, repo }) => {
    const res = await post(base, '/api/webhook/dingtalk', json(dingtalkSample));
    assert.equal(res.status, 200);
    assert.equal(res.json?.ok, true);
    assert.ok(repo.findByExternal(Platform.DINGTALK, 'msg_demo_001'));
  });
});

test('正常企微明文样例：200 且回明文 success', async () => {
  await withApp(async ({ base, repo }) => {
    const res = await post(base, '/api/webhook/wecom', json(wecomSample));
    assert.equal(res.status, 200);
    assert.equal(res.text, 'success', '企微要求回调返回明文 success');
    const saved = repo.findByExternal(Platform.WECOM, 'wx_demo_001');
    assert.ok(saved);
    assert.equal(saved!.sender.id, 'user_wecom_demo');
  });
});

// ---------- 状态回流 ----------

test('状态回流（前进）：200 且消息状态更新', async () => {
  await withApp(async ({ base, repo }) => {
    await post(base, '/api/webhook/feishu', json(feishuSample));
    const msg = repo.findByExternal(Platform.FEISHU, 'om_demo_001')!;
    assert.equal(msg.status, MsgStatus.RECEIVED);

    const res = await post(base, '/api/webhook/feishu', json({
      event: 'status', traceId: msg.traceId, status: 'synced',
    }));
    assert.equal(res.status, 200);
    assert.equal(res.json?.ok, true);
    assert.equal(repo.get(msg.traceId)!.status, MsgStatus.SYNCED);
  });
});

test('状态回流（倒退）：仍 200，但保持 synced 并写 sync_ignored 说明原因', async () => {
  await withApp(async ({ base, repo }) => {
    await post(base, '/api/webhook/feishu', json(feishuSample));
    const msg = repo.findByExternal(Platform.FEISHU, 'om_demo_001')!;
    repo.update(msg.traceId, { status: MsgStatus.SYNCED });

    const res = await post(base, '/api/webhook/feishu', json({
      event: 'status', externalId: 'om_demo_001', status: 'received',
    }));
    assert.equal(res.status, 200, '防倒退是业务忽略，不能变成接口错误');
    assert.equal(res.json?.ok, true);
    assert.equal(repo.get(msg.traceId)!.status, MsgStatus.SYNCED, '状态不得倒退');

    const ignored = repo.getLoopLog(msg.traceId).find((e) => e.event === 'sync_ignored');
    assert.ok(ignored, '必须留下 sync_ignored 证据');
    assert.match(ignored!.detail ?? '', /倒退/);
  });
});
