/**
 * 截止时间启发式单测（node:test）。
 * 重点是"不编造"：解析不出来必须返回 undefined，解析出来的要落在正确的那一天/那一刻。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferDueAt, inferType } from './base';

/** 固定"现在"：2026-11-06 10:00（周五），避免测试随真实时间漂移 */
const NOW = new Date(2026, 10, 6, 10, 0, 0);
const at = (y: number, m: number, d: number, hh: number, mm = 0) =>
  new Date(y, m - 1, d, hh, mm, 0).toISOString();

test('推断：明天 + 显式时刻', () => {
  assert.equal(inferDueAt('明天 18:00 前把材料发我', NOW), at(2026, 11, 7, 18, 0));
});

test('推断：今天 + 时刻（未过点）', () => {
  assert.equal(inferDueAt('今天 14:30 前完成自测', NOW), at(2026, 11, 6, 14, 30));
});

test('推断：无时刻时默认当天 18:00', () => {
  assert.equal(inferDueAt('后天把复盘发群里', NOW), at(2026, 11, 8, 18, 0));
});

test('推断：本周三已过去 → 落在过去的同一天（前端会判为逾期）', () => {
  assert.equal(inferDueAt('本周三前确认预算', NOW), at(2026, 11, 4, 18, 0));
});

test('推断：下周一顺延一周', () => {
  assert.equal(inferDueAt('下周一提交演示脚本', NOW), at(2026, 11, 9, 18, 0));
});

test('推断：裸"周四"取"下一个周四"（今天是周五）', () => {
  assert.equal(inferDueAt('周四录制演示视频', NOW), at(2026, 11, 12, 18, 0));
});

test('推断：M月D日 + 中文时刻', () => {
  assert.equal(inferDueAt('12月3日 9点前上线', NOW), at(2026, 12, 3, 9, 0));
});

test('推断：只有时刻且已过点 → 顺延到明天', () => {
  assert.equal(inferDueAt('9:30 开评审会', NOW), at(2026, 11, 7, 9, 30));
});

test('推断：没有任何时间线索 → undefined（不编造）', () => {
  assert.equal(inferDueAt('请重发一下文件', NOW), undefined);
  assert.equal(inferDueAt('这个任务要确认一下', NOW), undefined);
  assert.equal(inferDueAt('', NOW), undefined);
});

test('类型推断与截止时间互不干扰：非待办不产生截止时间', () => {
  const body = '新版 API 文档什么时候更新？';
  assert.equal(inferType(body), 'text');
  // 调用方只在 type==='todo' 时才写 dueAt；这里确认函数本身不会误判
  assert.equal(inferDueAt(body, NOW), undefined);
});
