/**
 * 「连接账号」授权中心（个人版首启向导）。
 *
 * 目标：把「去各平台后台翻配置」变成一条按推荐顺序的清单（邮箱 → 钉钉 → 飞书 → 微信），
 * 每个平台只说三件事：现在什么状态、下一步点哪里、管理员要做什么。
 *
 * 复用边界（不在本页重复实现）：
 *  - 钉钉本人身份 → 现有 PersonalIdentityModal（浏览器登录 / 设备码 + 倒计时）；
 *  - 飞书 OAuth → 现有 useFeishuOAuth（回跳反馈 / 弹窗被拦截兜底）；
 *  - .env 改动需重启 → 现有 checkEnvRestart 判定；
 *  - 管理员清单 / 命令 → 后端 onboarding.actions 下发，前端只负责复制或打开展示。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { App as AntApp, Alert, Button, Popconfirm, Progress, Skeleton, Tag, Typography } from 'antd';
import {
  ApiOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  DingdingOutlined,
  ExportOutlined,
  GlobalOutlined,
  LinkOutlined,
  MailOutlined,
  ReloadOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  WechatOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../../hooks/useAppState';
import { Platform } from '../../types';
import { PlatformGlyph } from '../../components/PlatformGlyph';
import type {
  AppConfigSaveResult,
  MailAccountView,
  OnboardingAction,
  OnboardingStep,
  OnboardingView,
} from '../../services/api';
import { store } from '../../store';
import { checkEnvRestart } from '../../utils/envRestart';
import {
  displayMailAddress,
  dwsSourceLabel,
  ONBOARDING_STATE_META,
  overallProgress,
  sortOnboardingSteps,
} from '../../utils/onboarding';
import { PersonalIdentityModal } from '../accounts/PersonalIdentityModal';
import { FeishuOAuthHelp } from '../accounts/FeishuOAuthHelp';
import { useFeishuOAuth } from '../accounts/useFeishuOAuth';
import { MailAccountForm } from './MailAccountForm';
import { mailProviderLabel } from './mailProviders';
import { AppConfigModal } from './AppConfigModal';
import { RestartNotice } from './RestartNotice';
import { interpretAppConfigSave } from './appConfigResult';
import {
  humanizeMissingKeys,
  type AppConfigGroup,
} from './appConfigFields';

const STEP_ICON: Record<string, ReactNode> = {
  mail: <MailOutlined />,
  dingtalk: <DingdingOutlined />,
  feishu: <PlatformGlyph platform={Platform.FEISHU} size={16} />,
  wechat: <WechatOutlined />,
};

const STEP_ORDER_HINT = '按 邮箱 → 钉钉 → 飞书 → 微信 的顺序连接';

/** 后端 managers 清单里的「管理员项」：前端只展示/复制，不引导普通用户去改企业后台 */
function stepOwnerNote(step: OnboardingStep): string | undefined {
  if (step.state === 'needs_admin') return '需要企业管理员在平台后台开通，可把下面的清单发给管理员。';
  if (step.state === 'needs_install') return '需要先在这台机器安装/配置运行环境，完成后点「刷新状态」。';
  return undefined;
}

