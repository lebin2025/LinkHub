import { Alert, Card, Col, Row, Statistic, Tag, Tooltip } from 'antd';
import {
  ApiOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  DatabaseOutlined,
  ExperimentOutlined,
  InboxOutlined,
  SendOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { DeliveryMode } from '@unimsg/shared';
import { useAppState } from '../../hooks/useAppState';
import { Platform } from '../../types';
import type { AccountInfo, MailAccountInfo } from '../../services/api';
import { PLATFORM_META } from '../../utils/format';

/** 本次实际通道：真实接口=绿，Mock 模拟=橙（Mock 结果绝不伪装成真实成功） */
const MODE_META: Record<DeliveryMode, { label: string; color: 'success' | 'warning' }> = {
  real: { label: '真实接口', color: 'success' },
  mock: { label: 'Mock 模拟', color: 'warning' },
};

/** 通道策略文案（后端 policy 字段；未知值原样展示，避免前端写死后端取值） */
const POLICY_LABEL: Record<string, string> = {
  auto: '策略 auto（按凭据自动）',
  real: '策略 real（强制真实）',
  mock: '策略 mock（强制模拟）',
};

function policyLabel(policy: string): string {
  return POLICY_LABEL[policy] ?? `策略 ${policy}`;
}

/** 邮箱平台下的单个账号：只展示地址 / host / 监听目录，授权码永不下发 */
function MailAccountRow({ account }: { account: MailAccountInfo }) {
  const mode = account.mode ? MODE_META[account.mode] : undefined;
  return (
    <div className="mail-account">
      <div className="mail-account__head">
        <span className="mail-account__label">{account.label}</span>
        <span className="mail-account__key mono">{account.key}</span>
        {mode && (
          <Tag className="mail-account__mode" color={mode.color}>
            {mode.label}
          </Tag>
        )}
      </div>
      <div className="mail-account__addr mono">{account.address}</div>
      <div className="mail-account__line">
        IMAP <span className="mono">{account.imapHost}</span>
      </div>
      <div className="mail-account__line">
        SMTP <span className="mono">{account.smtpHost}</span>
      </div>
      <div className="mail-account__line">监听目录：{account.folders.join('、')}</div>
    </div>
  );
}

/** 单个平台账号卡：mode Tag + policy + missing + warnings/issues（导出便于渲染测试） */
export function AccountCard({ account }: { account: AccountInfo }) {
  const meta = PLATFORM_META[account.platform];
  const mode = account.mode ? MODE_META[account.mode] : undefined;
  const mailAccounts = account.platform === Platform.MAIL ? account.accounts ?? [] : [];
  const missing = account.missing ?? [];
  const warnings = account.warnings ?? [];
  const issues = account.issues ?? [];
  const hasAlerts = warnings.length > 0 || issues.length > 0;

  return (
    <Card className="account-card" data-testid={`account-card-${account.platform}`}>
      <div className="account-card__head">
        <span className="account-card__logo" style={{ background: meta.soft, color: meta.color }}>
          {meta.short}
        </span>
        <div className="account-card__title">
          <div className="account-card__name">{account.label ?? meta.name}</div>
          <div className="account-card__sub">
            {account.platform === Platform.MAIL
              ? 'IMAP 轮询收 · SMTP 发送 · 可挂多账号'
              : 'Webhook 接入 · 统一消息模型'}
          </div>
        </div>
        {mode && (
          <Tag className="account-card__mode" color={mode.color}>
            {mode.label}
          </Tag>
        )}
      </div>

      <div className="account-card__status">
        {account.configured ? (
          <Tag icon={<CheckCircleFilled />} color="success">
            已配置
          </Tag>
        ) : (
          <Tag icon={<CloseCircleFilled />} color="default">
            未配置
          </Tag>
        )}
        {account.policy && <span className="account-card__policy">{policyLabel(account.policy)}</span>}
        {account.canReceive === false && <span className="chip chip--warn">不可接收</span>}
        {account.canSend === false && <span className="chip chip--warn">不可发送</span>}
        {account.reason && <span className="account-card__hint">{account.reason}</span>}
      </div>

      {missing.length > 0 && (
        <div className="account-card__missing">
          缺少环境变量：<code>{missing.join('、')}</code>
        </div>
      )}

      {/* 能力缺口 / 配置问题：逐条一行，橙=warn、红=error；与 missing / reason 不重复堆叠 */}
      {hasAlerts && (
        <ul className="account-card__alerts" aria-label="能力与配置告警">
          {warnings.map((warning) => (
            <li className="account-card__alert" key={warning}>
              <WarningOutlined />
              <span>{warning}</span>
            </li>
          ))}
          {issues.map((issue) => (
            <li
              className={`account-card__alert${issue.level === 'error' ? ' account-card__alert--error' : ''}`}
              key={`${issue.level}-${issue.message}`}
            >
              {issue.level === 'error' ? <CloseCircleFilled /> : <WarningOutlined />}
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}

      {mailAccounts.length > 0 && (
        <div className="account-card__mail">
          {mailAccounts.map((mail) => (
            <MailAccountRow key={mail.key} account={mail} />
          ))}
        </div>
      )}
    </Card>
  );
}

export function AccountsPage() {
  const state = useAppState();
  const health = state.health;

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">
            <ApiOutlined /> 平台账号
          </h1>
          <p className="page__desc">
            四类数据源（飞书 / 钉钉 / 企业微信 / 邮箱）的接入状态与运行指标。密钥只在服务端环境变量中配置，前端永远不接触。
          </p>
        </div>
      </header>

      <Alert
        className="page__alert"
        type="info"
        showIcon
        message={state.demoMode ? '当前为前端 Mock 数据' : '已接入真实后端 /api/accounts'}
        description={
          state.demoMode
            ? '账号状态来自前端 Mock 服务，字段形状已与后端对齐。mode 是本次实际通道，missing 只给缺失的变量名，warnings / issues 展示能力缺口与配置问题；接入真实后端后自动切换数据源，页面无需改动。'
            : '账号状态来自服务端：mode 表示本次回写实际走的通道（real=真实接口 / mock=本地模拟），missing 只返回缺失的环境变量名，warnings / issues 只给文案与级别，任何密钥值都不会下发前端。'
        }
      />

      <Row gutter={[16, 16]} className="account-grid">
        {state.accounts.map((account) => (
          <Col xs={24} md={12} xl={6} key={account.platform}>
            <AccountCard account={account} />
          </Col>
        ))}
      </Row>

      <section className="metrics">
        <h2 className="section-title">运行指标</h2>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={8} lg={4}>
            <Card size="small">
              <Statistic title="接收" value={health?.received ?? 0} prefix={<InboxOutlined />} />
            </Card>
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Card size="small">
              <Statistic title="幂等去重" value={health?.deduped ?? 0} prefix={<DatabaseOutlined />} />
            </Card>
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Card size="small">
              <Statistic title="成功发送" value={health?.sent ?? 0} prefix={<SendOutlined />} />
            </Card>
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Card size="small">
              <Statistic
                title={
                  <Tooltip title="Mock 通道发送次数：未调用真实平台">
                    <span>模拟发送</span>
                  </Tooltip>
                }
                value={health?.sentMock ?? 0}
                valueStyle={{ color: (health?.sentMock ?? 0) > 0 ? '#faad14' : undefined }}
                prefix={<ExperimentOutlined />}
              />
            </Card>
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Card size="small">
              <Statistic
                title="发送失败"
                value={health?.failed ?? 0}
                valueStyle={{ color: (health?.failed ?? 0) > 0 ? '#ff4d4f' : undefined }}
                prefix={<WarningOutlined />}
              />
            </Card>
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Card size="small">
              <Statistic
                title="死信队列"
                value={health?.dlq ?? 0}
                valueStyle={{ color: (health?.dlq ?? 0) > 0 ? '#faad14' : undefined }}
                prefix={<WarningOutlined />}
              />
            </Card>
          </Col>
        </Row>
      </section>

      <section className="accounts-note">
        <h2 className="section-title">接入说明</h2>
        <ul>
          <li>
            四类数据源的凭据只从服务端环境变量读取，前端通过 <code>/api/accounts</code> 只获取「是否已配置、本次通道
            （mode）、缺失变量名（missing）与告警（warnings / issues）」，永远拿不到密钥值。
          </li>
          <li>
            mode 如实反映每次回写实际走的通道：real=真实平台接口，mock=本地模拟；Mock 结果不会显示成真实平台已收到。
          </li>
          <li>
            Webhook 由平台签名校验，统一入口 <code>/api/webhook/:platform</code>，与业务接口共用同一套消息模型。
          </li>
          <li>
            回复通过 <code>/api/messages/:id/reply</code> 异步回写，结果经 WebSocket 推送，前端不轮询。
          </li>
        </ul>
      </section>
    </div>
  );
}
