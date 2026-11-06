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

/**
 * 状态机可视化：received → processing → replied → sent → synced（失败单独标红）。
 *
 * 视觉规则：不画连接线，只用「一排圆点 + 标签」表达进度；全流程灰度，
 * **当前态**才用唯一的品牌强调色，避免彩虹色破坏"至多一个强调色"的纪律。
 */
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
            <span
              className={`status-step__dot${reached ? ' is-reached' : ''}${isCurrent ? ' is-current' : ''}`}
            >
              {reached && <CheckOutlined />}
            </span>
            <span className="status-step__label">{meta.label}</span>
          </div>
        );
      })}

      {failed && (
        <div className="status-step status-step--failed is-current">
          <span className="status-step__dot status-step--failed">
            <CloseOutlined />
          </span>
          <span className="status-step__label status-step--failed">发送失败</span>
        </div>
      )}
    </div>
  );
}
