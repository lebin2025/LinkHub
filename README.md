# LinkHub · 多平台连接器与统一消息管理

> 赛题 A · 3 人团队 · 初赛后端已完成（Mock 全链路可跑通）

面向「多平台消息割裂」痛点，打造一个统一消息连接器：把飞书、钉钉、企业微信的消息与待办收拢到一个统一入口，支持直接处理与真实回写，并以状态回流与全链路日志形成可追踪的业务闭环。前端计划用 React + Ant Design 构建，后端为 Node.js（当前内存仓储，PostgreSQL/Redis 为规划项），并预留大模型做意图识别与智能回复（当前为规则 Mock）。全程由 AI 编码助手驱动开发。

## 当前进度

| 模块 | 状态 |
|---|---|
| 共享消息契约（`shared/message.ts`） | ✅ 完成（含回写所需的 `conversation`，邮箱另加 `mailMeta`） |
| 平台适配器（飞书 / 钉钉 / 企业微信 / 邮箱） | ✅ 飞书、钉钉、邮箱真实接入并实测；企微真实实现与 19 条单测已完成，卡在后台没有自建应用可取凭据 |
| 消息中枢：状态机 / 幂等 / 异步回写 / 回流 | ✅ 完成 |
| 安全：Bearer 鉴权 + WebSocket 握手校验 | ✅ 完成 |
| 闭环日志（traceId 全链路可回放） | ✅ 完成 |
| 边界降级：限流退避、OCR 置信度、意图失败回退、DLQ | ✅ 完成 |
| 单元测试 / 端到端冒烟 | ✅ 60 条单测 / 16 项冒烟全部通过（2026-11-03 实测） |
| 真实平台 API 接入 | ✅ 钉钉端到端跑通（Stream 收 + 机器人回写）；✅ 邮箱四跳闭环跑通（163 SMTP 发 → QQ IMAP 收 → QQ SMTP 回写 → 163 IMAP 收回信）； 飞书适配器完成但 token 被租户策略拦截（21001） |
| 大模型 / OCR 真实调用 | 🚧 未实现：当前按关键词规则 Mock |
| PostgreSQL / Redis 实装 | 🚧 仅有 DDL 与仓储接口，实际始终走内存 |
| 前端统一入口 | ✅ Mock 数据版完成：收件箱 / 待办 / 全链路回放 / 平台账号，40 条前端测试通过 |

## 功能特性（对应业务闭环五要素）

- **接收**：三平台 Webhook 统一接入，钉钉另支持 Stream 长连接（免公网）。真实模式下飞书校验事件头里的 verification token（配置 Encrypt Key 时先 AES 解密），钉钉校验 `timestamp + HMAC` 签名并 AES 解密；Mock 下签名带 `mock` 或 `dev*` 前缀即通过。
- **展示**：REST 列表 + WebSocket 实时推送，按平台/状态筛选。
- **处理**：直接回复、标记完成；规则 Mock 给出意图与回复草稿（真实大模型调用尚未接入）。
- **回写**：按目标平台格式转换后发送；异步执行，结果经 WS 推送。飞书走 `im/v1/messages`（tenant_access_token 缓存），钉钉走机器人 `groupMessages/send` / `oToMessages/batchSend`（accessToken 缓存），企业微信仍为 Mock。
- **回流**：平台状态事件经 Webhook 回流，`syncStatus` 更新本地并留痕，支持按 `traceId` 或 `externalId` 定位消息。

### 状态机

```
received → processing → replied → sent → synced
                └────────── 发送失败 → failed（指数退避重试，耗尽写 DLQ）
```

### 关键设计

- **幂等**：以 `(platform, externalId)` 为唯一键，平台重推直接返回已有记录（`duplicate=true`），不重复入库（DDL 中有 `UNIQUE` 约束）。
- **异步回写**：`reply` 先同步推进到 `replied`，随即返回 `202 + taskId`，真正发送在后台完成，避免接口阻塞。
- **边界降级**：限流令牌桶 + 指数退避只作用于发送路径（每平台容量 60、每秒补 30，重试上限 `SEND_MAX_RETRY`）；OCR 置信度低于 `OCR_CONFIDENCE_THRESHOLD`（默认 0.7）标记「待人工确认」；LLM 超时/失败回退「未分类」，绝不伪造意图；重试耗尽写入 DLQ。
- **密钥安全**：平台 / 大模型 / OCR 凭据只从服务端环境变量读取，绝不以 `VITE_` 注入前端，`.env` 已被 `.gitignore` 忽略。

