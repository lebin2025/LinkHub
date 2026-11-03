import { Alert, Card, Col, Row, Statistic, Tag } from 'antd';
import {
  ApiOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  DatabaseOutlined,
  InboxOutlined,
  SendOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useAppState } from '../../hooks/useAppState';
import { PLATFORM_META } from '../../utils/format';

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
          <p className="page__desc">三平台接入状态与运行指标。密钥只在服务端环境变量中配置，前端永远不接触。</p>
        </div>
      </header>

      <Alert
        className="page__alert"
        type="info"
        showIcon
        message="当前为 Mock 数据"
        description="本页面数据来自前端 Mock 服务，接口形状已与后端对齐。接入真实后端后，只需替换数据源，无需改动页面。"
      />

      <Row gutter={[16, 16]} className="account-grid">
        {state.accounts.map((account) => {
          const meta = PLATFORM_META[account.platform];
          return (
            <Col xs={24} md={8} key={account.platform}>
              <Card className="account-card" bordered>
                <div className="account-card__head">
                  <span className="account-card__logo" style={{ background: meta.soft, color: meta.color }}>
                    {meta.short}
                  </span>
                  <div>
                    <div className="account-card__name">{meta.name}</div>
                    <div className="account-card__sub">Webhook 接入 · 统一消息模型</div>
                  </div>
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
                  <span className="account-card__hint">
                    {account.configured ? '凭据已就绪（Mock 模拟）' : '缺少环境变量，发送会回退 Mock'}
                  </span>
                </div>
              </Card>
            </Col>
          );
        })}
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
          <li>三平台凭据只从服务端环境变量读取，前端通过 `/api/accounts` 仅获取「是否已配置」的布尔值。</li>
          <li>Webhook 由平台签名校验，统一入口 `/api/webhook/:platform`，与业务接口共用同一套消息模型。</li>
          <li>回复通过 `/api/messages/:id/reply` 异步回写，结果经 WebSocket 推送，前端不轮询。</li>
        </ul>
      </section>
    </div>
  );
}