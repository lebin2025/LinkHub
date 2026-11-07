import { MsgStatus } from '../types';
import { STATUS_META, toneStyle } from '../utils/format';

export function StatusBadge({ status, small = false }: { status: MsgStatus; small?: boolean }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`status-badge${small ? ' status-badge--small' : ''}${status === MsgStatus.FAILED ? ' status-badge--failed' : ''}`}
      style={toneStyle(meta)}
      data-status={status}
    >
      <span className="status-badge__dot" style={{ background: meta.color }} />
      {meta.label}
    </span>
  );
}