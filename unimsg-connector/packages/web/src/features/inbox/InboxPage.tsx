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

  // 首次进入且未选中时，自动打开第一条，保证三栏布局一屏可读
  useEffect(() => {
    if (!traceId && visible.length > 0) {
      navigate(`/inbox/${visible[0].traceId}`, { replace: true });
    }
  }, [traceId, visible, navigate]);

  const hasFilter =
    Boolean(state.filters.status) ||
    Boolean(state.filters.type) ||
    state.filters.onlyReview ||
    Boolean(state.filters.keyword);

  return (
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
  );
}