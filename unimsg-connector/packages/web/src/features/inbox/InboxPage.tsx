import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { App as AntApp, Button, Select, Skeleton } from 'antd';
import { FilterOutlined } from '@ant-design/icons';
import { useAppState } from '../../hooks/useAppState';
import { useHotkeys } from '../../hooks/useHotkeys';
import { store } from '../../store';
import { filterMessages } from '../../store/appStore';
import { MsgStatus, Platform } from '../../types';
import { PLATFORM_META, STATUS_META, TYPE_LABEL } from '../../utils/format';
import { navigateWithMorph } from '../../utils/morph';
import { injectSample, type InjectPlatform } from '../../services/demoSamples';
import { EmptyState } from '../../components/EmptyState';
import { QuickStart } from '../../components/QuickStart';
import { isEmptyFirstRun } from '../../components/FirstRunGuide';
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

/** 平台筛选：从顶栏搬进列表头，横向 tab 比下拉更省一次点击 */
const PLATFORM_TABS: Array<{ value?: Platform; label: string }> = [
  { value: undefined, label: '全部' },
  { value: Platform.FEISHU, label: PLATFORM_META[Platform.FEISHU].name },
  { value: Platform.DINGTALK, label: PLATFORM_META[Platform.DINGTALK].name },
  { value: Platform.WECOM, label: '企微' },
  { value: Platform.MAIL, label: PLATFORM_META[Platform.MAIL].name },
];

/** 把焦点交给回复框；详情还没打开时先等一帧 */
function focusReplyComposer() {
  const focus = (): boolean => {
    const el = document.querySelector<HTMLTextAreaElement>('.composer textarea');
    if (!el) return false;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    return true;
  };
  if (!focus()) window.setTimeout(focus, 80);
}

export function InboxPage() {
  const state = useAppState();
  const navigate = useNavigate();
  const { traceId } = useParams();
  const [listCollapsed, setListCollapsed] = useState(false);
  const toast = AntApp.useApp().message;
  const injectSeq = useRef(0);

  const visible = useMemo(() => filterMessages(state.messages, state.filters), [state.messages, state.filters]);
  const selected = traceId ? state.messages.find((m) => m.traceId === traceId) : undefined;

  /**
   * 旧 traceId 失效时回退到列表（内存存储重启 / 消息被清空后很常见）。
   *
   * 与队友那次修复的意图一致——右侧不留空白、不让人误以为消息丢了；
   * 但收件箱默认已经改成「卡片网格」，直接跳最新一条会让人以为自己点错了消息，
   * 所以这里回退到网格，而不是替用户选一条。
   */
  useEffect(() => {
    if (state.loading || visible.length === 0) return;
    if (traceId && !selected) {
      navigate('/inbox', { replace: true });
    }
  }, [traceId, selected, visible, state.loading, navigate]);

  /** 打开详情：走共享元素转场（卡片长大成详情）；不支持的环境自动退化为普通跳转 */
  const openMessage = (id: string) => navigateWithMorph(navigate, `/inbox/${id}`);

  /** 空态一键注入：真实后端走 webhook（真实入站链路），Mock 模式走本地模拟 */
  const handleInject = async (platform?: InjectPlatform) => {
    try {
      if (state.demoMode || !platform) {
        await store.simulateIncoming();
        return;
      }
      const base = import.meta.env.VITE_API_BASE ?? '';
      await injectSample(platform, injectSeq.current++, base);
      await store.refresh();
      toast.success(`已注入一条${PLATFORM_META[platform].name}消息`);
    } catch (e) {
      toast.error(`注入失败：${e instanceof Error ? e.message : '未知错误'}`);
    }
  };

  const hasFilter =
    Boolean(state.filters.status) ||
    Boolean(state.filters.type) ||
    state.filters.onlyReview ||
    Boolean(state.filters.keyword);

  // 首启空收件箱：顶部展示 3 步上手；此处的空态文案也不能再说「没有匹配的消息」
  // 键盘流：j/k 上下、Enter 打开、r 回复、e 完成、Esc 收起详情
  const selectedIndex = traceId ? visible.findIndex((m) => m.traceId === traceId) : -1;
  const openAt = (index: number) => {
    const target = visible[Math.max(0, Math.min(visible.length - 1, index))];
    if (target) openMessage(target.traceId);
  };

  useHotkeys({
    j: () => openAt(selectedIndex + 1),
    k: () => openAt(selectedIndex < 0 ? 0 : selectedIndex - 1),
    enter: () => {
      if (!traceId && visible[0]) openMessage(visible[0].traceId);
    },
    e: () => {
      if (selected && !selected.done) void store.markDone(selected.traceId);
    },
    r: () => focusReplyComposer(),
    Escape: () => {
      if (traceId) navigate('/inbox');
    },
  });

  const isEmptyInbox = isEmptyFirstRun({
    demoMode: state.demoMode,
    messageCount: state.messages.length,
    received: state.health?.received ?? 0,
  });

  const cards = visible.map((message) => (
    <MessageCard
      key={message.traceId}
      message={message}
      active={message.traceId === traceId}
      variant={traceId ? 'compact' : 'card'}
      onSelect={openMessage}
      onReply={(id) => {
        openMessage(id);
        focusReplyComposer();
      }}
      onDone={(id) => void store.markDone(id)}
      onTrace={(id) => navigate(`/trace/${id}`)}
    />
  ));

  return (
    <div className="inbox-page">
      <div
        className={`inbox${traceId ? ' inbox--detail' : ' inbox--cards'}${
          traceId && listCollapsed ? ' is-collapsed' : ''
        }`}
      >
      <section className="list-pane" aria-label="消息列表">
        <div className="list-header">
          <div className="list-tabs" role="tablist" aria-label="平台筛选">
            {PLATFORM_TABS.map((tab) => (
              <button
                key={tab.label}
                type="button"
                role="tab"
                aria-selected={state.filters.platform === tab.value}
                className="list-tab"
                onClick={() => store.setFilters({ platform: tab.value })}
              >
                {tab.label}
              </button>
            ))}
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
            <span className="list-header__count" title="当前列表消息数">
              {visible.length}
            </span>
          </div>
        </div>

        <div className={`list-scroll${traceId ? '' : ' list-scroll--cards'}`}>
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
              <QuickStart demoMode={state.demoMode} onInject={handleInject} />
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
            traceId ? (
              /* 详情打开后：卡片换成「时间轴 + 平台色点」的紧凑流（结构化签名，不是装饰线） */
              <div className="list-stream">{cards}</div>
            ) : (
              cards
            )
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
          <DetailPanel
            key={selected.traceId}
            message={selected}
            listCollapsed={listCollapsed}
            onToggleList={() => setListCollapsed((v) => !v)}
          />
        ) : (
          <EmptyState title="选择一条消息" description="从左侧列表中点击任意消息，查看详情并直接回复。" />
        )}
      </section>
      </div>
    </div>
  );
}