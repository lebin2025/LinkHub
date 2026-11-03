import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { App as AntApp, Button, Select, Tag, Timeline } from 'antd';
import { ArrowLeftOutlined, CopyOutlined, HistoryOutlined } from '@ant-design/icons';
import { useAppState } from '../../hooks/useAppState';
import { store } from '../../store';
import type { TraceEntry } from '../../types';
import { formatClock, formatDateTime, formatRelative, shortTrace, STATUS_META } from '../../utils/format';
import { AvatarBadge } from '../../components/AvatarBadge';
import { PlatformTag } from '../../components/PlatformTag';
import { StatusBadge } from '../../components/StatusBadge';
import { EmptyState } from '../../components/EmptyState';

const EVENT_META: Record<string, { label: string; color: string }> = {
  received: { label: '接收', color: '#8c8c8c' },
  redelivered: { label: '重复推送（幂等）', color: '#8c8c8c' },
  intent: { label: '意图识别', color: '#1677ff' },
  ocr: { label: 'OCR 识别', color: '#1677ff' },
  ocr_low_confidence: { label: 'OCR 低置信', color: '#faad14' },
  ocr_failed: { label: 'OCR 失败', color: '#ff4d4f' },
  processing: { label: '处理中', color: '#1677ff' },
  replied: { label: '已回复', color: '#13c2c2' },
  sent: { label: '已发送', color: '#722ed1' },
  synced: { label: '已同步', color: '#52c41a' },
  failed: { label: '发送失败', color: '#ff4d4f' },
  done: { label: '标记完成', color: '#595959' },
};

function eventMeta(event: string) {
  return EVENT_META[event] ?? { label: event, color: '#8c8c8c' };
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
          <p className="page__desc">按 traceId 回放「接收 → AI → 处理 → 回写 → 回流」的每一步，可用于审计与排障。</p>
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
          <section className="trace-summary">
            <div className="trace-summary__head">
              <AvatarBadge name={selected.sender.name} platform={selected.platform} size={40} />
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
                <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate(`/inbox/${selected.traceId}`)}>
                  回到消息
                </Button>
                <Button size="small" icon={<CopyOutlined />} onClick={copyLog}>
                  复制日志
                </Button>
              </div>
            </div>
          </section>

          <section className="trace-events">
            <div className="section-label">
              闭环日志 <span className="trace-events__count">{log.length} 条</span>
            </div>
            <Timeline
              className="trace-timeline"
              items={log.map((entry) => {
                const meta = eventMeta(entry.event);
                return {
                  color: meta.color,
                  children: (
                    <div className="trace-event">
                      <div className="trace-event__head">
                        <span className="trace-event__name" style={{ color: meta.color }}>
                          {meta.label}
                        </span>
                        <span className="trace-event__event mono">{entry.event}</span>
                        <span className="trace-event__time">{formatClock(entry.at)}</span>
                      </div>
                      {entry.detail && <div className="trace-event__detail">{entry.detail}</div>}
                      <div className="trace-event__status">状态：{STATUS_META[entry.status]?.label ?? entry.status}</div>
                    </div>
                  ),
                };
              })}
            />
            {!loading && log.length === 0 && <EmptyState title="暂无日志" description="这条消息还没有产生闭环事件。" />}
          </section>
        </div>
      )}
    </div>
  );
}