## 技术栈

- 运行时：Node.js ≥ 20（本机实测 24.14.0）、TypeScript 5.6
- 框架：Express 4、ws（WebSocket）
- 前端：React 18 + Vite 5 + TypeScript + Ant Design 5（Mock / 真实后端双模式，由 `VITE_API_BASE` 切换）
- 真实接入：飞书 / 钉钉适配器使用 Node 内置 `fetch` + 进程内 token 缓存；钉钉收消息使用官方 `dingtalk-stream`（唯一的额外依赖）
- 仓储：内存实现（当前唯一实现）；PostgreSQL 仅有 `001_init.sql` 与仓储接口，尚无 PgRepository；Redis 未接入
- 智能：LLM / OCR 均为规则 Mock；文心 / 通义 / 腾讯云 OCR 只保留配置项，真实调用未实现

## 目录结构

```
LinkHub/
├── README.md
├── LICENSE
├── documents/                 # 设计文档（初赛精简版 / 决赛完整版）
├── test.photos/               # 端到端冒烟截图
└── unimsg-connector/          # 后端源码（pnpm monorepo）
    ├── packages/shared/src/message.ts      # 前后端共享契约
    ├── packages/web/                       # 前端（React + AntD · Mock 数据版）
    ├── packages/server/src/
    │   ├── connectors/        # 飞书 / 钉钉 / 企微 适配器（crypto / real 为真实接入工具）
    │   ├── core/              # 闭环日志 / 幂等 / 指标
    │   ├── services/          # 消息中枢 / 回流 / LLM / OCR / 限流
    │   ├── routes/            # health / webhook / messages
    │   ├── middlewares/auth.ts
    │   ├── db/                # 仓储 + migrations/001_init.sql
    │   ├── config.ts          # 服务端私有配置
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

未全局安装 pnpm 时，可用 Node 自带的 corepack：`corepack pnpm install`（本仓库实测即用此方式，pnpm 9.15.9）。

### 本地演示（无需域名 / 无需平台账号）

两种跑法任选：

- **纯前端 Mock**：只起前端，内置数据，可完整走通「收件箱 → 回复 → 回放」。

  ```bash
  pnpm --filter @unimsg/web dev      # http://127.0.0.1:5173
  ```

- **前后端联调（推荐）**：先起后端，再给前端配两行环境变量，页面左侧会显示「真实后端 · 已接入 LinkHub Server」。

  ```bash
  pnpm --filter @unimsg/server start
  printf 'VITE_API_BASE=http://127.0.0.1:3001\nVITE_API_TOKEN=dev-token\n' > packages/web/.env
  pnpm --filter @unimsg/web dev
  ```

  想灌几条演示消息，可在另一个终端用 `scripts/smoke.py`（先启动后端），或直接调 `POST /api/webhook/feishu|dingtalk`。

启动后端（默认 `http://127.0.0.1:3001`，Mock 模式，无需任何平台账号）：

```bash
pnpm --filter @unimsg/server start
```

启动前端（默认 `http://127.0.0.1:5173`，不建 `packages/web/.env` 时为纯 Mock 数据）：

```bash
pnpm --filter @unimsg/web dev
```

另开一个终端，跑一键端到端（自动起服务 → 等待就绪 → 冒烟 → 自动关闭）：

```bash
pnpm e2e
```

> 端口冲突时改端口用 `pnpm e2e -Port 3102`。不要写成 `pnpm e2e -- -Port 3102`：pnpm 9 会把 `--` 原样传给脚本，PowerShell 解析参数失败。
> 想手动验证，服务启动后另开终端执行 `python scripts/smoke.py http://127.0.0.1:3001`。
> `scripts/e2e.sh` 会自动探测 `python` / `python3`；都找不到时提示安装 Python 3。

## 常用命令

在 `unimsg-connector/` 目录下执行：

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 开发模式（tsx watch） |
| `pnpm start` | 启动服务（:3001） |
| `pnpm typecheck` | TypeScript 类型检查（shared + server） |
| `pnpm test` | 单元测试（22 条） |
| `pnpm e2e` | 一键端到端冒烟（Windows PowerShell） |
| `pnpm e2e:sh` | 一键端到端冒烟（macOS / Linux / Git Bash） |
| `pnpm --filter @unimsg/web dev` | 前端开发模式（:5173，Mock 数据） |
| `pnpm --filter @unimsg/web test` | 前端单元测试（40 条） |

