/**
 * 统计看板：把「闭环有没有真的跑起来」量化成数字。
 *
 * 口径与后端 services/stats.ts 一致：
 *  - 平均处理时长 = 闭环日志里「收到/composed」到「sent」的秒差均值；
 *  - 真实 / Mock 分开展示，绝不把模拟发送算成真实送达；
 *  - 没有样本时显示「暂无样本」，不伪造 0。
 *
 * 视觉（2024 数据看板改版）：只动版式与配色，数据 / 交互 / 导出 / 趋势筛选
 * 全部沿用原实现——KPI 走 2/3/6 列响应式网格，趋势图仍是内联 SVG（零图表库），
 * 平台分布从表格改成列表卡片，颜色全部走 app.css 的 --stats-* 令牌。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Segmented, Spin, Statistic } from 'antd';
import { DownloadOutlined, FileTextOutlined, ReloadOutlined } from '@ant-design/icons';
import { platformMeta, toneStyle } from '../../utils/format';
import { saveBlobAsFile } from '../../utils/download';
import { dailyTrend, messagesToCsv, statsExportFilename, statsToMarkdown } from '../../utils/export';
import type { DailyTrendPoint } from '../../utils/export';
import type { StatsOverview } from '../../types';
import { useAppState } from '../../hooks/useAppState';
import { store } from '../../store';

/** 趋势图的画布尺寸（viewBox 内部单位，与 CSS 像素无关，svg 等比缩放） */
const TREND_W = 560;
const TREND_H = 160;
/** 轴标签区高度（MM-DD 文字） */
const TREND_AXIS_H = 20;
/** 顶部留白：柱顶不顶着画布边缘 */
const TREND_PAD_TOP = 6;

/**
 * 近 N 天趋势条形图（内联 SVG，评审 P1-7）。
 *
 * 数据形状很简单（每天入站/出站两个数），与其背上第三方图表库不如几十行画完；
 * 每天一组「入站 / 出站」柱，用原生 <title> 当 tooltip——零依赖且屏幕阅读器也能读。
 * 改版只加了圆角与语义色（入站 indigo / 出站 amber），几何计算一行未动。
 */
