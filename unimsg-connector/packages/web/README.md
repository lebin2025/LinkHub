# @unimsg/web · LinkHub 统一消息中心（前端）

赛题 A 的展示层与处理层：把飞书 / 钉钉 / 企业微信的消息收敛到一个收件箱，支持筛选、AI 建议、回复回写、待办完成与全链路回放。

页面与状态层只依赖 `MessageApi` / `RealtimeClient` 两个接口，**数据源可切换**：

| 模式 | 触发条件 | 数据来自 |
| --- | --- | --- |
| Mock 演示 | 未设置 `VITE_API_BASE` | `MockApi` + 内存事件总线，无需后端即可完整演示闭环 |
| 真实后端 | 设置了 `VITE_API_BASE` | `HttpApi`（REST）+ `WsRealtime`（WebSocket），对接 `packages/server` |

> 前端只负责展示与交互，**不接触任何平台密钥**。接真实后端后，每个平台本次实际走真实接口还是本地 Mock 由服务端环境变量决定（`FEISHU_MODE` / `DINGTALK_MODE` / `WECOM_MODE` / `MAIL_MODE=auto|real|mock`，默认 `auto`）；账号页会如实显示 `mode`（真实接口 / Mock 模拟）与「模拟发送」计数，绝不把 Mock 结果伪装成真实平台已收到。

---

## 一、快速启动

在 monorepo 根目录（`unimsg-connector/`）执行：

```bash
pnpm install
pnpm --filter @unimsg/web dev          # http://127.0.0.1:5173（默认 Mock 模式）
```

接入真实后端：

```bash
# 1. 另开一个终端启动后端（默认 :3001；平台模式默认 auto，无凭据自动走 Mock）
pnpm --filter @unimsg/server start

# 2. 在 packages/web/ 下创建 .env（可参考 .env.example）
#    VITE_API_BASE=http://127.0.0.1:3001
#    VITE_API_TOKEN=dev-token

# 3. 重启前端 dev server
pnpm --filter @unimsg/web dev
```

`VITE_API_BASE` 也支持填 `/`，表示前后端同源部署（此时 WS 地址自动基于 `window.location` 推导，走 `/ws?token=`）。

### 命令

| 命令 | 说明 |
| --- | --- |
| `pnpm --filter @unimsg/web dev` | 开发服务器 |
| `pnpm --filter @unimsg/web build` | 生产构建（输出到 `dist/`） |
| `pnpm --filter @unimsg/web preview` | 预览构建产物 |
| `pnpm --filter @unimsg/web typecheck` | TypeScript 严格检查 |
| `pnpm --filter @unimsg/web test` | Vitest 全量单测 |
| `pnpm --filter @unimsg/web test:watch` | 监听模式 |

---

## 二、页面

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/inbox`、`/inbox/:traceId` | 统一收件箱 | 三栏布局：导航 + 消息列表 + 详情（AI 建议、状态流转、回复） |
| `/todos` | 待办 | `type=todo` 的消息，可直接标记完成 |
| `/trace`、`/trace/:traceId` | 全链路回放 | 按 traceId 展示接收 → AI → 处理 → 回写 → 回流的每一步 |
| `/accounts` | 平台账号 | 四类数据源（飞书 / 钉钉 / 企业微信 / 邮箱）的接入状态与实际通道：`mode` Tag（真实接口 / Mock 模拟）、`policy`、缺失变量名、警告、「模拟发送」计数；只展示变量名与脱敏地址，不接触密钥 |

---

## 三、目录

```
packages/web/
├── .env.example                 # 环境变量模板
├── scripts/test.mjs             # 跨平台测试入口（见「测试」章节）
├── scripts/verify-contract.mjs  # 前后端契约自检（见「联调自检清单」）
├── index.html
├── vite.config.ts               # Vite + Vitest + 分包
└── src/
    ├── app/            AppShell、路由、AntD 主题
    ├── features/
    │   ├── inbox/      InboxPage / MessageCard / DetailPanel / AiSuggestion / ReplyComposer / StatusFlow
    │   ├── todos/      TodosPage
    │   ├── trace/      TracePage
    │   └── accounts/   AccountsPage
    ├── components/     PlatformTag / StatusBadge / IntentTag / AvatarBadge / EmptyState / ConnectionDot
    ├── services/
    │   ├── api.ts          MessageApi 契约（含 DemoApi 扩展）
    │   ├── httpApi.ts      真实后端 REST 适配器（信封解包 / Bearer / 超时 / 错误映射）
    │   ├── wsRealtime.ts   真实 WebSocket 客户端（指数退避重连 / 状态机）
    │   ├── realtime.ts     实时推送抽象（EmitterRealtime 为 Mock 实现）
    │   └── mock/           fixtures 种子数据 + mockApi 内存实现
    ├── store/          appStore（可订阅状态）+ 单例装配（唯一切换点）
    ├── hooks/          useAppState
    ├── utils/          时间/平台/状态格式化
    ├── test/           jsdom 环境补丁
    └── styles/         app.css（设计令牌 + 全部样式，含 4 个响应式断点）
