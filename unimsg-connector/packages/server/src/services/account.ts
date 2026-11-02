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
    { platform: Platform.WECOM, configured: Boolean(p.wecom.corpId && p.wecom.token) },
  ];
}
