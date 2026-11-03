/**
 * 账号/凭据状态（只读视图，供前端展示“哪个平台已配置”）。
 * 注意：这里只返回“是否已配置”的布尔值，绝不返回任何密钥。
 */
import { Platform } from '@unimsg/shared';
import { config } from '../config';

export function listAccounts() {
  const p = config.platforms;
  return [
    { platform: Platform.FEISHU, configured: Boolean(p.feishu.appId && p.feishu.appSecret) },
    { platform: Platform.DINGTALK, configured: Boolean(p.dingtalk.appKey && p.dingtalk.appSecret) },
    // 企微真实收发需要 corpId + 应用 Secret + AgentId（Token/AESKey 只服务回调验签与解密）
    { platform: Platform.WECOM, configured: Boolean(p.wecom.corpId && p.wecom.secret && p.wecom.agentId) },
    { platform: Platform.MAIL, configured: config.mail.enabled && config.mail.accounts.length > 0 },
  ];
}
