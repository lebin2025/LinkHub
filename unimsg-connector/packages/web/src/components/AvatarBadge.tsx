import type { CSSProperties } from 'react';
import type { Platform } from '../types';
import { PLATFORM_META, initials } from '../utils/format';

export function AvatarBadge({
  name,
  platform,
  size = 36,
}: {
  name: string;
  platform: Platform;
  size?: number;
}) {
  const meta = PLATFORM_META[platform];
  return (
    <span
      className="avatar-badge"
      style={
        {
          width: size,
          height: size,
          // 底与墨走变量（明暗两套都在 --tag-* 里），字色仍是平台原色
          '--tag-soft': meta.soft,
          '--tag-soft-dark': meta.softDark,
          color: meta.color,
          borderColor: `${meta.color}33`,
          fontSize: size <= 28 ? 12 : 14,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}