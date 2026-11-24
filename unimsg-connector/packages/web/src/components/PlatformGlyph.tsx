import {
  DingdingOutlined,
  MailOutlined,
  WechatOutlined,
} from '@ant-design/icons';
import { Platform } from '../types';

/**
 * 渠道图标：四个渠道各用一个固定图形，渠道标签页、侧栏与消息头像共用同一套，
 * 避免「同一渠道在不同位置长得不一样」。
 *
 * 钉钉 / 微信 / 邮箱沿用 Ant Design 的品牌图形；**飞书用纸飞机**——
 * 原来用的 RocketOutlined（火箭）与飞书这个产品没有关系，视觉上也偏吵。
 * 纸飞机按 24 网格、1.7 描边单独画，和另外三个的笔画粗细保持一致。
 */
function FeishuPlane({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-glyph="feishu"
    >
      <path d="M21 3.6 3.9 10.5c-.5.2-.5.9 0 1.1l5.6 2 2 6.1c.2.5.9.5 1.1 0L21 3.6Z" />
      <path d="M9.5 13.6 21 3.6" />
    </svg>
  );
}

const GLYPH: Record<Exclude<Platform, Platform.FEISHU>, typeof MailOutlined> = {
  [Platform.DINGTALK]: DingdingOutlined,
  [Platform.MAIL]: MailOutlined,
  [Platform.WECHAT]: WechatOutlined,
};

export function PlatformGlyph({ platform, size = 16 }: { platform: Platform; size?: number }) {
  if (platform === Platform.FEISHU) return <FeishuPlane size={size} />;
  const Icon = GLYPH[platform as Exclude<Platform, Platform.FEISHU>] ?? MailOutlined;
  return <Icon style={{ fontSize: size }} aria-hidden="true" />;
}