`e2e` / `e2e:sh` 都可直接追加端口参数，例如 `pnpm e2e -Port 3102`、`pnpm e2e:sh 3102`。

要连真实钉钉收发（Stream 模式，无需公网）：

```bash
MOCK=false DINGTALK_STREAM=true pnpm --filter @unimsg/server start
```

## API 一览

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/health` | 公开 | 健康检查 + 运行指标（received / deduped / sent / failed / dlq） |
| POST | `/api/webhook/:platform` | 平台签名 | 接收消息或状态回流事件（`feishu` / `dingtalk` / `wecom`） |
| GET | `/api/accounts` | Bearer | 平台配置状态（只返回布尔值，不返回密钥） |
| GET | `/api/messages` | Bearer | 消息列表，支持 `?platform=&status=` |
| GET | `/api/messages/:id` | Bearer | 消息详情（`:id` 传 `traceId`） |
| POST | `/api/messages/:id/reply` | Bearer | 回复（`202`，异步回写） |
| POST | `/api/messages/:id/done` | Bearer | 标记待办完成（置 `done`，不改状态机状态） |
| GET | `/api/messages/trace/:traceId` | Bearer | 全链路回放（消息 + 闭环日志；未知 traceId 返回空数组） |
| WS | `/ws?token=<API_TOKEN>` | Token | 推送 `connected` / `message.received` / `message.updated` / `message.failed`；token 错误直接 `1008` 关闭 |

鉴权示例：`Authorization: Bearer dev-token`，业务接口也接受 `?token=dev-token`（默认开发 token，生产请在 `.env` 中改 `API_TOKEN`）。

## 配置说明

复制 `unimsg-connector/.env.example` 为 `unimsg-connector/.env`（服务会自动从 monorepo 根目录加载）后按需填写：

| 变量 | 说明 |
|---|---|
| `MOCK` | `true`（默认）= 全部 Mock；`false` = 飞书 / 钉钉 / 企微 / 邮箱走真实接口 |
| `API_TOKEN` | 入口鉴权令牌（默认 `dev-token`，生产务必修改） |
| `DATABASE_URL` / `REDIS_URL` | 预留项：不影响存储实现；填 `DATABASE_URL` 只会让启动日志显示 `postgres(未启用·当前内存)` |
| `LLM_PROVIDER` / `LLM_API_KEY` | 预留：真实调用未实现，始终走 Mock |
| `OCR_PROVIDER` / `OCR_API_KEY` | 预留：真实调用未实现，始终走 Mock |
| `OCR_CONFIDENCE_THRESHOLD` | OCR 置信度阈值，默认 `0.7` |
| `SEND_MAX_RETRY` | 发送最大重试次数，默认 `3` |
| `RETRY_BASE_MS` / `LLM_TIMEOUT_MS` | 重试退避基数（默认 1000ms）/ 真实 API 与 LLM 超时（默认 8000ms） |
| `SERVER_PORT` | 服务端口，默认 `3001` |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 飞书自建应用凭证 |
| `FEISHU_VERIFY_TOKEN` / `FEISHU_ENCRYPT_KEY` | 事件订阅的 verification token / encrypt key（加密策略页） |
| `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET` | 钉钉应用凭证（旧版字段 `DINGTALK_APP_KEY` / `_APP_SECRET` 仍兼容） |
| `DINGTALK_ROBOT_CODE` | 机器人编码，企业内部应用通常等于 Client ID |
| `DINGTALK_AES_TOKEN` / `DINGTALK_AES_KEY` | 钉钉 HTTP 回调的 Token / 加密密钥 |
| `WECOM_CORP_ID` / `WECOM_AGENT_ID` / `WECOM_SECRET` | 企微自建应用凭据（企业ID + AgentId + 应用 Secret，换 access_token 与真实发送用） |
| `WECOM_TOKEN` / `WECOM_AES_KEY` | 企微回调的 Token / EncodingAESKey（SHA1 验签与 AES 解密） |
| `MAIL_ENABLED` | `true` 时启动邮箱轮询器（默认 `false`） |
| `MAIL_POLL_SECONDS` | 轮询间隔秒数，默认 `45` |
| `MAIL_QQ_ADDRESS` / `MAIL_QQ_AUTH_CODE` | QQ 邮箱地址 + **授权码**（不是网页登录密码） |
| `MAIL_163_ADDRESS` / `MAIL_163_AUTH_CODE` | 163 邮箱地址 + 授权密码 |
| `MAIL_<KEY>_IMAP_HOST` / `_SMTP_HOST` | 默认 `imap.qq.com`/`smtp.qq.com`、`imap.163.com`/`smtp.163.com`，一般不用改 |
| `MAIL_<KEY>_FOLDERS` | 监听目录，默认 `INBOX`；反垃圾把信扔进垃圾箱时可写 `INBOX,Junk` |

## 真实接入配置

钉钉推荐用 **Stream 长连接**，本机就能收发消息，不需要公网地址：

1. 开发者后台 → 应用能力 → 机器人：填名称/简介/描述/消息预览图，消息接收模式选「Stream 模式」→ 发布。
2. `.env` 里配 `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET` / `DINGTALK_ROBOT_CODE`，并设 `DINGTALK_STREAM=true`、`MOCK=false`。
3. 启动后端，日志出现 `[stream] 钉钉 Stream 已连接` 后，直接在钉钉里给机器人发消息即可入库；调 `POST /api/messages/:traceId/reply` 会真的发回钉钉。
4. 版本管理与发布里要发布版本，机器人配置才对外生效（可用范围可先设「仅我可见」）。

有公网域名时也可以走 HTTP 回调：

- 钉钉：事件订阅 → 推送方式选「HTTP 推送」，地址填 `https://<域名>/api/webhook/dingtalk`；把 Token / AES Key 填进 `DINGTALK_AES_TOKEN` / `DINGTALK_AES_KEY`，后端会校验 `timestamp + sign` 并解密 `encrypt`。
- 飞书：事件与回调 → 订阅方式选「将事件发送至开发者服务器」，地址填 `https://<域名>/api/webhook/feishu`，添加事件 `im.message.receive_v1`；Encrypt Key 与 Verification Token 填进 `.env`，服务会对 `url_verification` 自动回传 challenge。

