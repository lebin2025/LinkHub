/**
 * 邮箱轮询器：IMAP 没有推送，只能定时拉。
 *
 * 首轮只记录每个账号的最大 UID 作为基线（不把历史邮件灌进中枢），
 * 之后每轮导入 UID 更大的新信。用 UID 水位而不是 \Seen 标记，
 * 是为了不去改动用户邮箱里的已读状态。
 *
 * 真实链路的三个加固点（都在这层收敛）：
 *  1) 突发来信：一批 PER_ROUND 封取满时，同一轮继续取下一批（最多 MAX_BATCHES 批），
 *     且水位只推进到「本轮实际处理到的最后一封 UID」——绝不拿 SEARCH 返回的 maxUid
 *     直接跳水位，否则一次来 >20 封时中间的信会被永久跳过；
 *  2) 重启续传：水位原子落盘到状态文件（默认 unimsg-connector/.mail-watermarks.json，
 *     env MAIL_STATE_FILE 覆盖；用 import.meta.url 解析默认路径，不受 cwd 影响），
 *     重启后从上次的位置继续收信，停机期间的新邮件不会因为重新立基线而漏掉；
 *  3) 目录重建：状态里同时记 SELECT 的 UIDVALIDITY。用户在网页端「清空/重建文件夹」后
 *     UID 会重排、UIDVALIDITY 会变，此时旧水位已失效，必须重置该目录水位并从头导入，
 *     否则会永久漏掉该目录的新邮件（旧格式状态文件没有 uidvalidity，读到后补记为当前值，不重置）。
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Platform } from '@unimsg/shared';
import { config, modeOf, type MailAccount } from '../config';
import { MessageService } from '../services/message';
import { readMessage } from '../connectors/mail/mime';
import { fetchNewMails, type ImapMail } from '../connectors/mail/imapClient';
import type { MailRaw } from '../connectors/mail/mail';

/** 单批取信上限：也是「本轮是否继续追」的阈值 */
export const PER_ROUND = 20;
/** 单轮最多追几批，防止邮箱爆量时本轮无限续跑、占住轮询 */
export const MAX_BATCHES = 5;

/** 状态文件环境变量名 */
export const STATE_FILE_ENV = 'MAIL_STATE_FILE';
/** 状态文件名 */
export const STATE_FILE_NAME = '.mail-watermarks.json';

/** 默认状态文件：从本文件位置解析到 unimsg-connector/ 根（不依赖启动时的 cwd） */
export function defaultStateFile(): string {
  return fileURLToPath(new URL(`../../../../${STATE_FILE_NAME}`, import.meta.url));
}

/** 状态文件路径：MAIL_STATE_FILE 可覆盖；相对路径按当前工作目录解析 */
export function resolveStateFile(env: NodeJS.ProcessEnv = process.env): string {
  const override = (env[STATE_FILE_ENV] ?? '').trim();
  if (!override) return defaultStateFile();
  return isAbsolute(override) ? override : resolve(override);
}

/**
 * 一个目录的 UID 水位。
 * uidvalidity 缺失 = 旧版状态文件（只有数字）或服务端没上报 SELECT UIDVALIDITY：
 * 此时只能沿用水位，等下一次拿到 UIDVALIDITY 时补记。
 */
export interface MailWatermark {
  uid: number;
  uidvalidity?: number;
}

export interface WatermarkSnapshot {
  /** `<账号key>#<目录>` → UID 水位 */
  watermarks: Map<string, MailWatermark>;
  /** 成功恢复的条数 */
  restored: number;
  /** 文件是否存在（false = 首次运行，属正常情况） */
  exists: boolean;
  /** 文件存在但读取/解析异常时的原因（用于启动日志），缺失时不设置 */
  error?: string;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 解析单条水位，兼容两种格式：
 *  - 新格式 `{ "uid": 123, "uidvalidity": 456 }`（uidvalidity 可省略）；
 *  - 旧格式 `123`（只有 UID，视为没有 uidvalidity，升级后第一次轮询补记、不重置）。
 */
function parseWatermark(value: unknown): MailWatermark | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? { uid: value } : undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  if (typeof obj.uid !== 'number' || !Number.isInteger(obj.uid) || obj.uid < 0) return undefined;
  const mark: MailWatermark = { uid: obj.uid };
  if (typeof obj.uidvalidity === 'number' && Number.isInteger(obj.uidvalidity) && obj.uidvalidity >= 0) {
    mark.uidvalidity = obj.uidvalidity;
  }
  return mark;
}

