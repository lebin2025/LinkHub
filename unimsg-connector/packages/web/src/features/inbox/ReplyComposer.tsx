import { Button, Input } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import type { UnifiedMessage } from '../../types';
import { PLATFORM_META } from '../../utils/format';

const { TextArea } = Input;

export function ReplyComposer({
  message,
  value,
  sending,
  onChange,
  onSend,
}: {
  message: UnifiedMessage;
  value: string;
  sending: boolean;
  onChange: (text: string) => void;
  onSend: () => void;
}) {
  const platform = PLATFORM_META[message.platform];
  const canSend = value.trim().length > 0 && !sending;

  return (
    <section className="composer" aria-label="回复编辑器">
      <TextArea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="输入回复内容…（Ctrl / ⌘ + Enter 发送）"
        autoSize={{ minRows: 3, maxRows: 6 }}
        maxLength={2000}
        showCount
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canSend) {
            e.preventDefault();
            onSend();
          }
        }}
      />
      <div className="composer__bar">
        <span className="composer__hint">
          回复将按 <b style={{ color: platform.color }}>{platform.name}</b> 格式转换后回写
        </span>
        <Button
          type="primary"
          icon={<SendOutlined />}
          disabled={!canSend}
          loading={sending}
          onClick={onSend}
          data-testid="send-reply"
        >
          发送回复
        </Button>
      </div>
    </section>
  );
}