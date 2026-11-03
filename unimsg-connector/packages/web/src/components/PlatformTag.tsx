import type { Platform } from '../types';
import { PLATFORM_META } from '../utils/format';

export function PlatformTag({ platform, small = false }: { platform: Platform; small?: boolean }) {
  const meta = PLATFORM_META[platform];
  return (
    <span
      className={`platform-tag${small ? ' platform-tag--small' : ''}`}
      style={{ color: meta.color, background: meta.soft }}
    >
      <span className="platform-tag__dot" style={{ background: meta.color }} />
      {meta.name}
    </span>
  );
}