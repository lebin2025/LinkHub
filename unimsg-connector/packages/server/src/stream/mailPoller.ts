/**
 * 邮箱轮询器：IMAP 没有推送，只能定时拉。
 *
 * 首轮只记录每个账号的最大 UID 作为基线（不把历史邮件灌进中枢），
 * 之后每轮导入 UID 更大的新信。用 UID 水位而不是 \Seen 标记，
 * 是为了不去改动用户邮箱里的已读状态。
 */
import { Platform } from '@unimsg/shared';
import { config } from '../config';
import { MessageService } from '../services/message';
import { readMessage } from '../connectors/mail/mime';
import { fetchNewMails } from '../connectors/mail/imapClient';
import type { MailRaw } from '../connectors/mail/mail';

const PER_ROUND = 20;

export function startMailPoller(svc: MessageService): void {
  if (!config.mail.enabled) {
    console.log('[mail] 未开启（MAIL_ENABLED=false），跳过邮箱轮询');
    return;
  }
  if (config.mail.accounts.length === 0) {
    console.warn('[mail] MAIL_ENABLED=true 但没有任何邮箱账号，检查 MAIL_*_ADDRESS / MAIL_*_AUTH_CODE');
    return;
  }

  const watermarks = new Map<string, number>();
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
            if (last === undefined) {
              const { maxUid } = await fetchNewMails(account, null, PER_ROUND, folder);
              watermarks.set(mark, maxUid);
              console.log(`[mail] ${account.label}/${folder} 已连接，基线 UID=${maxUid}，历史邮件不入库`);
              continue;
            }
            const { mails, maxUid } = await fetchNewMails(account, last, PER_ROUND, folder);
            let added = 0;
            for (const m of mails) {
              const raw: MailRaw = { source: 'imap', account: account.key, folder, uid: m.uid, ...readMessage(m.raw) };
              const r = await svc.ingest(Platform.MAIL, raw);
              if (!r.duplicate) {
                added += 1;
                console.log(`[mail] ${account.label}/${folder} 收到新邮件 UID=${m.uid}：${raw.subject || '(无主题)'} ← ${raw.from.address}`);
              }
            }
            watermarks.set(mark, Math.max(maxUid, last));
            if (added > 0) console.log(`[mail] ${account.label}/${folder} 本轮入库 ${added} 封`);
          } catch (e) {
            console.error(`[mail] ${account.label}/${folder} 轮询失败:`, e instanceof Error ? e.message : String(e));
          }
        }
      }
    } finally {
      running = false;
    }
  };

  console.log(`[mail] 轮询已启动，间隔 ${Math.round(config.mail.pollMs / 1000)}s，账号：${config.mail.accounts.map((a) => `${a.label}[${a.folders.join(',')}]`).join(' / ')}`);
  void pollOnce();
  setInterval(() => void pollOnce(), config.mail.pollMs);
}
