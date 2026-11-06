import { useId, useState, type ReactNode } from 'react';
import { DownOutlined } from '@ant-design/icons';

/**
 * 抽屉区块：一行"标题 + 摘要 + 箭头"，点开用 grid-template-rows 0fr→1fr 自适应滑出。
 *
 * 三个页面（运行指标 / 已完成 / 闭环日志）共用同一套结构与动效，
 * 保证"抽屉 + 半透明卡"的密度感是一致的。
 */
export function DrawerSection({
  title,
  summary,
  defaultOpen = false,
  className = '',
  onOpenChange,
  children,
}: {
  title: ReactNode;
  summary?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  /** 开合回调：给需要"只在展开时采样/请求"的场景用 */
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className={`drawer${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="drawer__head"
        onClick={() => {
          const next = !open;
          setOpen(next);
          onOpenChange?.(next);
        }}
        aria-expanded={open}
        aria-controls={bodyId}
      >
        <span className="drawer__label">
          <span className="drawer__title">{title}</span>
          {summary ? <span className="drawer__summary">{summary}</span> : null}
        </span>
        <DownOutlined className="drawer__chevron" />
      </button>

      <div className="drawer__body" id={bodyId} aria-hidden={!open}>
        <div className="drawer__inner">{children}</div>
      </div>
    </section>
  );
}
