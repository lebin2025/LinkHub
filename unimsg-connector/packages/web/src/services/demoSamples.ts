/**
 * 空态「一键注入」用的演示数据。
 *
 * 为什么走 webhook 而不是新加一个后端接口：
 *  - webhook 是**真实的入站通道**——消息会真的过幂等去重、标准化、意图识别、写 trace，
 *    所以"注入"出来的东西和真实平台推来的走同一条流水线，演示时经得起追问；
 *  - 不需要改后端、不需要重启服务，前端在真实后端模式下立刻可用。
 *
 * 诚实性：这些消息的发送人是演示身份，回复时平台会走 mock 通道，界面上会如实显示「模拟发送」。
 */
import { Platform } from '../types';

/** 可注入的平台（邮箱是 IMAP 轮询拉取，没有 webhook，不在其中） */
export type InjectPlatform = Platform.FEISHU | Platform.DINGTALK | Platform.WECOM;

export const INJECT_PLATFORMS: InjectPlatform[] = [
  Platform.FEISHU,
  Platform.DINGTALK,
  Platform.WECOM,
];

/** 每个平台的样例消息（轮转使用，多点几次不会重复同一条） */
const SAMPLES: Record<InjectPlatform, Array<{ from: string; name: string; text: string }>> = {
  [Platform.FEISHU]: [
    { from: 'zhangsan', name: '张三', text: '明天 10:00 前把周报发我，重点写本周联调进展和下周计划。' },
    { from: 'lisi', name: '李四', text: '新版接口文档什么时候能更新？前端联调卡在鉴权字段上了，麻烦今天确认一下。' },
  ],
  [Platform.DINGTALK]: [
    { from: 'zhaoliu', name: '赵六', text: '明天上午 10:00 评审会，会议室 A301，请提前准备演示材料。' },
    { from: 'sunqi', name: '孙七', text: '本周五 18:00 前把预算确认单发我，财务要归档。' },
  ],
  [Platform.WECOM]: [
    { from: 'wangwu', name: '王五', text: '客户反馈登录偶发失败，方便拉个群一起看下日志吗？' },
    { from: 'chenba', name: '陈八', text: '下周一 9点 灰度上线，今晚需要把回滚方案发出来确认。' },
  ],
};

/** 平台入站地址（相对 /api/webhook/*） */
const WEBHOOK_PATH: Record<InjectPlatform, string> = {
  [Platform.FEISHU]: '/api/webhook/feishu',
  [Platform.DINGTALK]: '/api/webhook/dingtalk',
  [Platform.WECOM]: '/api/webhook/wecom',
};

/** 生成一次注入的请求（path + body），`seq` 用于保证 messageId 唯一、避免被幂等去重吃掉 */
export function buildSample(
  platform: InjectPlatform,
  seq: number,
): { path: string; body: Record<string, unknown> } {
  const pool = SAMPLES[platform];
  const sample = pool[seq % pool.length];
  const messageId = `demo_${platform}_${Date.now()}_${seq}`;
  const text = sample.text;

  // 三家的入站报文格式完全不同，这里各按官方形状拼最小可用体
  if (platform === Platform.FEISHU) {
    return {
      path: WEBHOOK_PATH[platform],
      body: {
        schema: '2.0',
        event: {
          message: {
            message_id: messageId,
            message_type: 'text',
            content: JSON.stringify({ text }),
            sender: { sender_id: { user_id: sample.from } },
          },
        },
      },
    };
  }

  if (platform === Platform.DINGTALK) {
    return {
      path: WEBHOOK_PATH[platform],
      body: {
        msgtype: 'text',
        text: { content: text },
        msgId: messageId,
        senderId: sample.from,
        senderNick: sample.name,
      },
    };
  }

  return {
    path: WEBHOOK_PATH[platform],
    body: {
      MsgType: 'text',
      Content: text,
      MsgId: messageId,
      FromUserName: sample.from,
    },
  };
}

/**
 * 把样例投递到真实后端；`base` 为 `VITE_API_BASE`（空字符串表示同源部署）。
 * 失败时抛出，由调用方决定怎么提示——不静默吞掉。
 */
export async function injectSample(
  platform: InjectPlatform,
  seq: number,
  base: string,
  timeoutMs = 8000,
): Promise<void> {
  const { path, body } = buildSample(platform, seq);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } finally {
    window.clearTimeout(timer);
  }
}