```

---

## 四、后端契约（HttpApi 已对齐）

`packages/server` 统一返回 `{ ok: true, data, ... }` 信封，`HttpApi` 全部解包后交给上层：

| 前端方法 | 请求 | 响应信封 | 前端得到 |
| --- | --- | --- | --- |
| `list(filter)` | `GET /api/messages?platform=&status=` | `{ ok, data: UnifiedMessage[] }` | 消息数组 |
| `get(id)` | `GET /api/messages/:id` | `{ ok, data }` / 404 | 单条或 `undefined` |
| `reply(id, text)` | `POST /api/messages/:id/reply` | `202 { ok, message, taskId }` | `ReplyAck` |
| `markDone(id)` | `POST /api/messages/:id/done` | `{ ok }`（无消息体） | 重取后的完整消息 |
| `trace(id)` | `GET /api/messages/trace/:traceId` | `{ ok, data, log }` | `{ data, log }` |
| `accounts()` | `GET /api/accounts` | `{ ok, data }` | `AccountInfo[]`（`policy` / `mode` / `missing` / `warnings` / `reason`；邮箱另带 `accounts[]` 明细） |
| `health()` | `GET /api/health` | `{ ok, ts, received, ... , sentMock, modes, dlq }` | `HealthInfo`（`modes` 为各平台本次实际通道） |

**筛选约定**：后端 `/api/messages` 只支持 `platform` / `status`；`type` / `keyword` / `onlyReview` 由 `HttpApi` 在本地补齐，不越权下发。

**实时事件**：后端广播 `message.received` / `message.updated` / `message.failed`，与 `RealtimeEvent` 完全一致；WS 握手为 `/ws?token=<API_TOKEN>`，鉴权失败以关闭码 `1008` 拒绝。

**错误映射**：`401 → 未授权`、`404 → 资源不存在`、`400/5xx → 后端错误信息`、网络异常/超时 → `ApiError(status=0)` 可读提示；默认请求超时 8 秒。

---

## 五、高可用设计

| 能力 | 实现位置 |
| --- | --- |
| WS 断线重连 | `WsRealtime`：指数退避 + 随机抖动（500ms→10s，最多 8 次）；`1008` 鉴权失败不重试；超限进入 `offline` |
| 断线状态补齐 | `AppStore` 监听 `reconnecting/offline → connected` 跃迁后静默重拉全量列表，兜住重连期间错过的推送 |
| 状态不乱序回退 | `AppStore.upsertReply`：HTTP 202 若晚于 WS 的 `sent/synced` 到达，只合并回复字段、保留本地较新状态 |
| 请求超时 | `HttpApi` 用 `AbortController` 兜底，避免后端僵死时 UI 永久 loading |
| 全局错误兜底 | `AppShell` 顶部 `Alert` 展示 `state.error`，可手动关闭（`dismissError`） |
| 连接态可见 | 顶栏 `ConnectionDot` 显示 实时连接 / 重连中 / 已离线；Mock 标识与演示入口由 `demoMode` 自动派生 |
| 可重入生命周期 | `dispose()` 重置订阅与 `initialized`，再次 `init()` 可重新挂载 |
| 构建分包 | `react-vendor` / `vendor` / 业务代码三层单向拆分，避免循环 chunk；antd 体积为已知权衡 |
| 响应式 | 1280 / 1080 / 900 / 640px 四个断点，900px 以下收件箱切单栏并显示返回按钮 |

---

## 六、Mock 演示

顶栏「演示」菜单（仅前端 Mock 模式显示，接真实后端后自动隐藏）：

- 模拟平台推送一条新消息（接收 → AI 富化 → 列表高亮）
- 让下一次回复失败（演示 `failed` + 死信队列提示）
- 重置筛选条件

种子数据覆盖 4 平台（飞书 / 钉钉 / 企业微信 / 邮箱）、6 种状态、4 种消息类型，以及 OCR 低置信、意图回退「未分类」、发送失败等边界分支。

> 注意区分两种「Mock」：本节说的是**前端内置数据**（不启动后端）；接真实后端后，后端每个平台的真实 / Mock 由 `*_MODE` 决定，前端账号页会通过 `mode` 字段如实显示「真实接口 / Mock 模拟」，并在回写结果上标注「模拟发送」。

---

## 七、测试

```bash
pnpm --filter @unimsg/web test     # 8 个文件 / 48 条用例
```

覆盖：`HttpApi`（信封、鉴权头、筛选、markDone 重取、错误/超时映射）、`WsRealtime`（重连状态机、事件分发、主动关闭）、`AppStore`（状态合并、重连重拉、可重入）、`MockApi`、`AccountsPage`（四平台卡、mode Tag、邮箱多账号与能力告警）、`ReplyComposer`（Ctrl+Enter、禁用态）、`MessageCard`、`format`。

> **为什么有 `scripts/test.mjs`**：Vitest 会把模块转换缓存写到系统临时目录，在受限 / CI / 沙箱环境下该目录可能不可写（EPERM），从而抛 `unhandled error` 并让进程以非 0 退出——即使用例全过。该脚本在 vitest 进程**启动前**把 `TEMP/TMP/TMPDIR` 固定到工作区内（`node_modules/.tmp`），跨平台且不依赖 pnpm 的 `.cmd` shim。

---

## 八、dev 与 prod 建议

| 维度 | 开发环境（评审演示） | 生产环境 |
| --- | --- | --- |
| 数据源 | 前端 Mock 或 `*_MODE=auto`（无凭据自动 Mock），零外部依赖 | `*_MODE=real`（或 auto + 真实凭据）+ PostgreSQL/Redis |
| 入口令牌 | `VITE_API_TOKEN=dev-token`（与后端 `API_TOKEN` 一致） | 改为用户登录后签发的短期 token / 同域 Cookie，**不要**把长期令牌打进前端 bundle |
| 部署 | 前后端分端口直连，后端 `cors()` 放行 | Nginx 同源反代 `/api` + `/ws`，`VITE_API_BASE=/`，关闭宽松 CORS |
| 密钥 | 平台 / LLM / OCR 密钥**只在服务端** `config.ts` 读取 | 同上，且走密钥管理服务；前端永远不接触 |
| 指标 | 进程内计数（`/api/health`） | 换 Prometheus / 共享存储，多实例下才准确 |
| 探活 | 依赖 TCP close 触发重连 | 后端补 ping/pong 帧，前端做应用层心跳 |

> ⚠️ **安全红线**：`VITE_` 前缀的变量会被打进前端构建产物，任何人都可从 bundle 中读到。
> 这里只允许放**业务入口令牌**（性质类似公开 API Token），
> 飞书 / 钉钉 / 企微 / LLM / OCR 的真实 `*_SECRET` / `*_KEY` **绝不能**加 `VITE_` 前缀或写进前端。

---

## 九、联调自检清单

1. 后端启动：`pnpm --filter @unimsg/server start`（默认 `:3001`）。
2. 前端 `.env` 配好 `VITE_API_BASE` 与 `VITE_API_TOKEN`，重启 dev server。
3. 顶栏连接点显示「实时连接」，左下角显示「真实后端」，「演示」菜单消失。
4. 收件箱能列出后端消息；点回复 → 状态 `replied → sent → synced` 由 WS 实时推进，无需刷新。
5. `/trace/:traceId` 能看到闭环日志；`/accounts` 显示四类数据源（飞书 / 钉钉 / 企业微信 / 邮箱）的 `policy` / `mode`（真实接口或 Mock 模拟）、缺失变量名与「模拟发送」计数。
6. 把 `VITE_API_TOKEN` 改错 → WS 立即 `offline` 且不再重连，REST 请求弹出「未授权」错误条。
7. 一键契约自检（46 项断言，覆盖信封 / 鉴权 / `done` 无消息体 / trace / WS 握手，以及 `modes` / `sentMock` / `mode`+`policy` / 邮箱账号明细 / `delivery`）：

```bash
node packages/web/scripts/verify-contract.mjs http://127.0.0.1:3001 dev-token
# 契约自检：46 PASS / 0 FAIL
```

### 常见坑

- **改了 `.env` 必须重启 dev server**：Vite 只在启动时读取环境变量。
- **端口/协议不一致**：`http://` 会自动换成 `ws://`，`https://` 换成 `wss://`；同源部署填 `/`。
- **`markDone` 不要直接用返回值**：后端 `done` 接口只回 `{ok:true}`，`HttpApi` 已做 POST + GET 重取兜底，页面无感。
- **构建产物较大**：antd 全量组件库 gzip 约 200KB，属已知权衡；如需再降可对路由做 `React.lazy` 懒加载。
