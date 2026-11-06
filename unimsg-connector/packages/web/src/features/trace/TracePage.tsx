import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { App as AntApp, Button, Select, Tag } from 'antd';
import { ArrowLeftOutlined, CopyOutlined, HistoryOutlined } from '@ant-design/icons';
import { useAppState } from '../../hooks/useAppState';
import { store } from '../../store';
import type { TraceEntry } from '../../types';
import { formatClock, formatDateTime, formatRelative, shortTrace, STATUS_META } from '../../utils/format';
import { AvatarBadge } from '../../components/AvatarBadge';
import { PlatformTag } from '../../components/PlatformTag';
import { StatusBadge } from '../../components/StatusBadge';
import { EmptyState } from '../../components/EmptyState';
import { DrawerSection } from '../../components/DrawerSection';

/** 事件文案与色相：统一走语义变量，明暗主题自动跟随 */
const EVENT_META: Record<string, { label: string; color: string }> = {
  received: { label: '接收', color: 'var(--text-3)' },
  redelivered: { label: '重复推送（幂等）', color: 'var(--text-3)' },
  intent: { label: '意图识别', color: 'var(--brand)' },
  ocr: { label: 'OCR 识别', color: 'var(--brand)' },
  ocr_low_confidence: { label: 'OCR 低置信', color: 'var(--warning)' },
  ocr_failed: { label: 'OCR 失败', color: 'var(--danger)' },
  processing: { label: '处理中', color: 'var(--brand)' },
  replied: { label: '已回复', color: 'var(--text-2)' },
  sent: { label: '已发送', color: 'var(--brand)' },
  synced: { label: '已同步', color: 'var(--success)' },
  failed: { label: '发送失败', color: 'var(--danger)' },
  done: { label: '标记完成', color: 'var(--text-2)' },
};

function eventMeta(event: string) {
  return EVENT_META[event] ?? { label: event, color: 'var(--text-3)' };
}

export function TracePage() {
  const state = useAppState();
  const { traceId } = useParams();
  const navigate = useNavigate();
  const { message: toast } = AntApp.useApp();
  const [log, setLog] = useState<TraceEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const selected = traceId ? state.messages.find((m) => m.traceId === traceId) : undefined;

  useEffect(() => {
    if (!traceId && state.messages.length > 0) {
      navigate(`/trace/${state.messages[0].traceId}`, { replace: true });
    }
  }, [traceId, state.messages, navigate]);

  useEffect(() => {
    if (!traceId) return;
    let alive = true;
    setLoading(true);
    store
      .getTrace(traceId)
      .then((result) => {
        if (alive) setLog(result.log);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [traceId, state.messages]);

  const options = useMemo(
    () =>
      state.messages.map((m) => ({
        value: m.traceId,
        label: `${m.sender.name} · ${shortTrace(m.traceId)} · ${formatRelative(m.createdAt)}`,
      })),
    [state.messages],
  );

  // 抽屉头摘要：条数 + 最后一条事件（收起时也能看出"跑到哪一步了"）
  const lastEvent = log.length > 0 ? log[log.length - 1] : undefined;
  const logSummary = lastEvent
    ? `${log.length} 条事件 · ${eventMeta(lastEvent.event).label} ${formatClock(lastEvent.at)}`
    : loading
      ? '加载中…'
      : '暂无事件';

  async function copyLog() {
    const text = log
      .map((e) => `${formatDateTime(e.at)}  ${e.event}  ${e.status}${e.detail ? `  ${e.detail}` : ''}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success('闭环日志已复制');
    } catch {
      toast.info('当前环境不支持剪贴板，日志已显示在页面上');
    }
  }

  return (
    <div className="page trace-page">
      <header className="page__head page__head--row">
        <div>
          <h1 className="page__title">
            <HistoryOutlined /> 全链路回放
          </h1>
        </div>
        <div className="trace-picker">
          <Select
            showSearch
            value={traceId}
            options={options}
            onChange={(value) => navigate(`/trace/${value}`)}
            placeholder="选择一条消息"
            optionFilterProp="label"
            style={{ width: 360 }}
          />
        </div>
      </header>

      {!selected ? (
        <EmptyState title="选择一条消息" description="从上方下拉框中选择消息，即可查看它的全链路日志。" />
      ) : (
        <div className="trace-layout">
          <div className="trace-side">
            <section className="surface-card trace-summary">
              <div className="trace-summary__head">
                <AvatarBadge name={selected.sender.name} platform={selected.platform} size={38} />
                <div className="trace-summary__title">
                  <div className="trace-summary__name">{selected.sender.name}</div>
                  <div className="trace-summary__meta">
                    <PlatformTag platform={selected.platform} small />
                    <span>{formatDateTime(selected.createdAt)}</span>
                  </div>
                </div>
                <StatusBadge status={selected.status} />
              </div>

              <p className="trace-summary__body">{selected.body}</p>

              <div className="trace-summary__foot">
                <Tag className="mono-tag">{selected.traceId}</Tag>
                <div className="trace-summary__actions">
                  <Button
                    size="small"
                    icon={<ArrowLeftOutlined />}
                    onClick={() => navigate(`/inbox/${selected.traceId}`)}
                  >
                    回到消息
                  </Button>
                  <Button size="small" icon={<CopyOutlined />} onClick={copyLog}>
                    复制日志
                  </Button>
                </div>
              </div>
            </section>
          </div>

          <DrawerSection
            className="drawer--flush"
            title="闭环日志"
            summary={logSummary}
            defaultOpen
          >
            {log.length === 0 && !loading ? (
              <EmptyState title="暂无日志" description="这条消息还没有产生闭环事件。" />
            ) : (
              <ol className="trace-events">
                {log.map((entry, index) => {
                  const meta = eventMeta(entry.event);
                  return (
                    <li
                      key={`${entry.event}-${entry.at}-${index}`}
                      className="surface-card trace-event"
                    >
                      <span
                        className="trace-event__dot"
                        style={{ background: meta.color }}
                        aria-hidden="true"
                      />
                      <div className="trace-event__body">
                        <div className="trace-event__head">
                          <span className="trace-event__name" style={{ color: meta.color }}>
                            {meta.label}
                          </span>
                          <span className="trace-event__event mono">{entry.event}</span>
                          <span className="trace-event__status">
                            {STATUS_META[entry.status]?.label ?? entry.status}
                          </span>
                          <span className="trace-event__time">{formatClock(entry.at)}</span>
                        </div>
                        {entry.detail && <div className="trace-event__detail">{entry.detail}</div>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </DrawerSection>
        </div>
      )}
    </div>
  );
}
