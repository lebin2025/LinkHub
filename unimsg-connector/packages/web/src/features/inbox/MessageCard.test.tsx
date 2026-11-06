import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageCard } from './MessageCard';
import { MsgStatus, Platform } from '../../types';
import type { UnifiedMessage } from '../../types';

const message: UnifiedMessage = {
  traceId: 't-card-1',
  platform: Platform.FEISHU,
  externalId: 'e-1',
  sender: { id: 'u1', name: '张三' },
  type: 'text',
  body: '周五前交周报，重点写联调进展。',
  intent: '待办',
  status: MsgStatus.RECEIVED,
  needsReview: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('MessageCard', () => {
  it('渲染平台、状态、意图与需人工确认标记', () => {
    render(<MessageCard message={message} active={false} onSelect={() => {}} />);
    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.getByText('飞书')).toBeInTheDocument();
    expect(screen.getByText('已接收')).toBeInTheDocument();
    expect(screen.getByText('待办')).toBeInTheDocument();
    expect(screen.getByText('需人工确认')).toBeInTheDocument();
  });

  it('点击卡片回传 traceId', async () => {
    const onSelect = vi.fn();
    render(<MessageCard message={message} active={false} onSelect={onSelect} />);
    // 卡片本身是 role=button，行内快捷操作是它内部的按钮，这里按可访问名称定位卡片
    await userEvent.click(screen.getByRole('button', { name: /张三/ }));
    expect(onSelect).toHaveBeenCalledWith('t-card-1');
  });
});