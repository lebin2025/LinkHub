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
      style={{
        width: size,
        height: size,
        background: meta.soft,
        color: meta.color,
        borderColor: `${meta.color}33`,
        fontSize: size <= 28 ? 12 : 14,
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}