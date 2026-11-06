import { Input } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import type { UnifiedMessage } from '../../types';
import { RippleButton } from '../../components/RippleButton';
import { usePreferences } from '../settings/preferences';

const { TextArea } = Input;

export function ReplyComposer({
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
  const prefs = usePreferences();
  const canSend = value.trim().length > 0 && !sending;
  const enterToSend = prefs.sendKey === 'enter';

  return (
    <section className="composer" aria-label="回复编辑器">
      <TextArea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          enterToSend ? '输入回复内容…（Enter 发送 · Shift + Enter 换行）' : '输入回复内容…'
        }
        autoSize={{ minRows: 3, maxRows: 6 }}
        maxLength={2000}
        showCount
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !canSend) return;
          // 中文输入法确认候选词时也会触发 Enter，必须排除
          if (e.nativeEvent.isComposing) return;
          const shouldSend = enterToSend
            ? !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
            : e.ctrlKey || e.metaKey;
          if (shouldSend) {
            e.preventDefault();
            onSend();
          }
        }}
      />
      <div className="composer__bar">
        <RippleButton
          loading={sending}
          disabled={!canSend}
          onClick={onSend}
          data-testid="send-reply"
        >
          <SendOutlined />
          发送回复
        </RippleButton>
      </div>
    </section>
  );
}