/**
 * 读取状态文件：文件缺失 → 空水位（首轮立基线）；
 * JSON 损坏 / 结构不对 → 带回 error（调用方 warn 后回退立基线）；
 * 个别值非法 → 忽略这些条目并带回 error，其余照常恢复。
 */
export function loadWatermarkState(file: string): WatermarkSnapshot {
  const watermarks = new Map<string, MailWatermark>();
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { watermarks, restored: 0, exists: false };
    return { watermarks, restored: 0, exists: true, error: `读取失败：${errMessage(e)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { watermarks, restored: 0, exists: true, error: `JSON 解析失败：${errMessage(e)}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { watermarks, restored: 0, exists: true, error: '内容不是 JSON 对象' };
  }

  let invalid = 0;
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const mark = parseWatermark(value);
    if (mark) watermarks.set(key, mark);
    else invalid += 1;
  }
  if (invalid > 0) return { watermarks, restored: watermarks.size, exists: true, error: `${invalid} 条水位值非法，已忽略` };
  return { watermarks, restored: watermarks.size, exists: true };
}

/** 原子写状态文件：先写同目录临时文件，再 rename 覆盖，避免进程中途退出留下半截 JSON */
export function saveWatermarkState(file: string, watermarks: Map<string, MailWatermark>): void {
  const payload: Record<string, MailWatermark> = {};
  for (const [key, mark] of [...watermarks.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    payload[key] = mark.uidvalidity === undefined ? { uid: mark.uid } : { uid: mark.uid, uidvalidity: mark.uidvalidity };
  }
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  try {
    renameSync(tmp, file);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* 临时文件清理失败不掩盖原始错误 */
    }
    throw e;
  }
}

export interface MailFetchBatch {
  mails: ImapMail[];
  /** 邮箱里当前最大 UID：只用于首轮立基线，追平阶段绝不拿它当水位 */
  maxUid: number;
  /** 这一批里取信失败的 UID：水位不能越过它们，下一轮重试（已入库的靠 externalId 幂等） */
  failedUids?: number[];
  /** SELECT 返回的 UIDVALIDITY：与本地记录不一致说明目录被清空/重建，UID 已重排 */
  uidValidity?: number;
}

/** 取信函数（生产是 fetchNewMails，单测可注入纯内存假实现） */
export type MailFetchFn = (sinceUid: number | null, limit: number) => Promise<MailFetchBatch>;

export interface PollMailFolderArgs {
  account: MailAccount;
  folder: string;
  /** undefined = 首次运行：只立基线，不取正文 */
  last: MailWatermark | undefined;
  fetch: MailFetchFn;
  ingest: (raw: MailRaw) => Promise<{ duplicate: boolean }>;
  /** 只对新入库（非重复）的邮件回调，用于逐封日志 */
  onMail?: (raw: MailRaw) => void;
  /** UIDVALIDITY 变化（目录被清空/重建）时回调，用于 warn 日志 */
  onUidValidityChange?: (from: number, to: number) => void;
  perRound?: number;
  maxBatches?: number;
}

export interface PollMailFolderResult {
  /** 本轮是否只是首轮立基线 */
  baseline: boolean;
  /** 本轮是否因 UIDVALIDITY 变化重置了水位（目录被清空/重建） */
  reset: boolean;
  /** 本轮结束后的 UID 水位 */
  watermark: MailWatermark;
  /** 新入库封数（去重后） */
  added: number;
  /** 本轮实际取回并尝试入库的封数 */
  fetched: number;
  /** 实际取了几批 */
  batches: number;
}