企业微信（代码与单测就绪，缺自建应用）：

1. 后台「应用管理 → 自建」创建应用，可见范围选自己 → 详情页取 `AgentId`、点「眼睛」复制 `Secret`（**不要点重置**）。
2. 该应用「接收消息 → 设置 API 接收」：URL 填 `https://<公网域名>/api/webhook/wecom`，随机生成 Token / EncodingAESKey，同时写入 `.env` 的 `WECOM_TOKEN` / `WECOM_AES_KEY`。GET 握手会解密 `echostr` 回明文，服务已支持。
3. `.env` 补 `WECOM_CORP_ID`（我的企业 → 企业ID）/ `WECOM_AGENT_ID` / `WECOM_SECRET` 并置 `MOCK=false`；回写走 `message/send`，回调报文是 XML 且带 AES 密文，服务按 SHA1 验签后解密。

邮箱（QQ / 163）是第 4 类数据源，**不需要公网地址**，本机就能收也能发：

1. 网页端开启 IMAP/SMTP 服务并生成授权码（授权码不是网页登录密码）：
   - QQ：设置 → 账号与安全 → 安全设置 → `POP3/IMAP/SMTP… 服务` → 开启服务（要先过 QQ 密保：用手机发短信 `1` 到 `1069 0700 511`）→ 生成授权码。
   - 163：设置 → POP3/SMTP/IMAP → 开启服务（短信验证；实测长网关号会报「短信验证错误」，改发短号 `1069 0163 222` 才通过）→ 新增授权密码，**只显示一次**，当场抄下来。
2. `.env` 填 `MAIL_QQ_ADDRESS` / `MAIL_QQ_AUTH_CODE`（或 `MAIL_163_*`），设 `MAIL_ENABLED=true`、`MOCK=false`。
3. 启动后端，日志出现 `[mail] xxx 已连接，基线 UID=n`。首轮只立 UID 水位基线，**不把历史邮件灌进中枢**；之后每轮导入 UID 更大的新信。
4. 回写走 SMTP（465 隐式 TLS + AUTH LOGIN），发回原发件人，主题自动加 `Re:` 并带 `In-Reply-To`；发信地址必须等于登录账号，否则被判冒用。
5. 邮箱没有平台回调，所以真实模式下 `/api/webhook/mail` 一律验签失败——邮件事件只能由本机轮询 ingest，这是防伪造的有意设计。

