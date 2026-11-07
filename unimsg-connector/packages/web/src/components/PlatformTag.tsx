import type { Platform } from '../types';
import { PLATFORM_META, toneStyle } from '../utils/format';

/**
 * 底色与墨色都走 CSS 变量（`--tag-*`），不再内联 `color/background`。
 * 内联样式无法被主题块覆盖——原来暗色只能靠 `!important` 硬压，
 * 现在明暗两套都由 `tone()` 一起算好，切换主题零特判。
 */
export function PlatformTag({ platform, small = false }: { platform: Platform; small?: boolean }) {
  const meta = PLATFORM_META[platform];
  return (
    <span className={`platform-tag${small ? ' platform-tag--small' : ''}`} style={toneStyle(meta)}>
      <span className="platform-tag__dot" style={{ background: meta.color }} />
      {meta.name}
    </span>
  );
}
