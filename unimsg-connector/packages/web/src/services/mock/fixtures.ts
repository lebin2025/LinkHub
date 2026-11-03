/**
 * Mock 种子数据：覆盖三平台、六种状态、四类消息、降级与异常分支，
 * 让前端在没有后端的情况下也能完整演示「接收 → 展示 → 处理 → 回写 → 回流」。
 */
import { MsgStatus, Platform } from '../../types';
import type { MsgType, TraceEntry, UnifiedMessage } from '../../types';

const NOW = Date.now();
const MIN = 60_000;

interface Seed {
  platform: Platform;
  senderId: string;
  senderName: string;
  externalId: string;
  body: string;
  type?: MsgType;
  status: MsgStatus;
  intent?: string;
  confidence?: number;
  replyDraft?: string;
  reply?: string;
  done?: boolean;
  needsReview?: boolean;
  minutesAgo: number;
  failReason?: string;
}

const SEEDS: Seed[] = [
  {
    platform: Platform.FEISHU,
    senderId: 'u_zhangsan',
    senderName: '张三',
    externalId: 'om_1001',
    body: '周五前交周报，重点写一下本周联调进展和下周计划。',
    type: 'todo',
    status: MsgStatus.SYNCED,
    intent: '待办',
    confidence: 0.92,
    replyDraft: '收到，我会在截止前完成。',
    reply: '收到，周五前交周报。',
    minutesAgo: 12,
  },
  {
    platform: Platform.FEISHU,
    senderId: 'u_lisi',
    senderName: '李四',
    externalId: 'om_1002',
    body: '【图片】报销单截图，金额 1,280.00 元，请确认后提交财务。',
    type: 'image',
    status: MsgStatus.RECEIVED,
    intent: '待办',
    confidence: 0.72,
    needsReview: true,
    minutesAgo: 26,
  },
  {
    platform: Platform.FEISHU,
    senderId: 'u_wangwu',
    senderName: '王五',
    externalId: 'om_1003',
    body: '新版 API 文档什么时候更新？前端联调卡在鉴权字段上了。',
    type: 'text',
    status: MsgStatus.PROCESSING,
    intent: '咨询',
    confidence: 0.8,
    replyDraft: '收到，我确认后回复你。',
    minutesAgo: 41,
  },
  {
    platform: Platform.DINGTALK,
    senderId: 'u_zhaoliu',
    senderName: '赵六',
    externalId: 'msg_2001',
    body: '明天上午 10:00 评审会，会议室 A301，请提前准备演示材料。',
    type: 'todo',
    status: MsgStatus.REPLIED,
    intent: '通知',
    confidence: 0.78,
    replyDraft: '收到，我会准时参加。',
    reply: '收到，明早 10 点 A301。',
    minutesAgo: 63,
  },
  {
    platform: Platform.DINGTALK,
    senderId: 'u_qianqi',
    senderName: '钱七',
    externalId: 'msg_2002',
    body: '请把本周的告警记录同步到运维群。',
    type: 'text',
    status: MsgStatus.FAILED,
    intent: '待办',
    confidence: 0.86,
    reply: '收到，稍后同步。',
    failReason: 'platform 500：重试 3 次仍失败，已写入死信队列',
    minutesAgo: 118,
  },
  {
    platform: Platform.DINGTALK,
    senderId: 'u_sunba',
    senderName: '孙八',
    externalId: 'msg_2003',
    body: '【文件】Q3 预算明细.xlsx，请核对差旅部分。',
    type: 'file',
    status: MsgStatus.SENT,
    intent: '待办',
    confidence: 0.74,
    replyDraft: '收到，我今天核对完反馈。',
    reply: '收到，我今天核对完反馈。',
    minutesAgo: 176,
  },
  {
    platform: Platform.WECOM,
    senderId: 'u_zhoujiu',
    senderName: '周九',
    externalId: 'wx_3001',
    body: '报表导出按钮在哪？我这边找不到。',
    type: 'text',
    status: MsgStatus.REPLIED,
    intent: '咨询',
    confidence: 0.8,
    replyDraft: '收到，我确认后回复你。',
    reply: '右上角「导出」里，我发你截图。',
    minutesAgo: 240,
  },
  {
    platform: Platform.WECOM,
    senderId: 'u_wushi',
    senderName: '吴十',
    externalId: 'wx_3002',
    body: '客户回访已完成，纪要见附件。',
    type: 'text',
    status: MsgStatus.SYNCED,
    intent: '未分类',
    confidence: 0.4,
    done: true,
    minutesAgo: 305,
  },
  {
    platform: Platform.FEISHU,
    senderId: 'u_zhengyi',
    senderName: '郑一',
    externalId: 'om_1004',
    body: '关于统一消息中枢下一阶段排期的讨论：本周先完成三平台真实验签联调，下周补前端收件箱与全链路回放页面，月底前完成容器化部署与演示视频。请各成员确认自己负责的部分。',
    type: 'text',
    status: MsgStatus.RECEIVED,
    intent: '通知',
    confidence: 0.6,
    minutesAgo: 358,
  },
  {
    platform: Platform.DINGTALK,
    senderId: 'u_fenger',
    senderName: '冯二',
    externalId: 'msg_2004',
    body: '会议室投影仪坏了，下午的会改到线上。',
    type: 'text',
    status: MsgStatus.SYNCED,
    intent: '通知',
    confidence: 0.78,
    minutesAgo: 476,
  },
  {
    platform: Platform.WECOM,
    senderId: 'u_chensan',
    senderName: '陈三',
    externalId: 'wx_3003',
    body: '这个权限申请需要你审批一下。',
    type: 'todo',
    status: MsgStatus.RECEIVED,
    intent: '待办',
    confidence: 0.9,
    replyDraft: '收到，我会在截止前完成。',
    minutesAgo: 540,
  },
  {
    platform: Platform.FEISHU,
    senderId: 'u_chusi',
    senderName: '褚四',
    externalId: 'om_1005',
    body: '收到，谢谢！',
    type: 'text',
    status: MsgStatus.SYNCED,
    intent: '未分类',
    confidence: 0.4,
    minutesAgo: 610,
  },
  {
    platform: Platform.DINGTALK,
    senderId: 'u_weiwu',
    senderName: '卫五',
    externalId: 'msg_2005',
    body: '周报模板更新了，以后按新模板提交。',
    type: 'text',
    status: MsgStatus.REPLIED,
    intent: '通知',
    confidence: 0.7,
    replyDraft: '收到。',
    minutesAgo: 26 * 60,
  },
  {
    platform: Platform.WECOM,
    senderId: 'u_jiangliu',
    senderName: '蒋六',
    externalId: 'wx_3004',
    body: '【图片】现场照片',
    type: 'image',
    status: MsgStatus.RECEIVED,
    intent: '未分类',
    confidence: 0.4,
    minutesAgo: 27 * 60,
  },
];

