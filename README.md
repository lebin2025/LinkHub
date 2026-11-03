# LinkHub · 多平台连接器与统一消息管理

> 赛题 A · 3 人团队 · 初赛后端已完成（Mock 全链路可跑通）

面向「多平台消息割裂」痛点，打造一个统一消息连接器：把飞书、钉钉、企业微信的消息与待办收拢到一个统一入口，支持直接处理与真实回写，并以状态回流与全链路日志形成可追踪的业务闭环。前端计划用 React + Ant Design 构建，后端为 Node.js（当前内存仓储，PostgreSQL/Redis 为规划项），并预留大模型做意图识别与智能回复（当前为规则 Mock）。全程由 AI 编码助手驱动开发。

## 当前进度

| 模块 | 状态 |
|---|---|
| 共享消息契约（`shared/message.ts`） | ✅ 完成（含回写所需的 `conversation`） |
| 三平台适配器（飞书 / 钉钉 / 企业微信） | ✅ 飞书、钉钉真实接入已实现；企微仍为 Mock |
| 消息中枢：状态机 / 幂等 / 异步回写 / 回流 | ✅ 完成 |
| 安全：Bearer 鉴权 + WebSocket 握手校验 | ✅ 完成 |
| 闭环日志（traceId 全链路可回放） | ✅ 完成 |
| 边界降级：限流退避、OCR 置信度、意图失败回退、DLQ | ✅ 完成 |
| 单元测试 / 端到端冒烟 | ✅ 22 条单测 / 15 项冒烟全部通过（2026-11-03 实测） |
| 真实平台 API 接入 | 🟡 飞书 / 钉钉适配器完成；飞书 token 被租户策略拦截（21001），钉钉 token 实测可用 |
| 大模型 / OCR 真实调用 | 🚧 未实现：当前按关键词规则 Mock |
| PostgreSQL / Redis 实装 | 🚧 仅有 DDL 与仓储接口，实际始终走内存 |
| 前端统一入口 | ✅ Mock 数据版完成：收件箱 / 待办 / 全链路回放 / 平台账号，40 条前端测试通过 |

## 功能特性（对应业务闭环五要素）

- **接收**：三平台 Webhook 统一接入。真实模式下飞书校验事件头里的 verification token（配置 Encrypt Key 时先 AES 解密），钉钉校验 `timestamp + HMAC` 签名并 AES 解密；Mock 下签名带 `mock` 或 `dev*` 前缀即通过。
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
- 前端：React 18 + Vite 5 + TypeScript + Ant Design 5（当前 Mock 数据，接口形状已与后端契约对齐）
- 真实接入：飞书 / 钉钉适配器使用 Node 内置 `fetch` + 进程内 token 缓存，无第三方 SDK
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

启动后端（默认 `http://127.0.0.1:3001`，Mock 模式，无需任何平台账号）：

```bash
pnpm --filter @unimsg/server start
```

启动前端（默认 `http://127.0.0.1:5173`，内置 Mock 数据，不依赖后端）：

```bash
pnpm --filter @unimsg/web dev
```

另开一个终端，跑一键端到端（自动起服务 → 等待就绪 → 冒烟 → 自动关闭）：

```bash
pnpm e2e
```

> 端口冲突时改端口用 `pnpm e2e -Port 3102`。不要写成 `pnpm e2e -- -Port 3102`：pnpm 9 会把 `--` 原样传给脚本，PowerShell 解析参数失败。
> 想手动验证，服务启动后另开终端执行 `python scripts/smoke.py http://127.0.0.1:3001`。
> Windows 上若 `python3` 指向微软商店占位符，`scripts/e2e.sh` 会以退出码 49 失败：改用 `pnpm e2e`（PowerShell 版自动探测 `python`），或让 `python3` 指向真实解释器。

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
| `MOCK` | `true`（默认）= 全部 Mock；`false` = 飞书 / 钉钉走真实接口（企微仍 Mock） |
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
| `WECOM_*` | 企微凭据（真实接入未实现） |

## 真实接入配置（回调）

平台要把事件推到后端，需要公网可达的 HTTPS 地址：

1. 飞书：事件与回调 → 事件配置 → 订阅方式选「将事件发送至开发者服务器」，请求地址填 `https://<域名>/api/webhook/feishu`；添加事件 `im.message.receive_v1`。加密策略页把 Encrypt Key 与 Verification Token 填进 `.env`。服务会对 `url_verification` 自动回传 challenge。
2. 钉钉：事件订阅 → 推送方式选「HTTP 推送」，地址填 `https://<域名>/api/webhook/dingtalk`；把页面上的 Token / AES Key 填进 `DINGTALK_AES_TOKEN` / `DINGTALK_AES_KEY`。后端会校验 `timestamp + sign` 并解密 `encrypt`。
3. 两边都要在版本管理与发布里发布版本，权限与事件才会生效；飞书可在「测试企业和人员」里先加测试成员。
4. 没有公网域名时，钉钉也可以改用 Stream 模式（控制台已标注推荐，无需回调地址），但需要额外接入 `dingtalk-stream` SDK，本项目当前走 HTTP。

