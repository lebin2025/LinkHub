import { useEffect, useRef, useState } from 'react';
import { App as AntApp, Button, Input, Modal, Popconfirm, Segmented, Switch, Tabs } from 'antd';
import {
  BgColorsOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  MessageOutlined,
  PictureOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import { useAppState } from '../../hooks/useAppState';
import { useTheme, type ThemePreference } from '../../app/ThemeProvider';
import {
  AVATAR_TONES,
  DEFAULT_PROFILE,
  initialOf,
  resetProfile,
  saveProfile,
  useProfile,
} from './profile';
import {
  patchPreferences,
  resetPreferences,
  usePreferences,
  type Density,
  type MotionLevel,
  type SendKey,
} from './preferences';

const MAX_AVATAR_BYTES = 300 * 1024;
const APP_VERSION = '1.0.0';
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

/** 一行设置：左侧标题 + 说明，右侧控件 */
function Row({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row__text">
        <div className="set-row__title">{title}</div>
        {description && <div className="set-row__desc">{description}</div>}
      </div>
      <div className="set-row__control">{children}</div>
    </div>
  );
}

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const profile = useProfile();
  const prefs = usePreferences();
  const state = useAppState();
  const { mode, preference, setPreference } = useTheme();
  const { message } = AntApp.useApp();

  const [name, setName] = useState(profile.name);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatarUrl);
  const fileRef = useRef<HTMLInputElement>(null);

  // 每次打开都同步为已保存的值，避免上次未提交的编辑残留
  useEffect(() => {
    if (!open) return;
    setName(profile.name);
    setAvatarUrl(profile.avatarUrl);
  }, [open, profile]);

  function commitName() {
    const trimmed = name.trim();
    if (!trimmed) {
      message.warning('名称不能为空');
      setName(profile.name);
      return;
    }
    if (trimmed !== profile.name) {
      saveProfile({ ...profile, name: trimmed.slice(0, 24) });
    }
  }

  function handleFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      message.error('请选择图片文件');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      message.error('图片请小于 300KB（会存在浏览器本地）');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      setAvatarUrl(url);
      saveProfile({ ...profile, name: name.trim() || profile.name, avatarUrl: url });
    };
    reader.onerror = () => message.error('读取图片失败，请重试');
    reader.readAsDataURL(file);
  }

  function handleResetAll() {
    resetProfile();
    resetPreferences();
    setName(DEFAULT_PROFILE.name);
    setAvatarUrl(null);
    message.success('已恢复默认设置');
  }

  const connectionText = state.demoMode
    ? '前端演示模式（未接后端）'
    : state.error
      ? '连接异常'
      : state.connection === 'connected'
        ? '已连接'
        : state.connection === 'reconnecting'
          ? '重连中'
          : '未连接';

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="设置"
      width={700}
      centered
      footer={null}
      className="settings-modal"
    >
      <Tabs
        className="settings-tabs"
        tabPosition="left"
        items={[
          {
            key: 'profile',
            label: (
              <span>
                <UserOutlined /> 个人资料
              </span>
            ),
            children: (
              <div className="set-pane">
                <div className="settings__avatar-row">
                  <div className="settings__avatar" style={{ background: profile.tone }}>
                    {avatarUrl ? <img src={avatarUrl} alt="头像预览" /> : <span>{initialOf(name)}</span>}
                  </div>
                  <div className="settings__avatar-actions">
                    <div className="settings__hint">JPG / PNG，小于 300KB；不传图片就用名字首字。</div>
                    <div className="settings__avatar-btns">
                      <Button icon={<PictureOutlined />} onClick={() => fileRef.current?.click()}>
                        上传
                      </Button>
                      {avatarUrl && (
                        <Button
                          icon={<DeleteOutlined />}
                          onClick={() => {
                            setAvatarUrl(null);
                            saveProfile({ ...profile, name: name.trim() || profile.name, avatarUrl: null });
                          }}
                        >
                          移除
                        </Button>
                      )}
                    </div>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      handleFile(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </div>

                <Row title="显示名称">
                  <Input
                    value={name}
                    maxLength={24}
                    style={{ width: 220 }}
                    placeholder="例如：张三"
                    onChange={(e) => setName(e.target.value)}
                    onBlur={commitName}
                    onPressEnter={commitName}
                  />
                </Row>

                <Row title="头像底色" description="不传图片时，头像用名字首字 + 这个底色。">
                  <div className="settings__tones">
                    {AVATAR_TONES.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`settings__tone${profile.tone === color ? ' is-active' : ''}`}
                        style={{ background: color }}
                        aria-label={`选择底色 ${color}`}
                        aria-pressed={profile.tone === color}
                        onClick={() => saveProfile({ ...profile, name: name.trim() || profile.name, tone: color })}
                      />
                    ))}
                  </div>
                </Row>
              </div>
            ),
          },
          {
            key: 'appearance',
            label: (
              <span>
                <BgColorsOutlined /> 外观
              </span>
            ),
            children: (
              <div className="set-pane">
                <Row title="主题" description="跟随系统时，系统切深浅色会同步变化。">
                  <Segmented
                    value={preference}
                    onChange={(value) => setPreference(value as ThemePreference)}
                    options={[
                      { label: '明色', value: 'light' },
                      { label: '暗色', value: 'dark' },
                      { label: '跟随系统', value: 'system' },
                    ]}
                  />
                </Row>
                <Row title="界面密度" description="紧凑会压缩列表与详情的留白，一屏看更多。">
                  <Segmented
                    value={prefs.density}
                    onChange={(value) => patchPreferences({ density: value as Density })}
                    options={[
                      { label: '舒适', value: 'comfortable' },
                      { label: '紧凑', value: 'compact' },
                    ]}
                  />
                </Row>
                <Row title="动效" description="减弱会关闭过渡与弹性动画。">
                  <Segmented
                    value={prefs.motion}
                    onChange={(value) => patchPreferences({ motion: value as MotionLevel })}
                    options={[
                      { label: '完整', value: 'full' },
                      { label: '减弱', value: 'reduced' },
                    ]}
                  />
                </Row>
                <div className="set-note">当前生效：{mode === 'dark' ? '暗色' : '明色'}</div>
              </div>
            ),
          },
          {
            key: 'message',
            label: (
              <span>
                <MessageOutlined /> 消息
              </span>
            ),
            children: (
              <div className="set-pane">
                <Row title="发送快捷键" description="在回复框里按什么键直接发送。">
                  <Segmented
                    value={prefs.sendKey}
                    onChange={(value) => patchPreferences({ sendKey: value as SendKey })}
                    options={[
                      { label: '⌘/Ctrl + Enter', value: 'mod-enter' },
                      { label: '仅 Enter', value: 'enter' },
                    ]}
                  />
                </Row>
                <Row title="显示 AI 建议" description="关闭后详情页不再出现建议卡片。">
                  <Switch
                    checked={prefs.showAiDraft}
                    onChange={(checked) => patchPreferences({ showAiDraft: checked })}
                  />
                </Row>
              </div>
            ),
          },
          {
            key: 'about',
            label: (
              <span>
                <InfoCircleOutlined /> 关于
              </span>
            ),
            children: (
              <div className="set-pane">
                <div className="set-kv">
                  <div>
                    <span>版本</span>
                    <b>v{APP_VERSION}</b>
                  </div>
                  <div>
                    <span>接口地址</span>
                    <b className="mono">{API_BASE || '未配置（前端演示模式）'}</b>
                  </div>
                  <div>
                    <span>连接状态</span>
                    <b>{connectionText}</b>
                  </div>
                </div>

                <div className="set-actions">
                  <Popconfirm
                    title="清除本地数据"
                    description="会删除本机保存的个人资料与偏好，并重新加载页面。"
                    okText="清除"
                    cancelText="取消"
                    onConfirm={() => {
                      try {
                        ['linkhub-profile', 'linkhub-prefs'].forEach((k) =>
                          window.localStorage.removeItem(k),
                        );
                      } catch {
                        // 忽略
                      }
                      window.location.reload();
                    }}
                  >
                    <Button danger>清除本地数据</Button>
                  </Popconfirm>
                  <Button onClick={handleResetAll}>恢复默认设置</Button>
                </div>
              </div>
            ),
          },
        ]}
      />

      <div className="settings__footer">
        <span className="settings__hint">设置会立即生效，并保存在本机浏览器。</span>
        <Button className="settings__save" onClick={onClose}>
          完成
        </Button>
      </div>
    </Modal>
  );
}
