# LinkHub · 多平台连接器与统一消息管理

> 赛题 A · 3 人团队 · 初赛后端已完成（Mock 全链路可跑通）

面向「多平台消息割裂」痛点，打造一个统一消息连接器：把飞书、钉钉、企业微信的消息与待办收拢到一个统一入口，支持直接处理与真实回写，并以状态回流与全链路日志形成可追踪的业务闭环。前端计划用 React + Ant Design 构建，后端为 Node.js + PostgreSQL/Redis，并接入大模型做意图识别与智能回复。全程由 AI 编码助手驱动开发。

## 当前进度

| 模块 | 状态 |
|---|---|
| 共享消息契约（`shared/message.ts`） | ✅ 完成 |
| 三平台适配器（飞书 / 钉钉 / 企业微信，Mock 先行） | ✅ 完成 |
| 消息中枢：状态机 / 幂等 / 异步回写 / 回流 | ✅ 完成 |
| 安全：Bearer 鉴权 + WebSocket 握手校验 | ✅ 完成 |
| 闭环日志（traceId 全链路可回放） | ✅ 完成 |
| 边界降级：限流退避、OCR 置信度、意图失败回退、DLQ | ✅ 完成 |
| 单元测试 / 端到端冒烟 | ✅ 12 条单测绿 / 15 项冒烟 PASS |
| 真实平台 API 接入 | 🚧 待平台密钥（当前 Mock） |
| PostgreSQL / Redis 实装 | 🚧 DDL 已备，默认内存仓储 |
| 前端统一入口 | 🚧 成员 B 负责 |

## 功能特性（对应业务闭环五要素）

- **接收**：三平台 Webhook 统一接入，官方 SDK 验签（Mock 环境下用 `x-signature: mock`）。
- **展示**：REST 列表 + WebSocket 实时推送，按平台/状态筛选。
- **处理**：直接回复、标记完成；AI 给出意图、摘要与回复草稿。
- **回写**：按目标平台格式转换后发送；异步执行，结果经 WS 推送。
- **回流**：平台状态事件经 Webhook 回流，`syncStatus` 更新本地并留痕。

### 状态机

```
received → processing → replied → sent → synced
                └────────── 任一环节失败 → failed（告警 + 重试 / DLQ）
```

### 关键设计

- **幂等**：以 `(platform, externalId)` 为唯一键，平台重推只更新状态、不重复入库（DDL 中有 `UNIQUE` 约束）。
- **异步回写**：`reply` 入队即返回 `202 + taskId`，真正发送在后台完成，避免接口阻塞。
- **边界降级**：限流令牌桶 + 指数退避（`SEND_MAX_RETRY`）；OCR 置信度低于 `OCR_CONFIDENCE_THRESHOLD`（默认 0.7）标记「待人工确认」；LLM 超时/失败回退「未分类」，绝不伪造意图；重试耗尽写入 DLQ。
- **密钥安全**：平台 / 大模型 / OCR 凭据只从服务端环境变量读取，绝不以 `VITE_` 注入前端，`.env` 已被 `.gitignore` 忽略。

## 技术栈

- 运行时：Node.js 20+（当前 22）、TypeScript
- 框架：Express 4、ws（WebSocket）
- 仓储：内存实现（默认）/ PostgreSQL（`001_init.sql` 已备）；Redis 用于 token 缓存与限流
- 智能：大模型（文心 / 通义，Mock 先行）、OCR（腾讯云，Mock 先行）

## 目录结构

```
LinkHub/
├── README.md
├── LICENSE
├── documents/                 # 设计文档（初赛精简版 / 决赛完整版）
├── test.photos/               # 端到端冒烟截图
└── unimsg-connector/          # 后端源码（pnpm monorepo）
    ├── packages/shared/src/message.ts      # 前后端共享契约
    ├── packages/server/src/
    │   ├── connectors/        # 飞书 / 钉钉 / 企微 适配器
    │   ├── core/              # 闭环日志 / 幂等 / 指标
    │   ├── services/          # 消息中枢 / 回流 / LLM / OCR / 限流
    │   ├── routes/            # health / webhook / messages
    │   ├── middlewares/auth.ts
    │   ├── db/                # 仓储 + migrations/001_init.sql
    │   └── app.ts / index.ts / ws.ts
    ├── scripts/               # smoke.py + e2e.ps1 / e2e.sh
    └── .env.example
```

