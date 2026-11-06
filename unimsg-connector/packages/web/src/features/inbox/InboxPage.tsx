import { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Select, Skeleton } from 'antd';
import { FilterOutlined, InboxOutlined } from '@ant-design/icons';
import { useAppState } from '../../hooks/useAppState';
import { store } from '../../store';
import { filterMessages } from '../../store/appStore';
import { MsgStatus } from '../../types';
import { STATUS_META, TYPE_LABEL } from '../../utils/format';
import { EmptyState } from '../../components/EmptyState';
import { FirstRunGuide, isEmptyFirstRun } from '../../components/FirstRunGuide';
import { MessageCard } from './MessageCard';
import { DetailPanel } from './DetailPanel';

const STATUS_OPTIONS = Object.values(MsgStatus).map((s) => ({
  value: s,
  label: STATUS_META[s].label,
}));

const TYPE_OPTIONS = (['text', 'image', 'file', 'todo'] as const).map((t) => ({
  value: t,
  label: TYPE_LABEL[t],
}));

export function InboxPage() {
  const state = useAppState();
  const navigate = useNavigate();
  const { traceId } = useParams();

  const visible = useMemo(() => filterMessages(state.messages, state.filters), [state.messages, state.filters]);
  const selected = traceId ? state.messages.find((m) => m.traceId === traceId) : undefined;

  // 首次进入且未选中、或 URL 里的 traceId 已不存在时，自动打开最新一条。
  // 后者常见于「内存存储 + 后端重启 / 消息被清空」：旧 URL 留着旧 traceId，
  // 列表已有新消息但右侧空白，容易被误读成「消息丢了」。
  useEffect(() => {
    if (state.loading || visible.length === 0) return;
    if (!traceId || !selected) {
      navigate(`/inbox/${visible[0].traceId}`, { replace: true });
    }
  }, [traceId, selected, visible, state.loading, navigate]);

  const hasFilter =
    Boolean(state.filters.status) ||
    Boolean(state.filters.type) ||
    state.filters.onlyReview ||
    Boolean(state.filters.keyword);

  // 首启空收件箱：顶部展示 3 步上手；此处的空态文案也不能再说「没有匹配的消息」
  const isEmptyInbox = isEmptyFirstRun({
    demoMode: state.demoMode,
    messageCount: state.messages.length,
    received: state.health?.received ?? 0,
  });

  return (
    <div className="inbox-page">
      <FirstRunGuide
        demoMode={state.demoMode}
        messageCount={state.messages.length}
        received={state.health?.received ?? 0}
        accounts={state.accounts}
        connection={state.connection}
        apiBase={import.meta.env.VITE_API_BASE}
        loading={state.loading}
        error={state.error}
        onOpenAccounts={() => navigate('/accounts')}
      />
      <div className={`inbox${traceId ? ' inbox--detail' : ''}`}>
      <section className="list-pane" aria-label="消息列表">
        <div className="list-header">
          <div className="list-header__title">
            <InboxOutlined />
            收件箱
            <span className="list-header__count">{visible.length}</span>
          </div>
          <div className="list-header__tools">
            <Select
              size="small"
              allowClear
              placeholder="状态"
              value={state.filters.status}
              options={STATUS_OPTIONS}
              onChange={(value) => store.setFilters({ status: value })}
              style={{ width: 96 }}
            />
            <Select
              size="small"
              allowClear
              placeholder="类型"
              value={state.filters.type}
              options={TYPE_OPTIONS}
              onChange={(value) => store.setFilters({ type: value })}
              style={{ width: 88 }}
            />
            <Button
              size="small"
              type={state.filters.onlyReview ? 'primary' : 'default'}
              icon={<FilterOutlined />}
              onClick={() => store.setFilters({ onlyReview: !state.filters.onlyReview })}
            >
              需确认
            </Button>
          </div>
        </div>

        <div className="list-scroll">
          {state.loading ? (
            <div className="list-loading">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="list-loading__card">
                  <Skeleton avatar active paragraph={{ rows: 2 }} />
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            state.error ? (
              <EmptyState
                title="消息加载失败"
                description="按上方错误提示排查后端（是否启动、端口与 token 是否一致）后刷新页面重试。"
              />
            ) : isEmptyInbox ? (
              <EmptyState
                title="还没有收到消息"
                description="打开「平台账号」核对接入状态，或接入一个真实平台后等待第一条消息。"
              />
            ) : (
              <EmptyState
                title="没有匹配的消息"
                description="换一个平台或状态，或者清空搜索条件。"
                action={
                  <Button
                    size="small"
                    onClick={() => {
                      store.resetFilters();
                      navigate('/inbox');
                    }}
                  >
                    清空筛选
                  </Button>
                }
              />
            )
          ) : (
            visible.map((message) => (
              <MessageCard
                key={message.traceId}
                message={message}
                active={message.traceId === traceId}
                onSelect={(id) => navigate(`/inbox/${id}`)}
              />
            ))
          )}
        </div>

        {hasFilter && (
          <div className="list-footer">
            已按条件筛选 ·{' '}
            <button type="button" className="link-btn" onClick={() => store.resetFilters()}>
              清空
            </button>
          </div>
        )}
      </section>

      <section className="detail-pane" aria-label="消息详情">
        {state.loading ? (
          <div className="detail-loading">
            <Skeleton active paragraph={{ rows: 6 }} />
          </div>
        ) : selected ? (
          <DetailPanel message={selected} />
        ) : (
          <EmptyState title="选择一条消息" description="从左侧列表中点击任意消息，查看详情并直接回复。" />
        )}
      </section>
      </div>
    </div>
  );
}