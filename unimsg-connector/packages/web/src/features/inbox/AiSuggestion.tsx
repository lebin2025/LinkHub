import { Button, Tooltip } from 'antd';
import { RobotOutlined, ReloadOutlined } from '@ant-design/icons';
import type { UnifiedMessage } from '../../types';
import { IntentTag } from '../../components/IntentTag';

export function AiSuggestion({
  message,
  onUseDraft,
  onRegenerate,
}: {
  message: UnifiedMessage;
  onUseDraft: (draft: string) => void;
  onRegenerate: () => void;
}) {
  const fallback = !message.intent || message.intent === '未分类';
  const pending = !message.intent;

  return (
    <section className="ai-card" aria-label="AI 处理建议">
      <header className="ai-card__head">
        <span className="ai-card__icon">
          <RobotOutlined />
        </span>
        <span className="ai-card__title">AI 建议</span>
        {pending ? (
          <span className="ai-card__status">分析中…</span>
        ) : (
          <span className="ai-card__intent">
            意图 <IntentTag intent={message.intent} />
          </span>
        )}
        {!pending && <span className="ai-card__hint">{fallback ? '未识别，已回退未分类' : '可编辑后发送'}</span>}
      </header>

      <div className={`ai-card__draft${pending ? ' is-pending' : ''}`}>
        {pending ? '正在根据消息内容生成回复草稿…' : message.replyDraft || '暂无草稿，可直接输入回复。'}
      </div>

      <footer className="ai-card__actions">
        <Button
          size="small"
          type="default"
          className="ai-card__use"
          disabled={!message.replyDraft}
          onClick={() => message.replyDraft && onUseDraft(message.replyDraft)}
        >
          采用草稿
        </Button>
        <Tooltip title="Mock 模式下由关键词规则生成">
          <Button size="small" type="text" icon={<ReloadOutlined />} onClick={onRegenerate}>
            重新生成
          </Button>
        </Tooltip>
      </footer>
    </section>
  );
}