function TrendChart({ points, days }: { points: DailyTrendPoint[]; days: 7 | 30 }) {
  const hasTraffic = points.some((p) => p.inbound > 0 || p.outbound > 0);
  // 空数据给占位文案：让用户分清「没数据」和「图挂了」
  if (!hasTraffic) {
    return <p className="stats-trend__empty">近 {days} 天暂无消息，产生收发后这里会出现按天趋势。</p>;
  }
  const plotH = TREND_H - TREND_AXIS_H - TREND_PAD_TOP;
  const baseline = TREND_H - TREND_AXIS_H;
  // max 至少为 1：全零已经被占位文案拦住，但防御性兜底避免除以 0
  const max = Math.max(1, ...points.map((p) => Math.max(p.inbound, p.outbound)));
  const slot = TREND_W / points.length;
  const barW = Math.min(12, Math.max(3, slot * 0.26));
  // 柱顶圆角：不超过柱宽的一半，窄柱也不会被削成菱形
  const barR = Math.min(6, barW / 2);
  const hOf = (v: number) => (v / max) * plotH;
  // 轴标签密度：7 天每天标，30 天每 5 天标一个，避免文字互相叠
  const labelStep = days === 7 ? 1 : 5;
  return (
    <div>
      <div className="stats-trend__legend">
        <span><i aria-hidden="true" className="stats-trend__dot stats-trend__dot--in" />入站</span>
        <span><i aria-hidden="true" className="stats-trend__dot stats-trend__dot--out" />出站</span>
        <span className="stats-trend__peak">峰值 {max} 条 / 天</span>
      </div>
      <svg
        className="stats-trend__chart"
        viewBox={`0 0 ${TREND_W} ${TREND_H}`}
        role="img"
        aria-label={`近 ${days} 天入站 / 出站条数趋势，峰值每天 ${max} 条`}
      >
        <line x1={0} y1={baseline} x2={TREND_W} y2={baseline} className="stats-trend__baseline" />
        {points.map((p, i) => {
          const cx = i * slot + slot / 2;
          const hIn = hOf(p.inbound);
          const hOut = hOf(p.outbound);
          return (
            <g key={p.date}>
              {/* 原生 title = 零依赖 tooltip：悬停即读「哪天、入站几条、出站几条」 */}
              <title>{`${p.label}：入站 ${p.inbound} · 出站 ${p.outbound}`}</title>
              {p.inbound > 0 && (
                <rect
                  x={cx - barW - 1}
                  y={baseline - hIn}
                  width={barW}
                  height={hIn}
                  rx={barR}
                  ry={barR}
                  className="stats-trend__bar stats-trend__bar--in"
                />
              )}
              {p.outbound > 0 && (
                <rect
                  x={cx + 1}
                  y={baseline - hOut}
                  width={barW}
                  height={hOut}
                  rx={barR}
                  ry={barR}
                  className="stats-trend__bar stats-trend__bar--out"
                />
              )}
              {i % labelStep === 0 && (
                <text x={cx} y={TREND_H - 6} textAnchor="middle" className="stats-trend__axis">
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * 平均处理时长：按实际时间显示，单位随量级自动切换（秒 / 分钟 / 小时）。
 *
 * 只做显示换算：后端仍返回秒（avgHandleSeconds），导出与口径一概不参与。
 * 阈值按「人读起来最自然」取：< 60 秒用秒，< 60 分钟用分钟，再多用小时；
 * 分钟 / 小时保留一位小数，避免 0.0017 小时这种看不出量级的写法。
 */
function formatAvgHandle(seconds: number): { value: string; suffix: string } {
  const s = Math.round(seconds);
  if (s < 60) return { value: String(s), suffix: '秒' };
  // 按 0.1 分钟取整后再判档，避免 3599 秒显示成「60.0 分钟」这种别扭值
  const minutes = Math.round(seconds / 6) / 10;
  if (minutes < 60) return { value: minutes.toFixed(1), suffix: '分钟' };
  return { value: (Math.round(seconds / 360) / 10).toFixed(1), suffix: '小时' };
}

export function StatsPage() {
  const [data, setData] = useState<StatsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 趋势与导出都吃 store 里的消息列表：看板不再只依赖 stats 接口的聚合数
  const { messages } = useAppState();
  const [trendDays, setTrendDays] = useState<7 | 30>(7);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await store.loadStats());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '统计加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const trend = useMemo(() => dailyTrend(messages, trendDays), [messages, trendDays]);

  /**
   * 导出 CSV（消息级明细）。
   * \uFEFF BOM 必须在 Blob 层加：Excel 只认「文件开头带 BOM 的 UTF-8」，少了它中文全是乱码。
   */
  const exportCsv = () => {
    saveBlobAsFile(
      new Blob(['\uFEFF' + messagesToCsv(messages)], { type: 'text/csv;charset=utf-8' }),
      statsExportFilename('csv'),
    );
  };

  /** 导出 Markdown（看板汇总 + 按平台分组的要点）；聚合数还没加载出来时禁用 */
  const exportMarkdown = () => {
    if (!data) return;
    saveBlobAsFile(
      new Blob([statsToMarkdown(data)], { type: 'text/markdown;charset=utf-8' }),
      statsExportFilename('md'),
    );
  };

  const totals = data?.totals;
  const platformRows = data?.byPlatform ?? [];
  // 平均处理时长：null 保持「暂无样本」，有样本时按量级选单位（秒 / 分钟 / 小时）
  const avgHandle =
    data && data.avgHandleSeconds !== null ? formatAvgHandle(data.avgHandleSeconds) : null;

  return (
    <div className="page stats-page">
      <header className="page__head page__head--row stats-head">
        <div className="stats-head__lead">
          <h1 className="page__title">看板</h1>
          <p className="auto-reply-page__sub">
            数据来自收件箱与闭环日志本身；平均处理时长只统计「收到 → 已发出」都留痕的样本。
          </p>
        </div>
        <div className="stats-head__actions">
          <Button icon={<DownloadOutlined />} onClick={exportCsv} className="stats-action">
            导出 CSV
          </Button>
          <Button
            icon={<FileTextOutlined />}
            onClick={exportMarkdown}
            disabled={!data}
            className="stats-action"
          >
            导出 Markdown
          </Button>
          <Button
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void load()}
            className="stats-action stats-action--refresh"
          >
            刷新
          </Button>
        </div>
      </header>

      {error && <Alert type="warning" showIcon message={error} className="stats-alert" />}

      {totals && (
        <section className="stats-kpis" aria-label="核心指标">
          <article className="stats-card stats-card--total">
            <Statistic title="消息总数" value={totals.messages} />
            <p className="stats-card__hint">全部平台合计</p>
          </article>
          <article className="stats-card stats-card--replied">
            <Statistic title="已回复" value={totals.replied} />
            <p className="stats-card__hint">已有回复</p>
          </article>
          <article className="stats-card stats-card--pending">
            <Statistic title="待处理" value={totals.pending} />
            <p className="stats-card__hint">尚未处理</p>
          </article>
          <article className="stats-card stats-card--failed">
            <Statistic title="失败" value={totals.failed} />
            <p className="stats-card__hint">发送失败</p>
          </article>
          <article className="stats-card stats-card--todos">
            <Statistic title="待办 / 已完成" value={`${totals.todos} / ${totals.done}`} />
            <p className="stats-card__hint">闭环任务</p>
          </article>
          <article className="stats-card stats-card--avg">
            <Statistic
              title="平均处理时长"
              value={avgHandle ? avgHandle.value : '暂无样本'}
              {...(avgHandle ? { suffix: avgHandle.suffix } : {})}
            />
            <p className="stats-card__hint">收到 → 已发出</p>
          </article>
        </section>
      )}

      <div className="stats-main">
        <section className="stats-panel stats-panel--trend" aria-label="趋势">
          <header className="stats-panel__head">
            <div className="stats-panel__titles">
              <h2 className="stats-panel__title">趋势</h2>
              <p className="stats-panel__sub">近 {trendDays} 天入站 / 出站对比</p>
            </div>
            <Segmented
              value={trendDays}
              onChange={(v) => setTrendDays(v as 7 | 30)}
              options={[
                { label: '近 7 天', value: 7 },
                { label: '近 30 天', value: 30 },
              ]}
              className="stats-range"
            />
          </header>
          <TrendChart points={trend} days={trendDays} />
        </section>

        <section className="stats-panel stats-panel--platform" aria-label="平台分布">
          <header className="stats-panel__head">
            <div className="stats-panel__titles">
              <h2 className="stats-panel__title">平台分布</h2>
              <p className="stats-panel__sub">各渠道消息状态概览</p>
            </div>
          </header>
          <Spin spinning={loading}>
            <ul className="stats-platforms">
              {platformRows.map((row) => {
                const meta = platformMeta(row.platform);
                return (
                  <li key={row.platform} className="stats-platform">
                    <span
                      className="stats-platform__glyph"
                      style={toneStyle(meta)}
                      aria-hidden="true"
                    >
                      {meta.short}
                    </span>
                    <div className="stats-platform__main">
                      <span className="stats-platform__name">{meta.name}</span>
                      <span className="stats-platform__total">{row.total} 条消息</span>
                    </div>
                    <div className="stats-platform__counts">
                      <span className="stats-platform__replied">{row.replied} 已回复</span>
                      <span className="stats-platform__rest">
                        {row.pending} 待处理 · {row.failed} 失败
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
            {!loading && platformRows.length === 0 && (
              <p className="stats-panel__empty">暂无数据</p>
            )}
          </Spin>
        </section>
      </div>

      {data && (
        <p className="stats-foot auto-reply-page__hint">
          生成时间 {new Date(data.generatedAt).toLocaleString()}；状态分布：
          {Object.entries(data.byStatus).map(([k, v]) => ` ${k}=${v}`).join(' · ') || ' 暂无'}
        </p>
      )}
    </div>
  );
}