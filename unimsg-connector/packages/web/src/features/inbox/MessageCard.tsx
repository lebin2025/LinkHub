import type { UnifiedMessage } from '../../types';
import { PLATFORM_META, clamp, formatRelative } from '../../utils/format';
import { AvatarBadge } from '../../components/AvatarBadge';
import { PlatformTag } from '../../components/PlatformTag';
import { StatusBadge } from '../../components/StatusBadge';
import { IntentTag } from '../../components/IntentTag';

export function MessageCard({
  message,
  active,
  onSelect,
}: {
  message: UnifiedMessage;
  active: boolean;
  onSelect: (traceId: string) => void;
}) {
  const meta = PLATFORM_META[message.platform];
  return (
    <article
      className={`msg-card${active ? ' is-active' : ''}`}
      onClick={() => onSelect(message.traceId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(message.traceId);
        }
      }}
      role="button"
      tabIndex={0}
      aria-current={active}
      data-trace={message.traceId}
    >
      <span className="msg-card__bar" style={{ background: meta.color }} />
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
        </div>
      </div>
    </article>
  );
}