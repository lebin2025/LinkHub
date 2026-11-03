import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, App as AntApp, Button, Tooltip } from 'antd';
import {
  ArrowLeftOutlined,
  CheckOutlined,
  CopyOutlined,
  HistoryOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { MsgStatus } from '../../types';
import type { UnifiedMessage } from '../../types';
import { store } from '../../store';
import { TYPE_LABEL, PLATFORM_META, formatDateTime, formatRelative, shortTrace } from '../../utils/format';
import { AvatarBadge } from '../../components/AvatarBadge';
import { PlatformTag } from '../../components/PlatformTag';
import { StatusBadge } from '../../components/StatusBadge';
import { AiSuggestion } from './AiSuggestion';
import { ReplyComposer } from './ReplyComposer';
import { StatusFlow } from './StatusFlow';

export function DetailPanel({ message }: { message: UnifiedMessage }) {
  const navigate = useNavigate();
  const { message: toast } = AntApp.useApp();
  const [text, setText] = useState(message.replyDraft ?? '');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setText(message.replyDraft ?? '');
    setSending(false);
  }, [message.traceId, message.replyDraft]);

  const sentAlready = message.status === MsgStatus.SENT || message.status === MsgStatus.SYNCED;
  const canMarkDone = !message.done;

  const replyLabel = useMemo(() => {
    if (message.status === MsgStatus.FAILED) return '重试发送';
    if (sentAlready) return '再次回复';
    return '发送回复';
  }, [message.status, sentAlready]);

  async function handleSend() {
    const content = text.trim();
    if (!content) return;
    setSending(true);
    try {
      await store.reply(message.traceId, content);
      toast.success('已提交回写，状态将实时更新');
    } catch {
      toast.error('回复失败，请重试');
    } finally {
      setSending(false);
    }
  }

  async function handleDone() {
    try {
      await store.markDone(message.traceId);
      toast.success('已标记完成');
    } catch {
      toast.error('操作失败，请重试');
    }
  }

  async function copyTrace() {
    try {
      await navigator.clipboard.writeText(message.traceId);
      toast.success('traceId 已复制');
    } catch {
      toast.info(message.traceId);
    }
  }

  return (
    <div className="detail" data-testid="detail-panel">
      <header className="detail__head">
        <Button
          className="detail__back"
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/inbox')}
          aria-label="返回列表"
        />
        <AvatarBadge name={message.sender.name} platform={message.platform} size={42} />
        <div className="detail__title">
          <div className="detail__name">
            {message.sender.name}
            <PlatformTag platform={message.platform} small />
          </div>
          <div className="detail__meta" title={formatDateTime(message.createdAt)}>
            {formatRelative(message.createdAt)} · {TYPE_LABEL[message.type]} · trace {shortTrace(message.traceId)}
          </div>
        </div>
        <div className="detail__head-actions">
          <StatusBadge status={message.status} />
          {message.type === 'todo' && (
            <Button
              size="small"
              icon={<CheckOutlined />}
              disabled={!canMarkDone}
              onClick={handleDone}
            >
              {message.done ? '已完成' : '标记完成'}
            </Button>
          )}
          <Tooltip title="复制 traceId">
            <Button size="small" type="text" icon={<CopyOutlined />} onClick={copyTrace} />
          </Tooltip>
          <Button
            size="small"
            type="text"
            icon={<HistoryOutlined />}
            onClick={() => navigate(`/trace/${message.traceId}`)}
          >
            回放
          </Button>
        </div>
      </header>

      <div className="detail__scroll">
        {message.needsReview && (
          <Alert
            className="detail__alert"
            type="warning"
            showIcon
            message="OCR 置信度不足，已标记待人工确认"
            description="请先人工核对图片 / 文件中的文字，再决定回复内容。"
          />
        )}

        {message.status === MsgStatus.FAILED && (
          <Alert
            className="detail__alert"
            type="error"
            showIcon
            message="回写失败，已写入死信队列"
            description="可修改内容后再次发送；生产环境会按指数退避重试 3 次。"
          />
        )}

        <section className="detail__section">
          <div className="section-label">消息内容</div>
          <div className="message-body">{message.body}</div>
          {message.reply && (
            <div className="message-reply">
              <span className="message-reply__label">
                <SendOutlined /> {message.status === MsgStatus.FAILED ? '待重试的回复' : '已回写内容'}
              </span>
              <span className="message-reply__text">{message.reply}</span>
            </div>
          )}
        </section>

        <AiSuggestion
          message={message}
          onUseDraft={(draft) => setText(draft)}
          onRegenerate={() => toast.info('Mock 模式下草稿由关键词规则生成，可手动编辑')}
        />

        <section className="detail__section">
          <div className="section-label">状态流转</div>
          <StatusFlow status={message.status} />
        </section>

        <section className="detail__section">
          <div className="section-label">消息信息</div>
          <dl className="meta-grid">
            <div>
              <dt>发送人</dt>
              <dd>
                {message.sender.name}（{message.sender.id}）
              </dd>
            </div>
            <div>
              <dt>平台</dt>
              <dd>{PLATFORM_META[message.platform].name}</dd>
            </div>
            <div>
              <dt>类型</dt>
              <dd>{TYPE_LABEL[message.type]}</dd>
            </div>
            <div>
              <dt>外部 ID</dt>
              <dd className="mono">{message.externalId}</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{formatDateTime(message.createdAt)}</dd>
            </div>
            <div>
              <dt>更新时间</dt>
              <dd>{formatDateTime(message.updatedAt)}</dd>
            </div>
            <div className="meta-grid__wide">
              <dt>traceId</dt>
              <dd className="mono">{message.traceId}</dd>
            </div>
          </dl>
        </section>
      </div>

      <footer className="detail__footer">
        <ReplyComposer
          message={message}
          value={text}
          sending={sending}
          onChange={setText}
          onSend={handleSend}
        />
        <div className="detail__footer-hint">{replyLabel} · 结果会通过 WebSocket 实时推送</div>
      </footer>
    </div>
  );
}