> 两个协议坑位已写进实现：IMAP 登录后必须发 `ID` 命令（RFC 2971），否则网易/QQ 会按 `Unsafe Login` 拒绝；取正文用 `BODY.PEEK[]`，不改用户邮箱的已读状态。

> 反向代理场景下把 `https://<域名>/api` 整体转到 `127.0.0.1:3001` 即可，路由本身不依赖前缀。

## 测试与验证

实测环境：Windows 11、Git Bash、Node 24.14.0、pnpm 9.15.9（corepack）、Python 3.12.10。

- `pnpm typecheck`：`shared`、`server`、`web` 三包检查通过。
- `pnpm test`：60 条单测全绿（连接器 5 + 主链路 4 + 边界降级 3 + 真实适配器 10 + 邮箱 16 + IMAP 读取器 3 + 企微 19），耗时约 0.5s。
- `pnpm --filter @unimsg/web test`：40 条前端用例全绿（7 个测试文件）。
- `pnpm e2e`（PowerShell，默认 3001）：15 项断言全部 PASS，`SMOKE OK`。
- `pnpm e2e:sh`（Git Bash，3121 端口）：15 项断言全部 PASS，`SMOKE OK`。
- `pnpm dev` / `pnpm start`：均能正常监听并通过 `/api/health`。

本地全栈联调（2026-11-03，MOCK=true）：

- 后端 3001 + 前端 5173（`packages/web/.env` 配 `VITE_API_BASE`），页面显示「真实后端 · 已接入 LinkHub Server」。
- Webhook 灌入 4 条消息 → 收件箱计数 4、待办 2；中文与 `conversation` 字段显示正常。
- 页面内回复 → 后端状态走完 `received → processing → replied → sent → synced`，`/api/health` 中 `sent=1`，前端经 WebSocket 实时更新，无需刷新。

真实凭据联调（2026-11-03）：

- 钉钉端到端已跑通（Stream 模式，本机无公网）：手机钉钉给机器人发 3 条消息 → 全部实时入库并带出 `conversation`；调 `reply` 接口 → 状态走完 `replied → sent → synced`，`/api/health` 的 `sent` 递增，机器人消息真的回到钉钉会话。
- 钉钉 `POST /v1.0/oauth2/accessToken` 用真实 Client ID/Secret 换取 accessToken 成功；未认证企业也可用。
- 飞书：`POST /auth/v3/tenant_access_token/internal` 返回 `21001 Access denied due to platform policy`。已排除密钥错误（错误密钥返回 `10014`）、IP 白名单（未开启）、应用未发布（已发布 1.0.0 且状态「已启用」）、测试企业通道（建了测试企业并关联应用，仍 `21001`）——属租户级平台策略，需要企业认证或符合策略的租户。

- 邮箱四跳闭环已机器验证（本机无公网，2026-11-03 13:58–14:00 实测）：
  1. 自研 SMTP 客户端从 `smtp.163.com:465` 发信到 QQ → 回执 `250 Mail OK queued as gzga-smtp-mtada-g1-1…`；
  2. 30s 轮询从 `imap.qq.com:993` 把它收进中枢 → `externalId=qq:INBOX:18`、`status=received`；
  3. 调 `POST /api/messages/:traceId/reply` → 走 **QQ 的 SMTP** 回写 → 状态 `sent → synced`，`/api/health` 的 `sent=1`；
  4. 回信落到 163 收件箱后被轮询收回 → `externalId=163:INBOX:1771448864`、`from=3605405275@qq.com`，`mailMeta.inReplyTo` 是 QQ 真实返回的 `tencent_…@qq.com`。
  全程中文主题与正文无损（`Re: 闭环测试B` / `第三跳：这是中枢经 QQ SMTP 回写的中文…`），两个发信账号（163、QQ）与两个收信账号都各跑通一次。
- 反垃圾行为不可预测：同一发件人（163→QQ）第一封被判进 `Junk`、第二封直接进 `INBOX`，所以监听目录做成可配置项 `MAIL_<KEY>_FOLDERS`（默认 `INBOX`），并把目录写进 `externalId`（`<账号>:<目录>:<UID>`）避免跨目录 UID 撞车。
- 侧证：网易因我们的 IMAP 登录给账号发了「新设备登录提醒」邮件。

15 项冒烟覆盖：健康检查、三平台接入、幂等去重、鉴权 401、异步回复、`synced` 状态、trace 五个事件、计数一致性。截图见 `test.photos/`。

