import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReplyComposer } from './ReplyComposer';
import { MsgStatus, Platform } from '../../types';
import type { UnifiedMessage } from '../../types';

const message: UnifiedMessage = {
  traceId: 't-composer-1',
  platform: Platform.FEISHU,
  externalId: 'e-1',
  sender: { id: 'u1', name: '张三' },
  type: 'text',
  body: '周五前交周报',
  status: MsgStatus.RECEIVED,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function setup(overrides: { value?: string; sending?: boolean } = {}) {
  const onSend = vi.fn();
  const onChange = vi.fn();
  render(
    <ReplyComposer
      message={message}
      value={overrides.value ?? ''}
      sending={overrides.sending ?? false}
      onChange={onChange}
      onSend={onSend}
    />,
  );
  return { onSend, onChange, textarea: screen.getByRole('textbox') as HTMLTextAreaElement };
}

describe('ReplyComposer', () => {
  it('空内容时发送按钮禁用，Ctrl+Enter 不触发', () => {
    const { onSend, textarea } = setup();
    expect(screen.getByTestId('send-reply')).toBeDisabled();
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('非空内容按 Ctrl+Enter 触发发送', () => {
    const { onSend, textarea } = setup({ value: '收到，我确认一下' });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('普通 Enter 不发送（避免误触换行提交）', () => {
    const { onSend, textarea } = setup({ value: '收到' });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sending 中禁用发送，防止重复提交', () => {
    const { onSend, textarea } = setup({ value: '收到', sending: true });
    expect(screen.getByTestId('send-reply')).toBeDisabled();
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('提示中标注目标平台，说明回写按该平台格式转换', () => {
    setup({ value: '收到' });
    expect(screen.getByText(/飞书/)).toBeInTheDocument();
  });
});
