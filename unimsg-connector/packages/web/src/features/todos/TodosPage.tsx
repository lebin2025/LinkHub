import { useNavigate } from 'react-router-dom';
import { Checkbox } from 'antd';
import {
  CheckCircleFilled,
  CheckSquareOutlined,
  ClockCircleOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useAppState } from '../../hooks/useAppState';
import { store } from '../../store';
import type { UnifiedMessage } from '../../types';
import { formatRelative } from '../../utils/format';
import { formatDue, groupTodos } from '../../utils/due';
import { PlatformTag } from '../../components/PlatformTag';
import { StatusBadge } from '../../components/StatusBadge';
import { EmptyState } from '../../components/EmptyState';
import { DrawerSection } from '../../components/DrawerSection';

function TodoCard({ todo, onOpen }: { todo: UnifiedMessage; onOpen: (traceId: string) => void }) {
  const due = formatDue(todo.dueAt);

  return (
    <article
      className={`surface-card surface-card--hover todo-card${todo.done ? ' is-done' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${todo.sender.name}：${todo.body}`}
      onClick={() => onOpen(todo.traceId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(todo.traceId);
        }
      }}
    >
      <span className="todo-card__check" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={Boolean(todo.done)}
          onChange={() => {
            if (!todo.done) void store.markDone(todo.traceId);
          }}
        />
      </span>

      <div className="todo-card__main">
        <div className="todo-card__title">
          <span className="todo-card__sender">{todo.sender.name}</span>
          <PlatformTag platform={todo.platform} small />
          <span className="todo-card__time">{formatRelative(todo.createdAt)}</span>
        </div>
        <p className="todo-card__body">{todo.body}</p>
        <div className="todo-card__foot">
          <StatusBadge status={todo.status} small />
          {due && !todo.done && (
            <span className={`todo-card__due todo-card__due--${due.tone}`}>
              <ClockCircleOutlined aria-hidden="true" /> {due.text}
            </span>
          )}
          <RightOutlined className="todo-card__go" aria-hidden="true" />
        </div>
      </div>
    </article>
  );
}

export function TodosPage() {
  const state = useAppState();
  const navigate = useNavigate();

  const todos = state.messages.filter((m) => m.type === 'todo');
  const pending = todos.filter((m) => !m.done);
  const doneItems = todos.filter((m) => m.done);
  const groups = groupTodos(pending);
  const open = (traceId: string) => navigate(`/inbox/${traceId}`);

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">
            <CheckSquareOutlined /> 待办
            <span className="page__count">{pending.length}</span>
          </h1>
        </div>
      </header>

      {todos.length === 0 ? (
        <EmptyState title="暂无待办" description="当消息被识别为「待办」类型时，会出现在这里。" />
      ) : (
        <>
          {groups.length > 0 ? (
            groups.map((group) => (
              <section key={group.key} className={`todo-group todo-group--${group.key}`}>
                <div className="todo-group__head">
                  <span className="todo-group__label">{group.label}</span>
                  <span className="todo-group__count">{group.items.length}</span>
                </div>
                <div className="todo-grid">
                  {group.items.map((todo) => (
                    <TodoCard key={todo.traceId} todo={todo} onOpen={open} />
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div className="todo-done-hint">
              <CheckCircleFilled /> 全部完成
            </div>
          )}

          {doneItems.length > 0 && (
            <DrawerSection title="已完成" summary={`${doneItems.length} 项`}>
              <div className="todo-grid todo-grid--drawer">
                {doneItems.map((todo) => (
                  <TodoCard key={todo.traceId} todo={todo} onOpen={open} />
                ))}
              </div>
            </DrawerSection>
          )}
        </>
      )}
    </div>
  );
}
