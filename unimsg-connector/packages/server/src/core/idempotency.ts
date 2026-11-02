/**
 * 幂等键：平台可能重推同一事件，用 (platform, externalId) 作为天然去重键。
 * 与 DDL 的 UNIQUE(platform, external_id) 一一对应。
 */
import { Platform } from '@unimsg/shared';

export function externalKey(platform: Platform, externalId: string): string {
  return `${platform}:${externalId}`;
}
