/**
 * 邮箱轮询水位单测（完全不联网，fetch/ingest 全部注入）：
 *  - 首轮只立基线、不取正文；
 *  - 单轮 >20 封时继续分批追平，水位只推进到「实际处理到的最后一封」，绝不按 maxUid 跳变；
 *  - 默认最多追 MAX_BATCHES 批，剩下的留到下一轮；重复邮件不重复计数但水位照常推进；
 *  - 取信失败时水位停在缺口前；
 *  - UIDVALIDITY：旧格式状态兼容、目录清空/重建（UIDVALIDITY 变化）时重置水位不漏信；
 *  - 状态文件：原子写（临时文件 + rename）、缺失/损坏回退、默认路径不受 cwd 影响。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  PER_ROUND,
  MAX_BATCHES,
  STATE_FILE_ENV,
  STATE_FILE_NAME,
  defaultStateFile,
  resolveStateFile,
  loadWatermarkState,
  saveWatermarkState,
  pollMailFolder,
  type MailFetchBatch,
  type MailFetchFn,
} from './mailPoller';
import type { MailAccount } from '../config';
import type { MailRaw } from '../connectors/mail/mail';

const ACCOUNT: MailAccount = {
  key: 'qq', label: 'QQ邮箱', address: 'me@qq.com', authCode: 'auth-code', provider: 'qq',
  imapHost: 'imap.qq.com', imapPort: 993, imapSecure: true,
  smtpHost: 'smtp.qq.com', smtpPort: 465, smtpSecure: true,
  folders: ['INBOX'],
};

function rawMail(uid: number): Buffer {
  return Buffer.from(
    [
      `From: sender${uid}@example.com`,
      'To: me@qq.com',
      `Subject: mail ${uid}`,
      `Message-ID: <m${uid}@example.com>`,
      '',
      `body ${uid}`,
    ].join('\r\n'),
    'utf8',
  );
}

interface FetchSpy {
  fetch: MailFetchFn;
  calls: (number | null)[];
}

/** 假取信：从固定 UID 列表里按 sinceUid/limit 切片；maxUid 故意给大值验证「不拿它当水位」 */
function makeFetch(
  uids: number[],
  mailboxMax = uids.length > 0 ? uids[uids.length - 1] : 0,
  uidValidity?: number,
): FetchSpy {
  const calls: (number | null)[] = [];
  const fetch: MailFetchFn = async (sinceUid, limit) => {
    calls.push(sinceUid);
    const fresh = sinceUid === null ? [] : uids.filter((u) => u > sinceUid).slice(0, limit);
    const batch: MailFetchBatch = { mails: fresh.map((uid) => ({ uid, raw: rawMail(uid) })), maxUid: mailboxMax };
    if (uidValidity !== undefined) batch.uidValidity = uidValidity;
    return batch;
  };
  return { fetch, calls };
}

interface IngestSpy {
  ingest: (raw: MailRaw) => Promise<{ duplicate: boolean }>;
  uids: number[];
}

/** 假入库：记录处理过的 UID；duplicate 名单里的邮件不计数（模拟 externalId 幂等去重） */
function makeIngest(duplicates: number[] = []): IngestSpy {
  const skip = new Set(duplicates);
  const uids: number[] = [];
  return {
    uids,
    ingest: async (raw: MailRaw) => {
      uids.push(raw.uid);
      return { duplicate: skip.has(raw.uid) };
    },
  };
}

/** 每个用例独立临时目录，结束即删 */
function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'linkhub-mail-state-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('轮询：首轮只立基线（含 UIDVALIDITY），不取正文也不入库', async () => {
  const { fetch, calls } = makeFetch([], 5000, 777);
  const spy = makeIngest();

  const r = await pollMailFolder({ account: ACCOUNT, folder: 'INBOX', last: undefined, fetch, ingest: spy.ingest });

  assert.deepEqual(calls, [null], '首轮只能带 sinceUid=null 问一次最大 UID');
  assert.equal(r.baseline, true);
  assert.deepEqual(r.watermark, { uid: 5000, uidvalidity: 777 });
  assert.equal(r.added, 0);
  assert.equal(r.fetched, 0);
  assert.deepEqual(spy.uids, [], '历史邮件绝不能入库');
});