export function ConnectPage() {
  const state = useAppState();
  const navigate = useNavigate();
  const { message: toast } = AntApp.useApp();
  const feishu = useFeishuOAuth({ onLinked: () => { void load(true); } });

  const [onboarding, setOnboarding] = useState<OnboardingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [mailAccounts, setMailAccounts] = useState<MailAccountView[]>([]);
  const [mailError, setMailError] = useState('');
  const [mailOpen, setMailOpen] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string>();
  const [verifyingKey, setVerifyingKey] = useState<string>();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dingtalkOpen, setDingtalkOpen] = useState(false);
  const [autoStartDingtalk, setAutoStartDingtalk] = useState(false);
  const [blockedLink, setBlockedLink] = useState<{ label: string; url: string } | null>(null);
  const [appConfigOpen, setAppConfigOpen] = useState(false);
  const [appConfigGroup, setAppConfigGroup] = useState<AppConfigGroup>('feishu');
  const [showRestart, setShowRestart] = useState(false);
  const [restartApplied, setRestartApplied] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  /** 保存结果未生效（如身份被 .env 锁定）：常驻在页面顶部，不能静默 */
  const [configWarning, setConfigWarning] = useState<string | null>(null);

  const appConfig = state.appConfig;

  const load = useCallback(async (silent = false): Promise<void> => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const view = await store.refreshOnboarding();
      if (view) {
        setOnboarding(view);
        setError('');
      } else {
        setError(
          '暂时读不到连接状态（可能 LinkHub 版本较旧，或后台还没启动）。'
          + '可以先到「平台账号」页手动查看各平台的状态。',
        );
      }
      try {
        setMailAccounts(await store.mailAccounts());
        setMailError('');
      } catch (e) {
        setMailError(e instanceof Error ? e.message : '读取邮箱账号失败');
      }
      const config = await store.refreshAppConfig();
      if (config?.restartRequired) setShowRestart(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const steps = useMemo(
    () => sortOnboardingSteps(onboarding?.steps ?? []),
    [onboarding],
  );
  const progress = overallProgress(onboarding);
  /** 待处理数：以后端 needsAction 为准；若后端仍给 0 但 ready<total，按未就绪数兜底，避免「0 项待处理」误导 */
  const displayNeedsAction = progress.ready < progress.total
    ? Math.max(progress.needsAction, progress.total - progress.ready)
    : progress.needsAction;
  const dingtalkStep = steps.find((s) => s.id === 'dingtalk');

  const dingtalkAccount = state.accounts.find((a) => a.platform === Platform.DINGTALK);
  // 钉钉登录弹窗需要完整 PlatformIdentityView：只从 /api/accounts 取，不用 onboarding detail 的摘要
  const dingtalkIdentity = dingtalkAccount?.identity;
  const dingtalkMocked = dingtalkStep?.state === 'mock'
    || (dingtalkIdentity
      ? dingtalkIdentity.effectiveSend === 'mock' && dingtalkIdentity.effectiveReceive === 'mock'
      : dingtalkAccount?.mode === 'mock');
  const dingtalkDetail = (dingtalkStep?.detail ?? {}) as Record<string, unknown>;
  const dingtalkEffectiveSend = typeof dingtalkDetail.effectiveSend === 'string'
    ? dingtalkDetail.effectiveSend
    : undefined;
  /** 后端是否已把钉钉身份策略切到「仅本人身份」（app-config / detail 都可作依据） */
  const dingtalkIdentityMode = typeof state.appConfig?.identity?.dingtalk === 'string'
    ? state.appConfig.identity.dingtalk
    : typeof dingtalkDetail.runtimePolicy === 'string'
      ? dingtalkDetail.runtimePolicy
      : undefined;
  /**
   * 「已启用本人身份但未登录」：例如用户登录后又注销/取消。
   * 此时必须显式提示重新登录；发送失败原因以后端 failureReason 为准，不能写成「模拟发送」。
   */
  const dingtalkUserUnlinked = Boolean(dingtalkStep)
    && dingtalkStep?.state !== 'ready'
    && !dingtalkIdentity?.user.linked
    && (dingtalkIdentityMode === 'user' || dingtalkEffectiveSend === 'user');

  useEffect(() => {
    if (appConfig?.restartRequired) setShowRestart(true);
  }, [appConfig?.restartRequired]);

  // .env 改了但后端没重启：复用账号页同一条判定与文案
  const envRestart = checkEnvRestart(state.health);

  async function refreshAll(): Promise<void> {
    await load(true);
    toast.success('已刷新各平台连接状态');
  }

  /** 打开「平台应用配置」弹窗：定位到对应平台分组 */
  function openAppConfig(group: AppConfigGroup): void {
    setAppConfigGroup(group);
    setAppConfigOpen(true);
  }

  /** 配置弹窗保存后的页面联动：需要重启时给出常驻提示 */
  function handleAppConfigSaved(result: AppConfigSaveResult): void {
    if (result.restartRequired) setShowRestart(true);
    void load(true);
    void store.refreshAccounts();
  }

  /** 「我已重启，重新检测」：health + app-config 都重新拉，restartRequired=false 才算生效 */
  async function recheckRestart(): Promise<void> {
    setRechecking(true);
    try {
      await store.refreshHealth();
      const config = await store.loadAppConfig();
      if (config.restartRequired) {
        toast.warning('还没生效：请确认 LinkHub 已重新打开（桌面版可用菜单「配置 → 重新加载」）');
      } else {
        setShowRestart(false);
        setRestartApplied(true);
        toast.success('重新检测完成：配置已生效');
        await load(true);
        await store.refreshAccounts();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '重新检测失败，请稍后重试');
    } finally {
      setRechecking(false);
    }
  }

  /**
 * 统一处理 PUT /api/app-config 的保存结果（白号二轮审计 P1-2）：
 *  - applied：真的热应用了 → 成功 toast；
 *  - restart：静态凭据已保存 → 现有重启常驻提示；
 *  - ignored/failed：绝不 toast 成功；把 .env 锁定键显示为页面常驻警告。
 * 返回 true 表示「已经生效」，调用方可以继续后续动作（如拉起登录）。
 */
  function applySaveOutcome(result: AppConfigSaveResult, identityOnly?: boolean): boolean {
    const outcome = interpretAppConfigSave(result, { identityOnly });
    if (outcome.status === 'applied') {
      setConfigWarning(null);
      toast.success(outcome.message);
      return true;
    }
    if (outcome.status === 'restart') {
      setConfigWarning(null);
      setShowRestart(true);
      toast.warning('已保存，需要重新打开 LinkHub 后生效');
      return false;
    }
    if (outcome.status === 'ignored') {
      setConfigWarning(outcome.message);
      toast.warning(outcome.message);
      return false;
    }
    setConfigWarning(outcome.message);
    toast.error(outcome.message);
    return false;
  }

  /**
   * 只切身份模式（钉钉「仅用本人身份」）：后端热应用，不需要重启。
   * 返回 true 表示已生效、可以继续登录；被 .env 锁定/需要重启时明确提示并返回 false。
   */
  async function enablePersonalOnly(): Promise<boolean> {
    try {
      const result = await store.saveAppConfig({ identity: { dingtalk: 'user' } });
      const applied = applySaveOutcome(result, true);
      await Promise.all([load(true), store.refreshAccounts()]);
      return applied;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '切换「仅用本人身份」失败，请稍后重试');
      return false;
    }
  }

  /**
   * 打开钉钉本人登录弹窗（一登即用）。
   *
   * 关键时序（二轮 UI 复验 P1）：**登录前绝不预写 identity**。
   *  - 登录成功后由后端自动启用「仅本人身份」，前端只刷新状态；
   *  - 用户在弹窗里取消/关闭时，不做任何配置变更、不出现「需要重启」。
   */
  async function dingtalkPersonalLoginFlow(): Promise<void> {
    setAutoStartDingtalk(true);
    setDingtalkOpen(true);
  }

  /**
   * 邮箱「启用真实收信」（后端 modes.mail=real）。
   * modes.* 属于静态键：保存成功也需要重启；被 .env 锁定时不得提示成功。
   */
  async function enableMailReal(): Promise<void> {
    try {
      const result = await store.saveAppConfig({ modes: { mail: 'real' } });
      applySaveOutcome(result);
      await Promise.all([load(true), store.refreshAccounts()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '切换真实收信失败，请稍后重试');
    }
  }

  /** 验证已保存的邮箱账号：成功后标记「已验证」并刷新列表/授权中心 */
  async function verifyMailAccount(key: string): Promise<void> {
    setVerifyingKey(key);
    try {
      const result = await store.mailAccountVerify(key);
      if (result.ok) {
        toast.success('邮箱账号已验证，可以真实收信');
      } else {
        toast.error(result.message ?? '验证失败：请检查邮箱授权码与收信设置');
      }
      await load(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '验证失败，请稍后重试');
    } finally {
      setVerifyingKey(undefined);
    }
  }

  /** 切回「自动身份」：已启用仅本人但不想登录/登录失效时的退路（热应用） */
  async function switchDingtalkAuto(): Promise<void> {
    try {
      const result = await store.saveAppConfig({ identity: { dingtalk: 'auto' } });
      applySaveOutcome(result, true);
      await Promise.all([load(true), store.refreshAccounts()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '切回自动身份失败，请稍后重试');
    }
  }

  /** 打开外部链接：优先 window.open；被浏览器拦截时展示可点击链接（绝不静默失败） */
  function openLink(label: string, url?: string): void {
    if (!url) {
      toast.warning('暂时没有这个入口的链接，请到对应平台官网手动打开');
      return;
    }
    let popup: Window | null = null;
    try {
      popup = window.open(url, '_blank', 'noopener');
    } catch {
      popup = null;
    }
    if (popup) {
      setBlockedLink(null);
    } else {
      setBlockedLink({ label, url });
      toast.warning('浏览器拦截了新窗口，请点页面上的链接继续');
    }
  }

  /** 复制文本：clipboard 不可用（http / 非安全上下文）时退化为 textarea + execCommand */
  async function copyText(text: string | undefined, what = '内容'): Promise<void> {
    const content = text?.trim();
    if (!content) {
      toast.warning(`暂时没有可复制的${what}`);
      return;
    }
    try {
      await navigator.clipboard.writeText(content);
      toast.success(`已复制${what}`);
      return;
    } catch {
      // 继续走兜底
    }
    try {
      const area = document.createElement('textarea');
      area.value = content;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      if (ok) toast.success(`已复制${what}`);
      else toast.info('自动复制被浏览器拒绝，请手动选择文本复制');
    } catch {
      toast.info('自动复制被浏览器拒绝，请手动选择文本复制');
    }
  }

  async function deleteMailAccount(key: string): Promise<void> {
    setDeletingKey(key);
    try {
      await store.mailAccountDelete(key);
      toast.success('已删除本地邮箱账号');
      await load(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除邮箱账号失败，请稍后重试');
    } finally {
      setDeletingKey(undefined);
    }
  }

  /** api 类动作：识别后端下发的已知动作，其余引导到平台账号页 */
  async function runApiAction(step: OnboardingStep, action: OnboardingAction): Promise<void> {
    // `*-configure`：打开「平台应用配置」弹窗对应分组（飞书/钉钉/微信）
    if (action.id.endsWith('-configure')) {
      openAppConfig(step.id as AppConfigGroup);
      return;
    }
    // 已连接平台的「刷新连接状态」是 GET 自检：刷新本页即可，别重新拉起登录
    if (action.id.endsWith('-status')) {
      await refreshAll();
      return;
    }
    // 钉钉：只打开现有登录弹窗（成功后由后端自动启用本人身份；取消/关闭无副作用）
    if (
      action.id === 'dingtalk-personal-login'
      || action.id === 'dingtalk-login'
      || action.id === 'dingtalk-login-recommended'
    ) {
      await dingtalkPersonalLoginFlow();
      return;
    }
    // 已登录但运行态仍是 mock：显式切「仅本人身份」（热应用，处理 saved/hotApplied/ignoredByEnv）
    if (action.id === 'dingtalk-enable-personal-only') {
      await enablePersonalOnly();
      return;
    }
    // 取消登录后的退路：切回自动身份（热应用）
    if (action.id === 'dingtalk-identity-auto') {
      await switchDingtalkAuto();
      return;
    }
    // 邮箱：后端下发「启用真实收信」时切 modes.mail=real
    if (action.id === 'mail-enable-real') {
      await enableMailReal();
      return;
    }
    // 通用 app-config 动作（后端 payload 里带 identity/modes 等）：只白名单执行 app-config
    if (action.path === '/api/app-config' && action.payload) {
      try {
        const payload = action.payload as Parameters<typeof store.saveAppConfig>[0];
        const identityOnly = Boolean(payload.identity)
          && !payload.platforms && !payload.llm && !payload.modes;
        const result = await store.saveAppConfig(payload);
        applySaveOutcome(result, identityOnly);
        await Promise.all([load(true), store.refreshAccounts()]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '保存配置失败，请稍后重试');
      }
      return;
    }
    if (step.id === 'dingtalk') {
      await dingtalkPersonalLoginFlow();
      return;
    }
    if (step.id === 'feishu') {
      await feishu.connect();
      return;
    }
    toast.info(`「${action.label}」需要在「平台账号」页完成`);
    navigate('/accounts');
  }

  function runAction(step: OnboardingStep, action: OnboardingAction): void {
    // 后端可能把 configure 动作标成 form/api：统一拦截，不要让邮箱表单误开
    if (action.id.endsWith('-configure')) {
      openAppConfig(step.id as AppConfigGroup);
      return;
    }
    switch (action.kind) {
      case 'link':
        openLink(action.label, action.url);
        break;
      case 'copy':
        void copyText(action.text, '管理员清单');
        break;
      case 'command':
        void copyText(action.command, '命令');
        break;
      case 'form':
        setMailOpen(true);
        setExpanded((prev) => ({ ...prev, [step.id]: true }));
        break;
      case 'api':
        void runApiAction(step, action);
        break;
      default:
        toast.info('暂不支持这个操作，请到「平台账号」页查看');
    }
  }

  function renderMailList(): ReactNode {
    if (mailError) {
      return <Alert type="warning" showIcon message="读取邮箱账号失败" description={mailError} />;
    }
    if (mailAccounts.length === 0) {
      return (
        <div className="mail-accounts__empty">
          还没有通过 LinkHub 添加的邮箱账号。添加后即可在收件箱查看邮件，并以你自己的邮箱回复。
        </div>
      );
    }
    return (
      <ul className="mail-accounts" data-testid="mail-accounts">
        {mailAccounts.map((account) => (
          <li className="mail-accounts__item" key={account.key}>
            <span className="mail-accounts__addr">{displayMailAddress(account)}</span>
            <span className="mail-accounts__meta">
              {(account.provider || account.label) && (
                <span>{account.provider ? mailProviderLabel(account.provider) : account.label}</span>
              )}
              <Tag color={account.source === 'file' ? 'blue' : 'default'}>
                {account.source === 'file' ? '本地' : '来自部署配置'}
              </Tag>
              {account.verified === true && <Tag color="success">已验证</Tag>}
              {account.verified === false && <Tag color="warning">未验证</Tag>}
            </span>
            {account.source === 'file' ? (
              <Popconfirm
                title="删除这个邮箱账号？"
                description="只删除 LinkHub 里保存的账号；部署配置里的不受影响。"
                okText="删除"
                cancelText="取消"
                onConfirm={() => void deleteMailAccount(account.key)}
              >
                <Button
                  size="small"
                  danger
                  type="text"
                  loading={deletingKey === account.key}
                  disabled={deletingKey !== undefined}
                >
                  删除
                </Button>
              </Popconfirm>
            ) : (
              <span className="mail-accounts__env-hint">不能在页面删除；请让管理员修改部署配置后重新打开 LinkHub</span>
            )}
            {account.verified === false && (
              <span className="mail-accounts__verify-hint">
                未验证：添加时点「测试连接」通过后才算邮箱已就绪
              </span>
            )}
            {account.verified === false && account.source === 'file' && (
              <Button
                size="small"
                icon={<CheckCircleOutlined />}
                loading={verifyingKey === account.key}
                disabled={verifyingKey !== undefined || deletingKey !== undefined}
                onClick={() => void verifyMailAccount(account.key)}
              >
                测试验证
              </Button>
            )}
          </li>
        ))}
      </ul>
    );
  }

  function renderActions(step: OnboardingStep): ReactNode {
    const actions = resolvedActions(step);
    const commandActions = actions.filter((a) => a.kind === 'command');
    const buttonActions = actions.filter((a) => a.kind !== 'command');
    /** 客户视图按钮文案：不直接出现 .env 等内部词 */
    const actionLabel = (action: OnboardingAction): string =>
      action.label.replace(/\.env 键名/g, '技术细节').replace(/\.env/g, '部署配置');
    // 安装/下载命令是客户必须执行的；doctor 自检属于开发者排障，折叠进「高级」避免首屏技术噪音
    const installCommands = commandActions.filter((action) =>
      /install|下载|安装/i.test(`${action.id} ${action.label}`),
    );
    const advancedCommands = commandActions.filter((action) => !installCommands.includes(action));
    const renderCommand = (action: OnboardingAction) => (
      <div className="connect-card__command" key={action.id}>
        <span className="connect-card__command-label">命令</span>
        <Typography.Text
          code
          copyable={{ text: action.command ?? '', tooltips: ['复制命令', '已复制'] }}
        >
          {action.command ?? action.label}
        </Typography.Text>
      </div>
    );
    return (
      <>
        {buttonActions.length > 0 && (
          <div className="connect-card__actions">
            {buttonActions.map((action, index) => (
              <Button
                key={action.id}
                type={index === 0 && step.state !== 'ready' ? 'primary' : 'default'}
                size="small"
                icon={actionIcon(action)}
                onClick={() => runAction(step, action)}
              >
                {actionLabel(action)}
              </Button>
            ))}
          </div>
        )}
        {buttonActions
          .filter((a) => a.kind === 'copy' && a.text)
          .map((action) => (
            <details className="connect-card__copy-preview" key={`${action.id}-preview`}>
              <summary>查看要复制的内容</summary>
              <pre>{action.text}</pre>
            </details>
          ))}
        {installCommands.map(renderCommand)}
        {advancedCommands.length > 0 && (
          <details className="connect-card__advanced">
            <summary>高级 / 开发者：命令行自检（可选）</summary>
            {advancedCommands.map(renderCommand)}
          </details>
        )}
      </>
    );
  }

  /**
   * 卡片动作：以后端 onboarding.actions 为准，同时保证「白号没有凭据」也有主 CTA：
   *  - 钉钉：主按钮固定为「用钉钉本人账号登录（推荐，无需机器人应用）」（一登即用）；
   *  - 飞书 / 微信：缺凭据时补「填写应用凭据」；
   *  - 邮箱：补「添加邮箱账号」。
   * 后端已下发的同名动作会去重，不重复出现两个登录/配置按钮。
   */
  function resolvedActions(step: OnboardingStep): OnboardingAction[] {
    let actions = [...step.actions];
    const dingtalkLinked = Boolean(dingtalkIdentity?.user.linked);
    if (step.id === 'dingtalk' && step.state !== 'ready') {
      actions = actions.filter(
        (action) => action.id !== 'dingtalk-login'
          && action.id !== 'dingtalk-enable-personal-only'
          && action.id !== 'dingtalk-login-recommended'
          && action.id !== 'dingtalk-personal-login',
      );
      if (dingtalkLinked) {
        // 已登录但运行态还是 mock：只切身份模式，不再重复登录
        actions.unshift({ id: 'dingtalk-enable-personal-only', kind: 'api', label: '启用本人身份模式（无需重启）' });
      } else {
        // 未登录 / 已切本人身份但登录失效：只打开登录弹窗，不预写配置
        actions.unshift({
          id: 'dingtalk-login',
          kind: 'api',
          label: dingtalkUserUnlinked
            ? '重新登录钉钉本人账号'
            : '用钉钉本人账号登录（推荐，无需机器人应用）',
        });
      }
      // 取消登录后的退路：仍保留「填写钉钉应用凭据（改用机器人）」入口
      if (!actions.some((action) => action.id.endsWith('-configure') || action.kind === 'form')) {
        actions.push({
          id: 'dingtalk-configure',
          kind: 'api',
          label: '填写钉钉应用凭据（改用机器人）',
        });
      }
      // 已启用仅本人身份时，给「切回自动身份」小入口（热应用，无需重启）
      if (dingtalkIdentityMode === 'user') {
        actions.push({ id: 'dingtalk-identity-auto', kind: 'api', label: '切回自动身份' });
      }
    }
    if (step.id === 'mail' && !actions.some((action) => action.kind === 'form')) {
      actions.push({
        id: 'mail-add-fallback',
        kind: 'form',
        label: mailAccounts.length > 0 ? '再添加一个邮箱' : '添加邮箱账号',
      });
    }
    const hasConfigure = actions.some((action) => action.id.endsWith('-configure'));
    if (
      step.id !== 'mail'
      && step.id !== 'dingtalk'
      && step.state !== 'ready'
      && !hasConfigure
      && !actions.some((action) => action.kind === 'form')
    ) {
      actions.unshift({
        id: `${step.id}-configure`,
        kind: 'api',
        label: step.id === 'feishu' ? '填写飞书应用凭据' : '填写微信辅助程序地址（给管理员）',
      });
    }
    return actions;
  }

  /** 客户化提示：后端给运维看的「改 .env / MAIL_MODE」文案，换成客户可执行的下一步 */
  function customerHint(step: OnboardingStep, hint: string): string {
    // 后端 hint 里的内部键名/命令收进「高级 / 开发者」，客户视图只留人话
    const sanitized = hint
      .replace(/DINGTALK_IDENTITY=user/g, '身份策略：仅本人')
      .replace(/DINGTALK_IDENTITY=bot/g, '身份策略：仅机器人')
      .replace(/FEISHU_IDENTITY=user/g, '飞书身份策略：仅本人')
      .replace(/FEISHU_IDENTITY=bot/g, '飞书身份策略：仅机器人')
      .replace(/DINGTALK_IDENTITY/g, '钉钉身份策略')
      .replace(/FEISHU_IDENTITY/g, '飞书身份策略')
      .replace(/dws auth login[^\s；;。]*/g, '钉钉登录命令（见「高级 / 开发者」）')
      .replace(/\.env/g, '部署配置')
      .replace(/\bidentity=user\b/g, '本人身份');
    // 后端 hint 里的「用浏览器登录（推荐）」是弹窗里的按钮名；卡片 CTA 叫法不同，改成真实可见的按钮名
    if (step.id === 'dingtalk') {
      return sanitized.replace(
        /点「用浏览器登录（推荐）」/g,
        '点下方「用钉钉本人账号登录（推荐，无需机器人应用）」',
      );
    }
    if (step.id === 'mail' && /MAIL_MODE/.test(sanitized)) {
      return '邮箱通道会随账号自动切换：添加账号并点「测试连接」验证通过后即可真实收信（无需修改部署配置或重启）。';
    }
    return sanitized;
  }

  function renderCard(step: OnboardingStep): ReactNode {
    const meta = ONBOARDING_STATE_META[step.state];
    const ready = step.state === 'ready';
    const open = !ready || Boolean(expanded[step.id]);
    const ownerNote = stepOwnerNote(step);
    const missingLabels = humanizeMissingKeys(step.detail?.missing);
    return (
      <section
        className={`connect-card connect-card--${meta.tone}${ready ? ' connect-card--ready' : ''}`}
        data-testid={`connect-step-${step.id}`}
        key={step.id}
      >
        <header className="connect-card__head">
          <span className="connect-card__icon" aria-hidden="true">
            {STEP_ICON[step.id] ?? <LinkOutlined />}
          </span>
          <div className="connect-card__titles">
            <div className="connect-card__title-row">
              <span className="connect-card__label">{step.label}</span>
              <Tag color={meta.tagColor} className="connect-card__state">
                {meta.label}
              </Tag>
            </div>
            <p className="connect-card__summary">{step.summary}</p>
          </div>
          <div className="connect-card__tools">
            {ready && (
              <>
                <Button
                  size="small"
                  type="text"
                  icon={<ReloadOutlined />}
                  loading={refreshing}
                  onClick={() => void refreshAll()}
                >
                  刷新状态
                </Button>
                <Button size="small" type="text" onClick={() => toggleExpanded(step.id)}>
                  {open ? '收起' : '查看详情'}
                </Button>
              </>
            )}
          </div>
        </header>

        {open && (
          <div className="connect-card__body">
            {ownerNote && <div className="connect-card__owner">{ownerNote}</div>}
            {missingLabels.length > 0 && step.id !== 'mail' && (
              <div className="connect-card__missing" data-testid={`connect-missing-${step.id}`}>
                <span>还缺：{missingLabels.join('、')}</span>
                {step.id === 'dingtalk' ? (
                  <span className="connect-card__missing-note">
                    也可以不填：直接用「用钉钉本人账号登录」。
                  </span>
                ) : (
                  <Button size="small" type="link" onClick={() => openAppConfig(step.id as AppConfigGroup)}>
                    填写配置
                  </Button>
                )}
              </div>
            )}
            {step.id === 'dingtalk' && dingtalkUserUnlinked && (
              <div className="connect-card__identity-warning" data-testid="dingtalk-identity-warning">
                已启用「仅本人身份」但当前未登录：请点下方「重新登录钉钉本人账号」完成授权后再收发；
                未登录期间的发送会失败并显示原因。
              </div>
            )}
            {step.hints.length > 0 && (
              <ul className="connect-card__hints">
                {step.hints.map((hint) => (
                  <li key={hint}>{customerHint(step, hint)}</li>
                ))}
              </ul>
            )}

            {step.id === 'mail' && (
              <div className="mail-section">
                {renderMailList()}
                {mailOpen && (
                  <MailAccountForm
                    onCancel={() => setMailOpen(false)}
                    onSaved={() => {
                      setMailOpen(false);
                      setExpanded((prev) => ({ ...prev, mail: true }));
                      void load(true);
                    }}
                  />
                )}
              </div>
            )}

            {renderActions(step)}

            {/* 飞书授权未完成（常见 20029 重定向 URL 有误）：在卡片动作旁就地给修复步骤与真实回调地址 */}
            {step.id === 'feishu' && (
              <FeishuOAuthHelp
                className="connect-alert"
                unfinished={feishu.unfinished}
                fallbackUrl={feishu.fallbackUrl}
                redirectUri={feishu.redirectUri}
                connecting={feishu.connecting}
                onReconnect={() => void feishu.connect()}
                onDismiss={feishu.dismiss}
              />
            )}

            {ready && step.hints.length === 0 && step.actions.length === 0 && (
              <div className="connect-card__empty">已连接，无需额外操作。</div>
            )}
          </div>
        )}
      </section>
    );
  }

  function toggleExpanded(id: string): void {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="page connect-page">
      <header className="page__head connect-page__head">
        <div>
          <h1 className="page__title">
            <LinkOutlined /> 连接账号
          </h1>
          <p className="connect-page__sub">
            个人版只需连接你自己的账号；带「需管理员」的项由企业管理员在平台后台开通。
          </p>
        </div>
        <div className="connect-page__head-actions">
          <Button icon={<SettingOutlined />} onClick={() => openAppConfig('feishu')}>
            平台应用配置
          </Button>
          <Button
            icon={<ReloadOutlined />}
            loading={refreshing}
            onClick={() => void refreshAll()}
          >
            刷新状态
          </Button>
          <Button type="text" icon={<ApiOutlined />} onClick={() => navigate('/accounts')}>
            平台账号页
          </Button>
        </div>
      </header>

      {state.demoMode && (
        <Alert
          className="connect-alert"
          type="info"
          showIcon
          message="当前是前端演示模式：不会连接真实账号"
          description="当前没有连上真实后台，这里不会伪造「已连接」；连上真实后台后，会显示各平台真实连接状态、可执行的动作与管理清单。"
        />
      )}

      {error && (
        <Alert
          className="connect-alert"
          type="warning"
          showIcon
          message="授权中心暂不可用"
          description={error}
          action={
            <div className="connect-alert__actions">
              <Button size="small" onClick={() => void load()}>重试</Button>
              <Button size="small" type="link" onClick={() => navigate('/accounts')}>
                去平台账号页
              </Button>
            </div>
          }
        />
      )}

      {/* 重启提示统一成一个常驻 Alert：避免「已保存」与「检测到配置已修改」两块黄条重复 */}
      {!appConfigOpen && (envRestart.needed || showRestart || restartApplied) && (
        <RestartNotice
          applied={restartApplied}
          detected={envRestart.needed && !showRestart}
          rechecking={rechecking}
          onRecheck={() => void recheckRestart()}
          appliedText="配置已生效：平台状态已重新检测，无需重启。"
        />
      )}

      {!appConfigOpen && configWarning && (
        <Alert
          className="connect-alert"
          data-testid="connect-config-warning"
          type="warning"
          showIcon
          closable
          message="以下配置没有生效（由部署配置固定，页面改不了）"
          description={configWarning}
          onClose={() => setConfigWarning(null)}
        />
      )}

      {blockedLink && (
        <Alert
          className="connect-alert"
          type="warning"
          showIcon
          message="浏览器拦截了新窗口"
          description={
            <div className="connect-alert__detail">
              <span>请点下面这个链接打开「{blockedLink.label}」：</span>
              <a href={blockedLink.url} target="_blank" rel="noreferrer">
                {blockedLink.url}
              </a>
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={() => void copyText(blockedLink.url, '链接')}
              >
                复制链接
              </Button>
            </div>
          }
          action={
            <Button size="small" type="text" onClick={() => setBlockedLink(null)}>
              知道了
            </Button>
          }
        />
      )}

      {loading && !onboarding ? (
        <div className="connect-skeleton">
          <Skeleton active paragraph={{ rows: 10 }} />
        </div>
      ) : (
        <>
          <section className="connect-progress" aria-label="授权进度">
            <div className="connect-progress__head">
              <div>
                <span className="connect-progress__value">{progress.label}</span>
                <span className="connect-progress__hint">
                  {STEP_ORDER_HINT}
                  {displayNeedsAction > 0 ? `，还有 ${displayNeedsAction} 项待处理` : ''}
                </span>
              </div>
              <span className="connect-progress__dws">
                <ThunderboltOutlined /> 钉钉运行环境：{dwsSourceLabel(onboarding?.dws.source)}
              </span>
            </div>
            <Progress percent={progress.percent} showInfo={false} strokeColor="var(--brand)" />
            <div className="connect-progress__meta">
              已就绪 {progress.ready} 项 · 待处理 {displayNeedsAction} 项
              {onboarding?.firstRun ? ' · 首次使用建议从「邮箱」开始' : ''}
            </div>
          </section>

          <div className="connect-steps">
            {steps.map((step) => renderCard(step))}
          </div>

          {progress.total > 0 && progress.ready >= progress.total && (
            <Alert
              className="connect-alert"
              type="success"
              showIcon
              message="四个平台都已就绪"
              description="收件箱会持续汇总各平台消息；需要换账号时回到这一页重新连接即可。"
            />
          )}

          <p className="connect-page__footnote">
            <CheckCircleOutlined /> 状态以 LinkHub 实时检测为准；改完部署配置要重新打开 LinkHub，平台状态才会更新。
            本页不会显示任何密码、授权码或密钥。
          </p>
        </>
      )}

      <PersonalIdentityModal
        open={dingtalkOpen}
        identity={dingtalkIdentity}
        mockMode={Boolean(dingtalkMocked)}
        autoStart={autoStartDingtalk ? 'browser' : undefined}
        successToast="钉钉本人登录成功，本人身份已自动启用（无需重启）"
        onRefresh={() => {
          void load(true);
          void store.refreshAccounts();
        }}
        onClose={() => {
          setDingtalkOpen(false);
          setAutoStartDingtalk(false);
        }}
      />

      <AppConfigModal
        open={appConfigOpen}
        initialGroup={appConfigGroup}
        onClose={() => setAppConfigOpen(false)}
        onSaved={handleAppConfigSaved}
      />
    </div>
  );
}

/** 动作按钮图标：让「打开后台 / 复制 / 登录 / 填表」一眼可区分 */
function actionIcon(action: OnboardingAction): ReactNode {
  switch (action.kind) {
    case 'link':
      return <ExportOutlined />;
    case 'copy':
      return <CopyOutlined />;
    case 'form':
      return <MailOutlined />;
    case 'api':
      return <GlobalOutlined />;
    default:
      return <LinkOutlined />;
  }
}



