import { Button, Empty } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

export function EmptyState({
  title = '暂无消息',
  description = '当前筛选条件下没有匹配的消息，试着放宽条件。',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Empty
        image={<InboxOutlined className="empty-state__icon" />}
        imageStyle={{ height: 56 }}
        description={
          <div>
            <div className="empty-state__title">{title}</div>
            <div className="empty-state__desc">{description}</div>
          </div>
        }
      >
        {action}
      </Empty>
    </div>
  );
}

export function EmptyAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button size="small" onClick={onClick}>
      {children}
    </Button>
  );
}