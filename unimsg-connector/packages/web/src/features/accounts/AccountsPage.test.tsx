import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccountCard } from './AccountsPage';
import { ACCOUNTS } from '../../services/mock/fixtures';
import { Platform } from '../../types';

function accountOf(platform: Platform) {
  const account = ACCOUNTS.find((a) => a.platform === platform);
  if (!account) throw new Error(`fixture 缺少平台：${platform}`);
  return account;
}

describe('AccountCard', () => {
  it('邮箱平台展示多账号、地址、IMAP/SMTP 与监听目录，mode Tag 为真实接口', () => {
    render(<AccountCard account={accountOf(Platform.MAIL)} />);

    expect(screen.getByText('邮箱')).toBeInTheDocument();
    expect(screen.getByText('QQ邮箱')).toBeInTheDocument();
    expect(screen.getByText('me@qq.com')).toBeInTheDocument();
    expect(screen.getByText('imap.qq.com')).toBeInTheDocument();
    expect(screen.getByText('smtp.qq.com')).toBeInTheDocument();
    expect(screen.getByText(/监听目录：INBOX、Junk/)).toBeInTheDocument();
    expect(screen.getAllByText('真实接口').length).toBeGreaterThan(0);
    // 配置问题（issues）逐条展示：warn / error 都可见
    expect(screen.getByText(/MAIL_WORK_PROVIDER=custom/)).toBeInTheDocument();
    expect(screen.getByText(/MAIL_HR_AUTH_CODE/)).toBeInTheDocument();
    expect(screen.getByText(/该账号已跳过/)).toBeInTheDocument();
  });

  it('部分配置平台展示 Mock 模拟 Tag、缺失变量与能力缺口告警（warnings）', () => {
    render(<AccountCard account={accountOf(Platform.WECOM)} />);

    expect(screen.getByText('Mock 模拟')).toBeInTheDocument();
    expect(screen.getByText('未配置')).toBeInTheDocument();
    expect(screen.getByText(/WECOM_SECRET、WECOM_AGENT_ID/)).toBeInTheDocument();
    expect(screen.getByText('不可发送')).toBeInTheDocument();
    expect(screen.queryByText('不可接收')).not.toBeInTheDocument();
    // 可替换性关键提示：能收不能发 + 企微可信 IP 限制
    expect(screen.getByText(/只能收不能发：缺少 WECOM_SECRET \/ WECOM_AGENT_ID/)).toBeInTheDocument();
    expect(screen.getByText(/企业微信要求发信出口 IP 在企业可信 IP 内/)).toBeInTheDocument();
  });

  it('健康平台只展示状态与原因，不渲染空告警区块', () => {
    const { container } = render(<AccountCard account={accountOf(Platform.FEISHU)} />);

    expect(screen.getByText('已配置')).toBeInTheDocument();
    expect(screen.getByText('真实接口')).toBeInTheDocument();
    expect(screen.getByText('凭据齐全，auto → 真实接口')).toBeInTheDocument();
    expect(container.querySelector('.account-card__alerts')).toBeNull();
  });
});