> 反向代理场景下把 `https://<域名>/api` 整体转到 `127.0.0.1:3001` 即可，路由本身不依赖前缀。

## 测试与验证

实测环境：Windows 11、Git Bash、Node 24.14.0、pnpm 9.15.9（corepack）、Python 3.12.10。

- `pnpm typecheck`：`shared` 与 `server` 双包检查通过。
- `pnpm test`：22 条单测全绿（连接器 5 + 主链路 4 + 边界降级 3 + 真实适配器 10），耗时约 0.3s。
- `pnpm e2e`（PowerShell，默认 3001）：15 项断言全部 PASS，`SMOKE OK`。
- `pnpm e2e:sh`（Git Bash，3121 端口）：15 项断言全部 PASS，`SMOKE OK`。
- `pnpm dev` / `pnpm start`：均能正常监听并通过 `/api/health`。

真实凭据联调（2026-11-03）：

- 钉钉：`POST /v1.0/oauth2/accessToken` 用真实 Client ID/Secret 换取 accessToken 成功。
- 飞书：`POST /auth/v3/tenant_access_token/internal` 返回 `21001 Access denied due to platform policy`（应用已发布、已启用，属租户级策略限制；需要企业认证/符合条件的租户才能换取 token）。
- 真实发送依赖入站消息带来的 `conversation.id`，需先配好回调并收到一条消息；当前无公网域名，未做端到端真实收发。

15 项冒烟覆盖：健康检查、三平台接入、幂等去重、鉴权 401、异步回复、`synced` 状态、trace 五个事件、计数一致性。截图见 `test.photos/`。

前端（`packages/web`）当前为 Mock 数据版，已通过 `tsc --noEmit`、`vite build` 与 40 条 Vitest 用例；覆盖列表/筛选、回复状态机、标记完成、全链路日志、实时事件与卡片交互。接口形状对齐 `API对接说明.md`，接后端时只需替换 `src/store/index.ts` 的数据源装配。

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

- 飞书 `tenant_access_token` 被租户策略拦截（21001），真实收发暂不可用；钉钉 token 可用，但真实收发仍需公网回调与入站消息。
- 飞书事件订阅 / 钉钉 HTTP 回调都还没配（缺公网域名）；钉钉亦可改 Stream 模式。
- 飞书权限里 `im:message`（获取与发送单聊、群组消息）尚未开通，只有 `im:message:send_as_bot`。
- 前端当前使用内存 Mock 数据，尚未接入后端 REST/WS；接入方案见 `packages/web/README.md`。
- 真实大模型/OCR、PostgreSQL/Redis 尚未实现。
- `scripts/e2e.sh` 写死 `python3`，Windows 上可能撞到微软商店占位符（退出码 49）。
- Webhook 缺少 body 校验：空 payload 会被接收，`externalId` 退化为 `unknown`，之后的空 payload 全部按重复处理。
- Mock 下不带签名头时按 `mock` 放行，仅适合本地演示；`dev*` 前缀签名同样放行。
- 所有消息、闭环日志、DLQ 都在内存里，进程重启即清空。
- 仓库里误提交了一个空的 `scripts/e2e-server.log.err`，可删除并把 `*.log.err` 加进 `.gitignore`。

## 设计文档

- `documents/赛题A_多平台连接器_初赛设计文档_精简版.docx`（初赛，≤10 页）
- `documents/赛题A_多平台连接器_竞赛执行文档_v3.docx`（决赛完整版，≤15 页）

## 后续计划

1. 有公网域名后配置两边回调（飞书事件订阅 / 钉钉 HTTP 推送），补齐飞书 `im:message` 权限，跑通真实入站与回写。
2. 解决飞书租户 21001（企业认证或换用符合策略的租户）。
3. 实现 `PgRepository` 与 Redis（限流 / token 缓存），替换内存实现。
4. 接入真实大模型（文心 / 通义）与腾讯云 OCR，补齐超时与失败回退。
5. 完成 React + AntD 统一入口，对接 REST / WebSocket。
6. `server` 增加入参 schema 校验；`e2e.sh` 自动探测 `python` / `python3`；清理 `scripts/e2e-server.log.err`；补 CI（typecheck + test + e2e）。

## License

见 [LICENSE](./LICENSE)。