const STATUS_RANK: Record<MsgStatus, number> = {
  [MsgStatus.RECEIVED]: 0,
  [MsgStatus.PROCESSING]: 1,
  [MsgStatus.REPLIED]: 2,
  [MsgStatus.SENT]: 3,
  [MsgStatus.SYNCED]: 4,
  [MsgStatus.FAILED]: 3,
};

function traceIdFor(index: number): string {
  const hex = (n: number, len: number) => n.toString(16).padStart(len, '0');
  return `f47ac10b-58cc-4372-a567-${hex(index, 4)}0e02b2c3${hex(index + 1, 4)}66`;
}

export interface TraceSeed {
  traceId: string;
  platform: Platform;
  status: MsgStatus;
  intent?: string;
  needsReview?: boolean;
  done?: boolean;
  createdAt: string;
}

/** 按状态倒推闭环日志，保证「时间线」与状态一致 */
export function buildTrace(msg: TraceSeed, confidence = 0.9, failReason?: string): TraceEntry[] {
  const base = new Date(msg.createdAt).getTime();
  const log: TraceEntry[] = [];
  let step = 0;
  const push = (event: string, status: MsgStatus, detail?: string) => {
    step += 1;
    log.push({
      traceId: msg.traceId,
      platform: msg.platform,
      status,
      event,
      detail,
      at: new Date(base + step * 1_500).toISOString(),
    });
  };

  push('received', MsgStatus.RECEIVED);
  if (msg.needsReview) push('ocr_low_confidence', MsgStatus.RECEIVED, 'confidence=0.55，已标记待人工确认');
  if (msg.intent) push('intent', MsgStatus.RECEIVED, `${msg.intent}(${confidence})`);

  const rank = STATUS_RANK[msg.status];
  if (rank >= 1) push('processing', MsgStatus.PROCESSING);
  if (rank >= 2) push('replied', MsgStatus.REPLIED);

  if (msg.status === MsgStatus.FAILED) {
    push('failed', MsgStatus.FAILED, failReason ?? '重试耗尽');
  } else {
    if (rank >= 3) push('sent', MsgStatus.SENT);
    if (rank >= 4) push('synced', MsgStatus.SYNCED);
  }
  if (msg.done) push('done', msg.status);
  return log;
}

