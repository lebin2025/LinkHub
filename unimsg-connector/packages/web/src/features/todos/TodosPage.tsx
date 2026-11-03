import { useNavigate } from 'react-router-dom';
import { Button, Checkbox } from 'antd';
import { CheckSquareOutlined, RightOutlined } from '@ant-design/icons';
import { useAppState } from '../../hooks/useAppState';
import { store } from '../../store';
import { formatRelative } from '../../utils/format';
import { PlatformTag } from '../../components/PlatformTag';
import { StatusBadge } from '../../components/StatusBadge';
import { AvatarBadge } from '../../components/AvatarBadge';
import { EmptyState } from '../../components/EmptyState';

export function TodosPage() {
  const state = useAppState();
  const navigate = useNavigate();

  const todos = state.messages
    .filter((m) => m.type === 'todo')
    .sort((a, b) => Number(Boolean(a.done)) - Number(Boolean(b.done)) || +new Date(b.createdAt) - +new Date(a.createdAt));

  const pending = todos.filter((m) => !m.done).length;

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">
            <CheckSquareOutlined /> 待办
            <span className="page__count">{pending}</span>
          </h1>
          <p className="page__desc">从三平台消息中识别出的待办事项，可直接标记完成或回到消息页回复。</p>
        </div>
      </header>

      {todos.length === 0 ? (
        <EmptyState title="暂无待办" description="当消息被识别为「待办」类型时，会出现在这里。" />
      ) : (
        <div className="todo-list">
          {todos.map((todo) => (
            <div key={todo.traceId} className={`todo-row${todo.done ? ' is-done' : ''}`}>
              <Checkbox
                checked={Boolean(todo.done)}
                onChange={() => {
                  if (!todo.done) void store.markDone(todo.traceId);
                }}
                onClick={(e) => e.stopPropagation()}
              />
              <AvatarBadge name={todo.sender.name} platform={todo.platform} size={30} />
              <div className="todo-row__main" onClick={() => navigate(`/inbox/${todo.traceId}`)}>
                <div className="todo-row__title">
                  <span className="todo-row__sender">{todo.sender.name}</span>
                  <PlatformTag platform={todo.platform} small />
                  <span className="todo-row__time">{formatRelative(todo.createdAt)}</span>
                </div>
                <div className="todo-row__body">{todo.body}</div>
              </div>
              <StatusBadge status={todo.status} small />
              <Button
                type="text"
                size="small"
                className="todo-row__go"
                icon={<RightOutlined />}
                onClick={() => navigate(`/inbox/${todo.traceId}`)}
                aria-label="查看消息"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}