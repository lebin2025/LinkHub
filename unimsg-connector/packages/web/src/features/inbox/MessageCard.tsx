import type { MouseEvent } from 'react';
import { CheckOutlined, HistoryOutlined, MessageOutlined } from '@ant-design/icons';
import { MsgStatus } from '../../types';
import type { UnifiedMessage } from '../../types';
import { clamp, formatRelative } from '../../utils/format';
import { AvatarBadge } from '../../components/AvatarBadge';
import { PlatformTag } from '../../components/PlatformTag';
import { StatusBadge } from '../../components/StatusBadge';
import { IntentTag } from '../../components/IntentTag';

export function MessageCard({
  message,
  active,
  onSelect,
  variant = 'compact',
  onReply,
  onDone,
  onTrace,
}: {
  message: UnifiedMessage;
  active: boolean;
  onSelect: (traceId: string) => void;
  /** card = 收件箱卡片网格；compact = 详情打开后的短信式紧凑列表 */
  variant?: 'card' | 'compact';
  /** 行内快捷操作：回复 / 标记完成 / 全链路回放 */
  onReply?: (traceId: string) => void;
  onDone?: (traceId: string) => void;
  onTrace?: (traceId: string) => void;
}) {
  // 时间轴上的点表示「这条消息还要不要我处理」，而不是来源——
  // 来源已经由头像配色 + 平台标签表达，一个信息不需要说两遍。
  const dotState =
    message.status === MsgStatus.FAILED
      ? 'failed'
      : message.status === MsgStatus.REPLIED ||
          message.status === MsgStatus.SENT ||
          message.status === MsgStatus.SYNCED
        ? 'done'
        : message.needsReview
          ? 'review'
          : 'pending';
  // 行内按钮不能冒泡到整卡，否则点「完成」会同时打开详情
  const isolate = (fn?: (traceId: string) => void) => (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    fn?.(message.traceId);
  };
  return (
    <article
      className={`msg-card${variant === 'card' ? ' msg-card--card' : ''}${active ? ' is-active' : ''}`}
      onClick={() => onSelect(message.traceId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(message.traceId);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${message.sender.name}：${message.body}`}
      aria-current={active}
      data-trace={message.traceId}
    >
      {variant === 'compact' && (
        <span className={`msg-card__dot msg-card__dot--${dotState}`} aria-hidden="true" />
      )}
      <AvatarBadge name={message.sender.name} platform={message.platform} size={34} />
      <div className="msg-card__main">
        <div className="msg-card__row">
          <span className="msg-card__sender">{message.sender.name}</span>
          <PlatformTag platform={message.platform} small />
          <span className="msg-card__spacer" />
          <span className="msg-card__time">{formatRelative(message.createdAt)}</span>
        </div>
        <div className="msg-card__body">{clamp(message.body, 72)}</div>
        <div className="msg-card__row msg-card__row--meta">
          <StatusBadge status={message.status} small />
          <IntentTag intent={message.intent} />
          {message.needsReview && <span className="chip chip--warn">需人工确认</span>}
          {message.done && <span className="chip chip--done">已完成</span>}

          <div className="msg-card__actions">
            <button
              type="button"
              className="msg-action"
              aria-label="回复"
              title="回复（R）"
              onClick={isolate(onReply)}
            >
              <MessageOutlined />
            </button>
            {!message.done && (
              <button
                type="button"
                className="msg-action"
                aria-label="标记完成"
                title="标记完成（E）"
                onClick={isolate(onDone)}
              >
                <CheckOutlined />
              </button>
            )}
            <button
              type="button"
              className="msg-action"
              aria-label="全链路回放"
              title="全链路回放"
              onClick={isolate(onTrace)}
            >
              <HistoryOutlined />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}