export interface SeedData {
  messages: UnifiedMessage[];
  traces: Map<string, TraceEntry[]>;
}

export function createSeedData(): SeedData {
  const messages: UnifiedMessage[] = SEEDS.map((seed, index) => {
    const createdAt = new Date(NOW - seed.minutesAgo * MIN).toISOString();
    const traceId = traceIdFor(index + 1);
    const confidence = seed.confidence ?? 0.85;
    const log = buildTrace(
      {
        traceId,
        platform: seed.platform,
        status: seed.status,
        intent: seed.intent,
        needsReview: seed.needsReview,
        done: seed.done,
        createdAt,
      },
      confidence,
      seed.failReason,
    );
    const message: UnifiedMessage = {
      traceId,
      platform: seed.platform,
      externalId: seed.externalId,
      sender: { id: seed.senderId, name: seed.senderName },
      type: seed.type ?? 'text',
      body: seed.body,
      intent: seed.intent,
      replyDraft: seed.replyDraft,
      reply: seed.reply,
      done: seed.done,
      needsReview: seed.needsReview,
      status: seed.status,
      createdAt,
      updatedAt: log[log.length - 1]?.at ?? createdAt,
    };
    return message;
  });

  const traces = new Map<string, TraceEntry[]>();
  messages.forEach((m, i) => {
    const seed = SEEDS[i];
    traces.set(
      m.traceId,
      buildTrace(
        {
          traceId: m.traceId,
          platform: m.platform,
          status: m.status,
          intent: m.intent,
          needsReview: m.needsReview,
          done: m.done,
          createdAt: m.createdAt,
        },
        seed.confidence ?? 0.85,
        seed.failReason,
      ),
    );
  });

  return { messages, traces };
}

/** 演示模式下的「新消息」模板 */
export const INCOMING_TEMPLATES: Array<Pick<Seed, 'platform' | 'senderId' | 'senderName' | 'body' | 'type' | 'intent' | 'confidence' | 'replyDraft'>> = [
  {
    platform: Platform.FEISHU,
    senderId: 'u_demo_feishu',
    senderName: '演示·飞书',
    body: '这是刚推过来的一条飞书消息，请确认后回复。',
    type: 'text',
    intent: '待办',
    confidence: 0.88,
    replyDraft: '收到，我会尽快处理。',
  },
  {
    platform: Platform.DINGTALK,
    senderId: 'u_demo_dingtalk',
    senderName: '演示·钉钉',
    body: '【待办】下班前把演示环境准备好。',
    type: 'todo',
    intent: '待办',
    confidence: 0.91,
    replyDraft: '收到，下班前完成。',
  },
  {
    platform: Platform.WECOM,
    senderId: 'u_demo_wecom',
    senderName: '演示·企业微信',
    body: '这个报表怎么导出？',
    type: 'text',
    intent: '咨询',
    confidence: 0.82,
    replyDraft: '收到，我确认后回复你。',
  },
  {
    platform: Platform.FEISHU,
    senderId: 'u_demo_image',
    senderName: '演示·飞书',
    body: '【图片】报销单截图',
    type: 'image',
    intent: '未分类',
    confidence: 0.4,
  },
];

export const ACCOUNTS = [
  { platform: Platform.FEISHU, configured: true },
  { platform: Platform.DINGTALK, configured: true },
  { platform: Platform.WECOM, configured: false },
];

export const HEALTH = { received: 14, deduped: 3, sent: 9, failed: 1, dlq: 1 };