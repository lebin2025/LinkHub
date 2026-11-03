/**
 * 轻量运行指标（供 /api/health 心跳暴露）。
 * 单机进程内计数，够评审演示；生产可替换为 Prometheus。
 */
export const counters = {
  received: 0,
  deduped: 0,
  /** 回写成功总数（real + mock） */
  sent: 0,
  /** 其中走本地 Mock 的"模拟发送"数——必须单独可见，绝不与真实发送混淆 */
  sentMock: 0,
  failed: 0,
};

export function snapshot() {
  return { ...counters };
}