/**
 * 单目录一轮：首轮只立基线；否则分批取信并逐封推进水位。
 * fetch/ingest 全注入，所以单测能离线覆盖「>20 封不跳水位、分批追平、批数封顶、目录重建重置」。
 */
export async function pollMailFolder(args: PollMailFolderArgs): Promise<PollMailFolderResult> {
  const perRound = args.perRound ?? PER_ROUND;
  const maxBatches = args.maxBatches ?? MAX_BATCHES;

  // 首轮：只问最大 UID 立基线（顺便记下 UIDVALIDITY），绝不取正文、不灌历史
  if (args.last === undefined) {
    const batch = await args.fetch(null, perRound);
    const watermark: MailWatermark = { uid: Math.max(batch.maxUid, 0) };
    if (batch.uidValidity !== undefined) watermark.uidvalidity = batch.uidValidity;
    return { baseline: true, reset: false, watermark, added: 0, fetched: 0, batches: 1 };
  }

  const startUid = args.last.uid;
  let cursor = startUid;
  let uidValidity = args.last.uidvalidity;
  let reset = false;
  let added = 0;
  let fetched = 0;
  let batches = 0;

  for (let i = 0; i < maxBatches; i += 1) {
    const batch = await args.fetch(cursor, perRound);
    batches += 1;

    if (batch.uidValidity !== undefined) {
      if (uidValidity === undefined) {
        // 旧格式水位没有 UIDVALIDITY：补记当前值，不重置（否则升级后第一次轮询会重灌整个邮箱）
        uidValidity = batch.uidValidity;
      } else if (batch.uidValidity !== uidValidity) {
        // 目录被清空/重建：UID 已重排，旧水位作废。从 1 重新拉（本轮就开始），
        // 这样重建后到达的新信不会因为"旧水位比新 UID 大"被永久跳过。
        args.onUidValidityChange?.(uidValidity, batch.uidValidity);
        uidValidity = batch.uidValidity;
        cursor = 0;
        reset = true;
        continue;
      }
    }

    fetched += batch.mails.length;
    for (const m of batch.mails) {
      const raw: MailRaw = { source: 'imap', account: args.account.key, folder: args.folder, uid: m.uid, ...readMessage(m.raw) };
      const r = await args.ingest(raw);
      if (!r.duplicate) {
        added += 1;
        args.onMail?.(raw);
      }
      // 水位只跟实际处理到的这封走；maxUid 绝不参与推进
      cursor = Math.max(cursor, m.uid);
    }
    if (batch.failedUids && batch.failedUids.length > 0) {
      // 有封没取到：水位回退到缺口前（不低于本轮起点），下一轮重试，绝不越过缺口漏信
      cursor = Math.max(reset ? 0 : startUid, Math.min(...batch.failedUids) - 1);
      break;
    }
    if (batch.mails.length < perRound) break;
  }

  const watermark: MailWatermark = { uid: Math.max(cursor, reset ? 0 : startUid) };
  if (uidValidity !== undefined) watermark.uidvalidity = uidValidity;
  return { baseline: false, reset, watermark, added, fetched, batches };
}

