/**
 * 统一消息契约（前后端共享 · 评分强制契约，见文档 2.3）
 *
 * 这是整个系统的"宪法"：三平台适配器、中枢服务、REST 路由、前端
 * 全部围绕这些类型与接口编写。任何一端改动都必须保持强一致。
 */

/** 支持接入的平台（附加项要求 ≥3 平台） */
export enum Platform {
  FEISHU = 'feishu',
  DINGTALK = 'dingtalk',
  WECOM = 'wecom',
  /** 邮箱（QQ / 163 …）：IMAP 轮询收、SMTP 发，可挂多个账号 */
  MAIL = 'mail',
}

/** 闭环状态机（文档 1.3）：received→processing→replied→sent→synced，失败进 failed */
export enum MsgStatus {
  RECEIVED = 'received',
  PROCESSING = 'processing',
  REPLIED = 'replied',
  SENT = 'sent',
  SYNCED = 'synced',
  FAILED = 'failed',
}

/** 消息类型 */
export type MsgType = 'text' | 'image' | 'file' | 'todo';

/** 发送方 */
export interface Sender {
  name: string;
  id: string;
}

/**
 * 一次回写实际走的通道：真实平台接口（real）还是本地模拟（mock）。
 * 契约强制：任何"成功"都必须带上它，前端据此标注「模拟发送」，
 * 绝不把 Mock 的结果伪装成真实平台已收到。
 */
export type DeliveryMode = 'real' | 'mock';

/** 回写投递信息（成功发送后写入消息，前端与回放可见） */
export interface DeliveryInfo {
  mode: DeliveryMode;
  /** 真实平台返回的凭证（飞书 message_id / 钉钉 processQueryKey / 企微 msgid / SMTP 回执） */
  platformReply?: string;
  at: string;
}

/** 连接器发送结果：mode 必须如实反映本次是真实接口还是本地模拟 */
export interface SendResult {
  ok: boolean;
  platformReply?: string;
  mode: DeliveryMode;
}

/** 会话（真实回写必须知道发回哪里） */
export interface Conversation {
  id: string;
  type: 'group' | 'p2p';
  /** 群名称等展示用信息（平台返回才有，例如钉钉 conversationTitle；不参与发送） */
  title?: string;
}

/**
 * 统一消息标准格式：外部平台的事件无论长什么样，
 * 经适配器 convert 后都收敛成这一种结构，后端只认这一种。
 */
export interface UnifiedMessage {
  traceId: string; // 全链路追踪号，贯穿"接收→处理→发送→状态变更"
  platform: Platform;
  externalId: string; // 平台侧原始消息 ID
  sender: Sender;
  conversation?: Conversation; // 消息所属会话（群/单聊），真实回写使用
  type: MsgType;
  body: string;
  intent?: string; // 大模型识别的意图
  replyDraft?: string; // 大模型给出的可编辑回复草稿
  reply?: string; // 用户最终回写的文本（回写时发送此内容）
  done?: boolean; // 是否已标记完成（待办类）
  /**
   * 待办截止时间（ISO）。演示环境由服务端从正文做启发式推断（"明天 18:00"/"周三"/"12月3日"），
   * 解析不出就是 undefined —— 前端归入"未设置截止"，不伪造时间。
   */
  dueAt?: string;
  needsReview?: boolean; // OCR 低置信/失败时标记“待人工确认”
  status: MsgStatus;
  createdAt: string;
  updatedAt: string;
  /** 仅后端内部使用：回写后平台返回的内容（不暴露敏感信息给前端） */
  platformReply?: string;
  /** 仅后端内部使用：邮箱回写需要的会话信息（账号 / 被回复的 Message-ID / 原主题） */
  mailMeta?: { account: string; inReplyTo: string; subject: string };
  /** 回写投递方式（成功后写入；Mock 模式也如实记录，便于前端标注"模拟发送"） */
  delivery?: DeliveryInfo;
}

/**
 * 平台连接器统一接口：新增一个平台，只需要实现这一个接口。
 * 文档明确要求 verify/receive/send/convert 四件套，这是可扩展性加分点。
 */
export interface PlatformConnector {
  /** 回调验签：校验平台推过来的事件确实来自该平台（防伪造） */
  verify(payload: unknown, sig: string, headers?: Record<string, string | string[] | undefined>): boolean;
  /** 解密加密回调；不需要解密时返回原样 */
  decrypt?(payload: unknown): unknown;
  /** URL 验证握手：需要原样返回 challenge 时实现 */
  challenge?(payload: unknown): unknown | undefined;
  /** 外部事件 → 统一消息 */
  receive(raw: unknown): UnifiedMessage;
  /** 统一消息 → 平台（真实发送 / Mock 模拟发送），结果必须带上是哪条通道 */
  send(msg: UnifiedMessage): Promise<SendResult>;
  /** 统一消息 → 平台外部格式（回写前的格式转换） */
  convert(msg: UnifiedMessage): unknown;
}

/**
 * 消息服务接口（REST 暴露给前端）：
 * list 展示、reply 触发回写+状态机、markDone 标记完成、getTrace 全链路回放。
 */
export interface MessageService {
  list(filter?: { platform?: Platform; status?: MsgStatus }): UnifiedMessage[];
  reply(id: string, text: string): Promise<UnifiedMessage>;
  markDone(id: string): Promise<void>;
  getTrace(traceId: string): UnifiedMessage[];
}

/**
 * 闭环日志条目：每条消息的每次状态/事件变更都写一条，
 * 配合 traceId 即可"回放"任意一条消息的全链路（文档 1.3 持续优化/可回放）。
 */
export interface TraceEntry {
  traceId: string;
  platform: Platform;
  status: MsgStatus;
  event: string; // 例如 'receive' | 'reply' | 'send' | 'synced' | 'failed'
  detail?: string;
  at: string; // ISO 时间
}
