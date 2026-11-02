/**
 * 轻量运行指标（供 /api/health 心跳暴露）。
 * 单机进程内计数，够评审演示；生产可替换为 Prometheus。
 */
export const counters = {
  received: 0,
  deduped: 0,
  sent: 0,
  failed: 0,
};

export function snapshot() {
  return { ...counters };
}
