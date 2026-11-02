/**
 * 各平台样例事件（单测 & 演示用）。
 *
 * 真实评审时，这些会被平台推过来的 Webhook 回调取代；
 * 现在用它们驱动 receive 解析与 convert 映射的单元测试。
 */
export const feishuSample = {
  schema: '2.0',
  header: { event_type: 'im.message.receive_v1' },
  event: {
    message: {
      message_id: 'om_demo_001',
      message_type: 'text',
      content: JSON.stringify({ text: '周五前交周报' }),
      sender: { sender_id: { user_id: 'u_feishu_demo' } },
    },
  },
};

export const dingtalkSample = {
  msgtype: 'text',
  text: { content: '周五前交周报' },
  msgId: 'msg_demo_001',
  senderId: 'user_dingtalk_demo',
  senderNick: '钉钉小王',
  conversationType: '1',
};

export const wecomSample = {
  MsgType: 'text',
  Content: '周五前交周报',
  MsgId: 'wx_demo_001',
  FromUserName: 'user_wecom_demo',
  ToUserName: 'corp_demo',
  AgentID: '1000002',
};
