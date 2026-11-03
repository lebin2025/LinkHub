import { MsgStatus } from '../../types';
import { STATUS_FLOW, STATUS_META } from '../../utils/format';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';

const RANK: Record<MsgStatus, number> = {
  [MsgStatus.RECEIVED]: 0,
  [MsgStatus.PROCESSING]: 1,
  [MsgStatus.REPLIED]: 2,
  [MsgStatus.SENT]: 3,
  [MsgStatus.SYNCED]: 4,
  [MsgStatus.FAILED]: 2,
};

/** 状态机可视化：received → processing → replied → sent → synced（失败单独标红） */
export function StatusFlow({ status }: { status: MsgStatus }) {
  const current = RANK[status];
  const failed = status === MsgStatus.FAILED;

  return (
    <div className="status-flow" aria-label="消息状态流转">
      {STATUS_FLOW.map((step, index) => {
        const reached = index <= current;
        const isCurrent = !failed && index === current;
        const meta = STATUS_META[step];
        return (
          <div
            key={step}
            className={`status-step${reached ? ' is-reached' : ''}${isCurrent ? ' is-current' : ''}`}
          >
            <span className="status-step__dot" style={{ background: reached ? meta.color : '#d9dce3' }}>
              {reached && <CheckOutlined />}
            </span>
            <span className="status-step__label">{meta.label}</span>
            {index < STATUS_FLOW.length - 1 && (
              <span
                className="status-step__line"
                style={{ background: index < current ? meta.color : '#e6e9f0' }}
              />
            )}
          </div>
        );
      })}

      {failed && (
        <div className="status-step status-step--failed is-current">
          <span className="status-step__dot" style={{ background: '#ff4d4f' }}>
            <CloseOutlined />
          </span>
          <span className="status-step__label" style={{ color: '#ff4d4f' }}>
            发送失败
          </span>
        </div>
      )}
    </div>
  );
}