test('轮询：单轮来 25 封时继续分批追平，水位停在实际最后一封而不是 maxUid', async () => {
  const uids = Array.from({ length: 25 }, (_v, i) => 101 + i); // 101..125
  const { fetch, calls } = makeFetch(uids, 9999, 11); // maxUid 故意远大于真实新信
  const spy = makeIngest();

  const r = await pollMailFolder({ account: ACCOUNT, folder: 'INBOX', last: { uid: 100 }, fetch, ingest: spy.ingest });

  assert.deepEqual(calls, [100, 120], '取满 PER_ROUND 后必须接着取下一批');
  assert.equal(r.batches, 2);
  assert.equal(r.fetched, 25, '25 封必须全部取回，不能被 20 封上限截断');
  assert.equal(r.added, 25);
  assert.deepEqual(r.watermark, { uid: 125, uidvalidity: 11 }, '水位只能到实际处理到的 125，不能跳到 maxUid=9999');
  assert.deepEqual(spy.uids, uids);
});

test('轮询：默认最多追 MAX_BATCHES 批，剩下的留到下一轮继续', async () => {
  const uids = Array.from({ length: 200 }, (_v, i) => 1 + i); // 1..200
  const { fetch } = makeFetch(uids, 9999, 5);
  const spy = makeIngest();

  const first = await pollMailFolder({ account: ACCOUNT, folder: 'INBOX', last: { uid: 0 }, fetch, ingest: spy.ingest });
  assert.equal(first.batches, MAX_BATCHES, '单轮必须封顶，防止爆量时轮询失控');
  assert.equal(first.fetched, PER_ROUND * MAX_BATCHES);
  assert.equal(first.watermark.uid, PER_ROUND * MAX_BATCHES);

  const second = await pollMailFolder({ account: ACCOUNT, folder: 'INBOX', last: first.watermark, fetch, ingest: spy.ingest });
  assert.equal(second.watermark.uid, 200, '下一轮必须从上次水位继续追平，不能漏信');
  assert.equal(spy.uids.length, 200);
});

test('轮询：重复邮件不计入 added，但水位照常推进', async () => {
  const { fetch } = makeFetch([7, 8, 9], 9);
  const spy = makeIngest([8]);
  const notified: number[] = [];

  const r = await pollMailFolder({
    account: ACCOUNT,
    folder: 'INBOX',
    last: { uid: 6 },
    fetch,
    ingest: spy.ingest,
    onMail: (raw) => notified.push(raw.uid),
  });

  assert.equal(r.added, 2, '重复的 UID=8 不该重复计数');
  assert.equal(r.watermark.uid, 9);
  assert.deepEqual(spy.uids, [7, 8, 9], '重复邮件也要交给 ingest 走幂等判断');
  assert.deepEqual(notified, [7, 9], '只有新入库的邮件才触发逐封日志');
});

test('轮询：没有新信时水位保持不动', async () => {
  const { fetch, calls } = makeFetch([1, 2], 2);
  const spy = makeIngest();

  const r = await pollMailFolder({ account: ACCOUNT, folder: 'INBOX', last: { uid: 5 }, fetch, ingest: spy.ingest });

  assert.deepEqual(calls, [5]);
  assert.equal(r.watermark.uid, 5);
  assert.equal(r.fetched, 0);
  assert.equal(r.added, 0);
  assert.equal(r.batches, 1);
});

test('轮询：perRound / maxBatches 可配置（小批量回归不受默认值影响）', async () => {
  const uids = [1, 2, 3, 4, 5, 6];
  const { fetch, calls } = makeFetch(uids, 6);
  const spy = makeIngest();

  const r = await pollMailFolder({ account: ACCOUNT, folder: '已发送', last: { uid: 0 }, perRound: 2, maxBatches: 2, fetch, ingest: spy.ingest });

  assert.deepEqual(calls, [0, 2]);
  assert.equal(r.batches, 2);
  assert.equal(r.watermark.uid, 4);
  assert.equal(r.fetched, 4);
});

test('轮询：个别邮件取信失败时水位停在缺口前，下一轮补齐（不越过缺口漏信）', async () => {
  // 第一轮：UID 101 取信失败，102 成功；水位必须回退到 100，下一轮从缺口重试
  const firstBatch = { mails: [{ uid: 102, raw: rawMail(102) }], maxUid: 9999, failedUids: [101] };
  const secondBatch = {
    mails: [101, 102, 103].map((uid) => ({ uid, raw: rawMail(uid) })),
    maxUid: 9999,
  };
  const queue = [firstBatch, secondBatch];
  const calls: (number | null)[] = [];
  const fetch: MailFetchFn = async (sinceUid) => {
    calls.push(sinceUid);
    return queue.shift() ?? { mails: [], maxUid: 9999 };
  };
  // 模拟真实幂等：第一次见到某 UID 算新邮件，重复处理时由 externalId 判重
  const seen = new Set<number>();
  const spy = {
    uids: [] as number[],
    ingest: async (raw: MailRaw) => {
      spy.uids.push(raw.uid);
      const duplicate = seen.has(raw.uid);
      seen.add(raw.uid);
      return { duplicate };
    },
  };

  const first = await pollMailFolder({ account: ACCOUNT, folder: 'INBOX', last: { uid: 100 }, fetch, ingest: spy.ingest });
  assert.equal(first.watermark.uid, 100, '不能推进到 102 而把失败的 101 永久跳过');
  assert.equal(first.added, 1);
  assert.equal(first.batches, 1);

  const second = await pollMailFolder({ account: ACCOUNT, folder: 'INBOX', last: first.watermark, fetch, ingest: spy.ingest });
  assert.equal(second.watermark.uid, 103, '缺口补齐后继续推进');
  assert.equal(second.added, 2, '101/103 新入库，102 幂等去重');
  assert.deepEqual(calls, [100, 100], '下一轮必须从缺口前重试');
  assert.deepEqual(spy.uids, [102, 101, 102, 103]);
});

