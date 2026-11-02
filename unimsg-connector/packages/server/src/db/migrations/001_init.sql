-- 赛题A 统一消息中枢 · 初始化表结构
-- 当前后端默认走内存仓储；接入 Postgres 时执行本迁移即可。

CREATE TABLE IF NOT EXISTS unified_messages (
  trace_id      TEXT PRIMARY KEY,
  platform      TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  sender_id     TEXT NOT NULL,
  sender_name   TEXT,
  type          TEXT NOT NULL,
  body          TEXT,
  intent        TEXT,
  reply_draft   TEXT,
  reply_text    TEXT,
  status        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, external_id)          -- 幂等：平台重推不重复入库
);

CREATE TABLE IF NOT EXISTS loop_logs (
  id        BIGSERIAL PRIMARY KEY,
  trace_id  TEXT NOT NULL,
  event     TEXT NOT NULL,
  status    TEXT NOT NULL,
  detail    TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loop_trace ON loop_logs(trace_id);

CREATE TABLE IF NOT EXISTS dlq (          -- 死信：重试耗尽仍失败的发送
  id        BIGSERIAL PRIMARY KEY,
  platform  TEXT,
  payload   JSONB,
  reason    TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