export function startMailPoller(svc: MessageService): void {
  if (!config.mail.enabled) {
    console.log('[mail] 轮询已关闭（MAIL_ENABLED=false），跳过邮箱轮询');
    return;
  }
  // 强制 Mock / 凭据不足时绝不连真实 IMAP（e2e 与本地演示都可安全开 MAIL_ENABLED）
  if (modeOf(Platform.MAIL) !== 'real') {
    console.log(`[mail] 当前邮箱通道为 ${modeOf(Platform.MAIL)}（MAIL_MODE / 凭据），跳过真实 IMAP 轮询`);
    return;
  }
  if (config.mail.issues.length > 0) {
    for (const issue of config.mail.issues) {
      const log = issue.level === 'error' ? console.error : console.warn;
      log(`[mail] 配置问题${issue.key ? `（${issue.key}）` : ''}：${issue.message}`);
    }
  }
  if (config.mail.accounts.length === 0) {
    console.warn('[mail] 没有任何可用邮箱账号，检查 MAIL_ACCOUNTS 或 MAIL_<KEY>_ADDRESS / MAIL_<KEY>_AUTH_CODE');
    return;
  }

  const stateFile = resolveStateFile();
  const loaded = loadWatermarkState(stateFile);
  const watermarks = loaded.watermarks;
  if (loaded.error) {
    console.warn(`[mail] 状态文件异常，已忽略损坏部分（${stateFile}）：${loaded.error}`);
  }
  if (loaded.restored > 0) {
    console.log(`[mail] 已从状态文件恢复 ${loaded.restored} 个 UID 水位（${stateFile}）`);
  } else if (!loaded.exists && !loaded.error) {
    console.log(`[mail] 未找到状态文件（${stateFile}），首轮只建立 UID 基线，不导入历史邮件`);
  }

  const persist = () => {
    try {
      saveWatermarkState(stateFile, watermarks);
    } catch (e) {
      // 写盘失败只影响重启续传，绝不能让轮询停摆
      console.warn(`[mail] 状态文件写入失败（轮询继续，仅影响重启续传）：${errMessage(e)}`);
    }
  };

  let running = false;

  const pollOnce = async () => {
    if (running) return;
    running = true;
    try {
      for (const account of config.mail.accounts) {
        const folders = account.folders.length > 0 ? account.folders : ['INBOX'];
        for (const folder of folders) {
          const mark = `${account.key}#${folder}`;
          const last = watermarks.get(mark);
          try {
            const result = await pollMailFolder({
              account,
              folder,
              last,
              fetch: (sinceUid, limit) => fetchNewMails(account, sinceUid, limit, folder),
              ingest: (raw) => svc.ingest(Platform.MAIL, raw),
              onMail: (raw) => console.log(`[mail] ${account.label}/${folder} 收到新邮件 UID=${raw.uid}：${raw.subject || '(无主题)'} ← ${raw.from.address}`),
              onUidValidityChange: (from, to) => console.warn(`[mail] ${account.label}/${folder} UIDVALIDITY 变化（${from} → ${to}）：目录可能被清空/重建、UID 已重排，重置该目录水位并重新导入（避免漏信）`),
            });

            const changed = !last
              || last.uid !== result.watermark.uid
              || last.uidvalidity !== result.watermark.uidvalidity;
            watermarks.set(mark, result.watermark);
            if (result.baseline || changed) persist();

            if (result.baseline) {
              const validity = result.watermark.uidvalidity === undefined ? '' : `，UIDVALIDITY=${result.watermark.uidvalidity}`;
              console.log(`[mail] ${account.label}/${folder} 已连接，基线 UID=${result.watermark.uid}${validity}，历史邮件不入库`);
              continue;
            }
            if (result.reset) {
              console.warn(`[mail] ${account.label}/${folder} 水位已按新 UIDVALIDITY 重置，本轮从目录开头重新导入（当前水位 UID=${result.watermark.uid}）`);
            }
            if (result.added > 0) {
              console.log(`[mail] ${account.label}/${folder} 本轮入库 ${result.added} 封（${result.batches} 批，截至今水位 UID=${result.watermark.uid}）`);
            }
          } catch (e) {
            console.error(`[mail] ${account.label}/${folder} 轮询失败:`, errMessage(e));
          }
        }
      }
    } finally {
      running = false;
    }
  };

  console.log(`[mail] 轮询已启动，间隔 ${Math.round(config.mail.pollMs / 1000)}s，账号：${config.mail.accounts.map((a) => `${a.label}[${a.folders.join(',')}]@${a.imapHost}`).join(' / ')}`);
  void pollOnce();
  setInterval(() => void pollOnce(), config.mail.pollMs);
}