// ---------------------------------------------------------------------------
// UIDVALIDITY：目录被清空/重建后 UID 重排，旧水位必须失效
// ---------------------------------------------------------------------------

test('轮询：旧数字格式水位（无 uidvalidity）拿到服务端 UIDVALIDITY 时补记，不重置、不重灌', async () => {
  const { fetch, calls } = makeFetch([101, 102], 102, 5);
  const spy = makeIngest();

  const r = await pollMailFolder({ account: ACCOUNT, folder: 'INBOX', last: { uid: 100 }, fetch, ingest: spy.ingest });

  assert.equal(r.reset, false, '旧格式兼容：没有 uidvalidity 不能误判成目录重建');
  assert.deepEqual(calls, [100], '必须从原水位继续，而不是从 0 重灌历史');
  assert.deepEqual(r.watermark, { uid: 102, uidvalidity: 5 });
  assert.equal(r.added, 2);
});

test('轮询：UIDVALIDITY 变化（目录清空/重建）时重置水位并重新导入，重建后的新信不能漏', async () => {
  // 旧记录 uid=100/uidvalidity=1；用户清空目录后新信 UID 从 1 重新开始、UIDVALIDITY=2。
  // 旧逻辑会永远用 uid>100 过滤，新信全漏；现在必须识别 UIDVALIDITY 变化并从 0 重拉。
  const calls: (number | null)[] = [];
  const fetch: MailFetchFn = async (sinceUid) => {
    calls.push(sinceUid);
    if (sinceUid === 100) {
      // 第一次仍按旧水位问：新目录里 UID 都 ≤100，所以没取到信，但 UIDVALIDITY 暴露了目录重建
      return { mails: [], maxUid: 50, uidValidity: 2 };
    }
    return { mails: [1, 2].map((uid) => ({ uid, raw: rawMail(uid) })), maxUid: 2, uidValidity: 2 };
  };
  const spy = makeIngest();
  const changes: Array<[number, number]> = [];

  const r = await pollMailFolder({
    account: ACCOUNT,
    folder: 'INBOX',
    last: { uid: 100, uidvalidity: 1 },
    fetch,
    ingest: spy.ingest,
    onUidValidityChange: (from, to) => changes.push([from, to]),
  });

  assert.equal(r.reset, true);
  assert.deepEqual(changes, [[1, 2]], '必须 warn 出 UIDVALIDITY 变化');
  assert.deepEqual(calls, [100, 0], '识别到重建后要从 0 重新拉，不能继续用旧水位');
  assert.deepEqual(spy.uids, [1, 2], '重建后到达的新信必须入库');
  assert.equal(r.added, 2);
  assert.deepEqual(r.watermark, { uid: 2, uidvalidity: 2 });
});

test('轮询：UIDVALIDITY 变化后继续分批追平（重建的大目录也不会只取一批）', async () => {
  const mails = Array.from({ length: 25 }, (_v, i) => 1 + i); // 重建后目录里 1..25
  const calls: (number | null)[] = [];
  const fetch: MailFetchFn = async (sinceUid) => {
    calls.push(sinceUid);
    if (sinceUid === 999) return { mails: [], maxUid: 25, uidValidity: 8 };
    const slice = mails.filter((uid) => uid > (sinceUid ?? 0)).slice(0, PER_ROUND);
    return { mails: slice.map((uid) => ({ uid, raw: rawMail(uid) })), maxUid: 25, uidValidity: 8 };
  };
  const spy = makeIngest();

  const r = await pollMailFolder({
    account: ACCOUNT,
    folder: 'INBOX',
    last: { uid: 999, uidvalidity: 7 },
    fetch,
    ingest: spy.ingest,
  });

  assert.equal(r.reset, true);
  assert.deepEqual(calls, [999, 0, 20], '重建后从 0 开始，并继续分批追平');
  assert.equal(r.watermark.uid, 25);
  assert.equal(r.added, 25);
});

// ---------------------------------------------------------------------------
// 状态文件
// ---------------------------------------------------------------------------

