/**
 * 通讯录 / 会话名录：给「发送给」选择器和会话标题提供**可读名字**。
 *
 * 现状（已实测）：
 *  - 飞书：本人 user_access_token 的 `im/v1/chats` 能拿到会话名，**单聊也有名字**
 *    （例如「郑友佳（测试用」），不需要额外权限；联系人搜索接口则需要
 *    contact:user.base:readonly，当前应用没开。
 *  - 钉钉：dws `contact user search` 可搜人（走本人登录态，不需要应用凭据）；
 *    会话名在个人事件里自带。
 *  - 微信：按好友昵称/群名定位，不提供名录。
 *
 * 所以这里只做「会话名录」：飞书真实可用；其它平台返回 available=false + 原因，
 * 前端据此说明「为什么只能选已有会话」，而不是假装有通讯录。
 */
import { Platform } from '@unimsg/shared';
import { config } from '../config';
import { classifyDwsFailure, createSpawnRunner } from '../connectors/dingtalkPersonal';
import { feishuUserAuth } from '../connectors/feishuUserAuth';
import { fetchUserChats } from '../connectors/feishuUserReceive';

export interface DirectoryEntry {
  /** 会话 ID（发送目标） */
  id: string;
  name: string;
  type: 'p2p' | 'group';
}

export interface DirectoryResult {
  platform: Platform;
  /** 本平台能不能提供名录 */
  available: boolean;
  /** 不可用时的中文原因（给用户看） */
  reason?: string;
  items: DirectoryEntry[];
  /** 名单来源：本人会话列表 / 平台通讯录 */
  source?: string;
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; result: DirectoryResult }>();

function unavailable(platform: Platform, reason: string): DirectoryResult {
  return { platform, available: false, reason, items: [] };
}

async function listFeishu(): Promise<DirectoryResult> {
  try {
    const token = await feishuUserAuth().accessToken();
    const res = await fetchUserChats(token, { pageSize: 100, maxChats: 200 });
    const items: DirectoryEntry[] = res.chats
      .filter((c) => Boolean(c.chatId))
      .map((c) => ({
        id: c.chatId,
        name: (c.name ?? '').trim() || c.chatId,
        type: c.chatMode === 'p2p' ? 'p2p' : 'group',
      }));
    return {
      platform: Platform.FEISHU,
      available: true,
      items,
      source: '飞书本人账号可见的会话（含单聊与群聊）',
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 未授权这类错误自带「去哪点哪」的指引，别再追加一遍，否则同一句授权说明会出现两次
    const hint = msg.includes('授权') ? '' : '需要先在「平台账号」页完成飞书本人账号授权。';
    return unavailable(Platform.FEISHU, `飞书会话名录不可用：${msg}${hint}`);
  }
}

/**
 * 钉钉会话名录：`dws chat +chat-list --types group,p2p --page-all -f json`。
 *
 * 这条命令能拿到**真实会话名**（群名 / 对方昵称），而个人事件里没有名字，
 * 所以收件箱的会话名和「发消息」选择器都靠它。未登录时如实返回不可用原因。
 */
async function listDingtalk(): Promise<DirectoryResult> {
  const bin = config.identity.dingtalk.bin;
  const profile = config.identity.dingtalk.profile;
  const run = createSpawnRunner(bin);
  const args = [
    'chat', '+chat-list',
    '--types', 'group,p2p',
    '--page-all',
    '-f', 'json',
    ...(profile ? ['--profile', profile] : []),
  ];
  let r;
  try {
    r = await run(args, { timeoutMs: 25_000 });
  } catch (e) {
    return unavailable(Platform.DINGTALK, `钉钉会话名录读取失败：${e instanceof Error ? e.message : String(e)}`);
  }
  if (r.code !== 0) {
    const info = classifyDwsFailure(r, 'dws chat +chat-list');
    return unavailable(Platform.DINGTALK, `钉钉会话名录不可用：${info.message}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    return unavailable(Platform.DINGTALK, '钉钉会话名录返回了非 JSON 内容，已忽略');
  }
  if (parsed?.error) {
    return unavailable(Platform.DINGTALK, `钉钉会话名录不可用：${parsed.error.message ?? '未知错误'}`);
  }
  const chats: any[] = Array.isArray(parsed?.chats) ? parsed.chats : [];
  const items: DirectoryEntry[] = chats
    .filter((c) => Boolean(c?.openConversationId))
    .map((c) => ({
      id: String(c.openConversationId),
      name: String(c.name ?? '').trim() || String(c.openConversationId),
      // 钉钉把单聊投影成 conversationType=direct
      type: (c.conversationType === 'direct' || c.chatMode === 'p2p') ? 'p2p' : 'group',
    }));
  return {
    platform: Platform.DINGTALK,
    available: true,
    items,
    source: '钉钉本人账号加入的会话（群聊 + 单聊，含真实群名）',
  };
}

/** 列出某平台可用于「发送给」的目标（带缓存，避免每次开弹窗都打平台接口） */
export async function listDirectory(platform: Platform): Promise<DirectoryResult> {
  const hit = cache.get(platform);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.result;

  let result: DirectoryResult;
  if (platform === Platform.FEISHU) {
    result = await listFeishu();
  } else if (platform === Platform.DINGTALK) {
    // 钉钉会话名录：`dws chat +chat-list` 能拿到真实群名/对方昵称，
    // 个人事件本身不带名字，所以左栏会话名和「发送给」选择器都依赖这里。
    result = await listDingtalk();
  } else if (platform === Platform.WECHAT) {
    result = unavailable(Platform.WECHAT, '微信走 RPA 通道，按好友昵称/群名定位，无通讯录名录。');
  } else {
    result = unavailable(Platform.MAIL, '邮箱按地址发送，不使用会话名录。');
  }

  cache.set(platform, { at: Date.now(), result });
  return result;
}

/** 单测用 */
export function resetDirectoryCache(): void {
  cache.clear();
}
