/**
 * 连接器注册表：按平台名取到对应适配器。
 * 想接入第 4 个平台？只要再实现一个 PlatformConnector，在这里加一行即可。
 */
import { Platform, PlatformConnector } from '@unimsg/shared';
import { feishuConnector } from './feishu';
import { dingtalkConnector } from './dingtalk';
import { wecomConnector } from './wecom';
import { mailConnector } from './mail/mail';

export const connectors: Record<Platform, PlatformConnector> = {
  [Platform.FEISHU]: feishuConnector,
  [Platform.DINGTALK]: dingtalkConnector,
  [Platform.WECOM]: wecomConnector,
  [Platform.MAIL]: mailConnector,
};

export function getConnector(platform: Platform): PlatformConnector {
  const c = connectors[platform];
  if (!c) throw new Error(`unsupported platform: ${platform}`);
  return c;
}