test('状态文件：缺失时回退空水位（首次运行属正常情况）', () => {
  withTempDir((dir) => {
    const r = loadWatermarkState(join(dir, 'not-exist.json'));
    assert.equal(r.exists, false);
    assert.equal(r.restored, 0);
    assert.equal(r.watermarks.size, 0);
    assert.equal(r.error, undefined);
  });
});

test('状态文件：原子写 + 往返恢复（uid + uidvalidity 都保留），临时文件不残留', () => {
  withTempDir((dir) => {
    const sub = join(dir, 'sub');
    const file = join(sub, STATE_FILE_NAME);
    saveWatermarkState(file, new Map([
      ['qq#INBOX', { uid: 42, uidvalidity: 21 }],
      ['163#已发送', { uid: 7 }],
    ]));

    assert.deepEqual(readdirSync(sub), [STATE_FILE_NAME], 'rename 后不能留下 *.tmp 临时文件');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
      '163#已发送': { uid: 7 },
      'qq#INBOX': { uid: 42, uidvalidity: 21 },
    });

    const loaded = loadWatermarkState(file);
    assert.equal(loaded.exists, true);
    assert.equal(loaded.restored, 2);
    assert.equal(loaded.error, undefined);
    assert.deepEqual(loaded.watermarks.get('qq#INBOX'), { uid: 42, uidvalidity: 21 });
    assert.deepEqual(loaded.watermarks.get('163#已发送'), { uid: 7 });
  });
});

test('状态文件：向后兼容旧数字格式（视为没有 uidvalidity）', () => {
  withTempDir((dir) => {
    const file = join(dir, 'legacy.json');
    writeFileSync(file, JSON.stringify({ 'qq#INBOX': 123, '163#已发送': 0 }), 'utf8');
    const r = loadWatermarkState(file);
    assert.equal(r.restored, 2);
    assert.deepEqual(r.watermarks.get('qq#INBOX'), { uid: 123 });
    assert.equal(r.watermarks.get('qq#INBOX')?.uidvalidity, undefined, '旧格式必须视为无 uidvalidity');
    assert.deepEqual(r.watermarks.get('163#已发送'), { uid: 0 });
  });
});

test('状态文件：损坏 JSON / 结构不对时带回原因并回退空水位', () => {
  withTempDir((dir) => {
    const badJson = join(dir, 'bad-json.json');
    writeFileSync(badJson, 'not-json{', 'utf8');
    const bad = loadWatermarkState(badJson);
    assert.equal(bad.exists, true);
    assert.equal(bad.restored, 0);
    assert.equal(bad.watermarks.size, 0);
    assert.match(bad.error ?? '', /JSON 解析失败/);

    const notObject = join(dir, 'not-object.json');
    writeFileSync(notObject, '[]', 'utf8');
    assert.match(loadWatermarkState(notObject).error ?? '', /不是 JSON 对象/);
  });
});

test('状态文件：个别非法值被忽略，合法水位照常恢复', () => {
  withTempDir((dir) => {
    const file = join(dir, 'partial.json');
    writeFileSync(file, JSON.stringify({
      'qq#INBOX': { uid: 42, uidvalidity: 21 },
      bad: 'x',
      neg: -3,
      float: 1.5,
    }), 'utf8');
    const r = loadWatermarkState(file);
    assert.equal(r.restored, 1);
    assert.deepEqual(r.watermarks.get('qq#INBOX'), { uid: 42, uidvalidity: 21 });
    assert.match(r.error ?? '', /3 条水位值非法/);
  });
});

test('状态文件：写不进去会抛错（轮询器负责 warn 兜底，不阻断轮询）', () => {
  withTempDir((dir) => {
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'x', 'utf8');
    assert.throws(() => saveWatermarkState(join(blocker, 'nested', 'state.json'), new Map([['qq#INBOX', { uid: 1 }]])));
  });
});

test('状态文件路径：默认落在 unimsg-connector 根（不受 cwd 影响），MAIL_STATE_FILE 可覆盖', () => {
  const def = defaultStateFile();
  assert.ok(def.endsWith(join('unimsg-connector', STATE_FILE_NAME)), `默认状态文件路径不对：${def}`);
  assert.equal(resolveStateFile({}), def);

  const custom = join(tmpdir(), 'custom-mail-state.json');
  assert.equal(resolveStateFile({ [STATE_FILE_ENV]: custom }), custom);
  assert.equal(resolveStateFile({ [STATE_FILE_ENV]: 'relative-mail-state.json' }), resolve('relative-mail-state.json'));
  assert.equal(resolveStateFile({ [STATE_FILE_ENV]: '   ' }), def, '空白的 MAIL_STATE_FILE 视为未设置');
});