## 快速开始

环境要求：Node.js ≥ 20、pnpm ≥ 9、Python 3（仅冒烟脚本需要）。

```bash
cd unimsg-connector
pnpm install
```

启动后端（默认 `http://127.0.0.1:3001`，Mock 模式，无需任何平台账号）：

```bash
pnpm --filter @unimsg/server start
```

另开一个终端，跑一键端到端（自动起服务 → 等待就绪 → 冒烟 → 自动关闭）：

```bash
pnpm e2e
```

> 端口冲突时可换端口：`pnpm e2e -- -Port 3102`。
> 若只想手动验证，服务启动后在另一个终端执行 `python3 scripts/smoke.py`。

## 常用命令

在 `unimsg-connector/` 目录下执行：

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 开发模式（tsx watch） |
| `pnpm start` | 启动服务（:3001） |
| `pnpm typecheck` | TypeScript 类型检查（shared + server） |
| `pnpm test` | 单元测试（12 条） |
| `pnpm e2e` | 一键端到端冒烟（Windows PowerShell） |
| `pnpm e2e:sh` | 一键端到端冒烟（macOS / Linux / Git Bash） |

## API 一览

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/health` | 公开 | 健康检查 + 运行指标（received / sent / failed / dlq） |
| POST | `/api/webhook/:platform` | 平台签名 | 接收消息或状态回流事件（`feishu` / `dingtalk` / `wecom`） |
| GET | `/api/accounts` | Bearer | 平台配置状态（只返回布尔值，不返回密钥） |
| GET | `/api/messages` | Bearer | 消息列表，支持 `?platform=&status=` |
| GET | `/api/messages/:id` | Bearer | 消息详情 |
| POST | `/api/messages/:id/reply` | Bearer | 回复（`202`，异步回写） |
| POST | `/api/messages/:id/done` | Bearer | 标记待办完成 |
| GET | `/api/messages/trace/:traceId` | Bearer | 全链路回放（消息 + 闭环日志） |
| WS | `/ws?token=<API_TOKEN>` | Token | 实时推送新消息与状态变更 |

鉴权示例：`Authorization: Bearer dev-token`（默认开发 token，生产请在 `.env` 中改 `API_TOKEN`）。

## 配置说明

复制 `unimsg-connector/.env.example` 为 `.env` 后按需填写：

| 变量 | 说明 |
|---|---|
| `MOCK` | `true`（默认）= 外部 API 全部走 Mock；拿到真实凭据后改 `false` |
| `API_TOKEN` | 入口鉴权令牌（默认 `dev-token`，生产务必修改） |
| `DATABASE_URL` / `REDIS_URL` | 留空 = 内存存储；填写后切换 PostgreSQL / Redis |
| `LLM_PROVIDER` / `LLM_API_KEY` | 大模型服务与密钥（仅服务端） |
| `OCR_PROVIDER` / `OCR_API_KEY` | OCR 服务与密钥（仅服务端） |
| `OCR_CONFIDENCE_THRESHOLD` | OCR 置信度阈值，默认 `0.7` |
| `SEND_MAX_RETRY` | 发送最大重试次数，默认 `3` |
| `FEISHU_*` / `DINGTALK_*` / `WECOM_*` | 各平台凭据（仅服务端） |

## 测试与验证

- `pnpm typecheck`：`shared` 与 `server` 双包类型检查通过。
- `pnpm test`：12 条单测全绿（连接器 5 + 主链路 4 + 边界降级 3）。
- `pnpm e2e`：15 项端到端断言全部 PASS，覆盖三平台接入、幂等去重、鉴权 401、异步回复、状态 `synced`、trace 回放与计数一致性。截图见 `test.photos/`。

## 设计文档

- `documents/赛题A_多平台连接器_初赛设计文档_精简版.docx`（初赛，≤10 页）
- `documents/赛题A_多平台连接器_竞赛执行文档_v3.docx`（决赛完整版，≤15 页）

## 后续计划

1. 接入三平台真实凭据，切换 `MOCK=false`，补齐官方验签与加解密。
2. 落地 PostgreSQL 持久化与 Redis 限流/缓存，替换内存实现。
3. 完成 React + AntD 统一入口，对接 REST / WebSocket。
4. 补充 CI（typecheck + test + e2e）与更多单测覆盖。

## License

见 [LICENSE](./LICENSE)。