前端（`packages/web`）支持双模式：不配置 `VITE_API_BASE` 时走 `MockApi`（纯前端演示），配置后走 `HttpApi + WsRealtime` 对接本仓库后端；已通过 `tsc --noEmit`、`vite build` 与 40 条 Vitest 用例。

冒烟之外的补充手工验证：

- `/api/accounts`：无 token / 错 token 返回 401，Bearer 与 `?token=` 均 200，只返回 `configured` 布尔值。
- 验签：`x-signature` 篡改为非法值时 401；未知平台 404。
- 筛选：`?platform=` 结果条数与全量统计一致（feishu 33/33、dingtalk 2/2）。
- WebSocket：正确 token 收到 `connected` 与 `message.received`；回复链路依次收到 4 帧 `message.updated`（processing / replied / sent / synced）；错 token、无 token 均 `1008 unauthorized`。
- 异步回写：`reply` 返回 202 + `taskId`，后台完成后状态为 `synced`。
- 回流：状态事件经 Webhook 按 `traceId` / `externalId` 均能把状态改为目标值并写入 `sync` 日志。
- 边界：空文本回复 400；不存在的消息 404；30 条突发 Webhook 全部 200（令牌桶只在发送路径生效，符合设计）。
- 加解密 / 发送形状：用本地构造的真实算法密文验证飞书与钉钉解密与签名；打桩 `fetch` 断言 token 请求与发送请求的 URL、字段、鉴权头。

## 已知限制

- 飞书真实收发被租户策略 `21001` 拦死，代码与配置都已就绪，但要企业认证或换合规租户才能验证。
- 企业微信：真实适配器与 19 条单测已完成（SHA1 验签、AES 加解密、XML 解析、GET 握手、`gettoken`→`message/send`），但后台「应用管理 → 自建」是空的，没有应用就没有 AgentId / Secret / Token / EncodingAESKey，因此真实发送尚未实测。
- 钉钉真实收发依赖 Stream 长连接（本机可用）或公网回调；`DINGTALK_STREAM` 默认关闭，需要显式开启。
- 邮箱没有平台回调：真实模式下 `/api/webhook/mail` 一律验签失败，新信只能由本机轮询 ingest，默认 45s 一轮，不是实时。
- 邮箱的 SMTP 客户端只支持 465 隐式 TLS（未实现 587 STARTTLS）；IMAP 水位存在内存里，进程重启会重新立基线，重启间隙到达的邮件会被跳过。
- 飞书权限里 `im:message`（获取与发送单聊、群组消息）尚未开通，只有 `im:message:send_as_bot`。
- 前端默认跑内存 Mock 数据；配 `VITE_API_BASE` / `VITE_API_TOKEN` 后即接本仓库后端（已实测列表、回复与 WS 推送）。
- 真实大模型/OCR、PostgreSQL/Redis 尚未实现。
- Webhook 缺少 body 校验：空 payload 会被接收，`externalId` 退化为 `unknown`，之后的空 payload 全部按重复处理。
- Mock 下不带签名头时按 `mock` 放行，仅适合本地演示；`dev*` 前缀签名同样放行。
- 所有消息、闭环日志、DLQ 都在内存里，进程重启即清空。
- 仓库里误提交了一个空的 `scripts/e2e-server.log.err`，可删除并把 `*.log.err` 加进 `.gitignore`。

## 设计文档

- `documents/赛题A_多平台连接器_初赛设计文档_精简版.docx`（初赛，≤10 页）
- `documents/赛题A_多平台连接器_竞赛执行文档_v3.docx`（决赛完整版，≤15 页）

## 后续计划

1. 解决飞书租户 `21001`（企业认证或换符合策略的租户），再配事件订阅与 `im:message` 权限，跑通飞书真实收发。
2. 企业微信补齐真实验签与发送（目前仍是 Mock）。
3. 有公网域名时补上钉钉 HTTP 回调通道，与 Stream 并存。
4. 实现 `PgRepository` 与 Redis（限流 / token 缓存），替换内存实现。
5. 接入真实大模型（文心 / 通义）与腾讯云 OCR，补齐超时与失败回退。
6. 完成 React + AntD 统一入口与后端的联调收尾（数据源已可切换）。
7. `server` 增加入参 schema 校验；清理 `scripts/e2e-server.log.err`；补 CI（typecheck + test + e2e）。

## License

见 [LICENSE](./LICENSE)。
