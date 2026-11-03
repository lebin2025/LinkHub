/**
 * 钉钉 Stream 模式：长连接接收机器人消息，不需要公网回调地址。
 *
 * 使用前置条件（控制台）：应用能力 → 机器人 → 消息接收模式选 Stream → 发布版本。
 * 收到消息后复用 MessageService.onPlatformEvent，与 HTTP 回调走同一条入库/幂等链路。
 */
import { DWClient, TOPIC_ROBOT, type DWClientDownStream } from 'dingtalk-stream';
import { Platform } from '@unimsg/shared';
import { config } from '../config';
import { MessageService } from '../services/message';

export interface DingtalkStreamHandle {
  client: DWClient;
  close(): void;
}

async function handleRobotMessage(
  client: DWClient,
  svc: MessageService,
  res: DWClientDownStream,
): Promise<void> {
  let ack: Record<string, unknown>;
  try {
    const data = JSON.parse(res.data);
    const r = await svc.onPlatformEvent(Platform.DINGTALK, data);
    ack = { status: 'SUCCESS', duplicate: r.duplicate ?? false, traceId: r.message?.traceId };
  } catch (e) {
    ack = { status: 'LATER', message: e instanceof Error ? e.message : 'error' };
    console.error('[stream] 处理机器人消息失败:', e);
  }
  client.socketCallBackResponse(res.headers.messageId, ack);
}

export async function startDingtalkStream(svc: MessageService): Promise<DingtalkStreamHandle | null> {
  const { appKey, appSecret } = config.platforms.dingtalk;
  if (!appKey || !appSecret) {
    console.warn('[stream] 缺少钉钉 Client ID / Client Secret，跳过 Stream');
    return null;
  }

  const client = new DWClient({
    clientId: appKey,
    clientSecret: appSecret,
    keepAlive: true,
  });
  client.registerCallbackListener(TOPIC_ROBOT, (res) => {
    void handleRobotMessage(client, svc, res);
  });

  await client.connect();
  console.log('[stream] 钉钉 Stream 已连接，机器人消息将实时入库');
  return { client, close: () => client.disconnect() };
}
