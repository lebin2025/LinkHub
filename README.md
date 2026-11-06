# LinkHub · 多平台连接器与统一消息管理

> 赛题 A · 3 人团队 · 四类数据源（飞书 / 钉钉 / 企业微信 / 邮箱）统一接入

**可替换性是本项目的核心卖点：换账号 = 改 `unimsg-connector/.env`，零代码改动。**

LinkHub 把飞书、钉钉、企业微信、邮箱的消息与待办收拢到一个统一入口，支持直接处理、真实回写、状态回流与全链路日志回放。每个平台独立用 `*_MODE=auto|real|mock` 决定走真实接口还是本地模拟，默认 `auto`（凭据够就走真实接口、不够自动回退 Mock）；邮箱支持**任意数量、任意服务商**。一条 `pnpm run doctor` 完成凭据 / 网络 / 出口 IP 自检并给出中文修复建议；**Mock 结果一律标注「模拟发送」，绝不假成功**。

- 换账号零代码：飞书 / 钉钉 / 企业微信 / 邮箱各自一段 `.env`，互不影响。
- 混搭可用：只配钉钉、只配邮箱、或四个平台全真实，都能正常启动；没配的平台自动 Mock。
- 零账号可演示：不填任何凭据也能跑通「接收 → 处理 → 回写 → 同步 → 回放」，且每一步都标明是模拟。
- 自检不猜谜：`pnpm run doctor` 给出 Node / `.env` / 平台模式 / 逐平台探针 / 出口公网 IP 与修复建议。

> 换账号的完整分步 checklist（后台点什么、填哪些变量、常见报错）见 [docs/swap-accounts.md](docs/swap-accounts.md)。

## 从这里开始（30 秒选路径）

| 你想做什么 | 直接怎么做 | 预计耗时 | 详细步骤 |
|---|---|---|---|
| **我只想看效果**（零账号、零平台配置） | `cd unimsg-connector` → `corepack pnpm install` → `pnpm e2e` → 起后端+前端 | 约 5 分钟 | [docs/quickstart.md](docs/quickstart.md) |
| **我要换成自己的账号**（飞书 / 钉钉 / 企微 / 邮箱任选） | 复制 `.env.example` 为 `.env`，只填目标平台 → `pnpm run doctor` → 启动 | 约 10 分钟 | 下文「换一个账号，只要 3 步」+ [docs/swap-accounts.md](docs/swap-accounts.md) |
| **我要现场演示 / 录视频** | 按分镜脚本走，含演示前 10 分钟检查清单与纯 Mock 兜底 | 5–8 分钟 | [docs/demo-script.md](docs/demo-script.md) |
| **我要交付/打包给评审** | `pnpm run deliver`（git archive，自动排除 `.env`/日志/node_modules）+ 打包后自检 | 约 5 分钟 | [docs/delivery-checklist.md](docs/delivery-checklist.md) |

> 新手常见卡点（pnpm 未装、端口占用、`.env` 拼错、401、代理超时等）有一张「现象 → 原因 → 一句话解决」表，见 [docs/quickstart.md](docs/quickstart.md#常见卡点一张表)。
> 完整风险清单（按严重度排序、含修复状态）见 [docs/risk-register.md](docs/risk-register.md)。

## 换一个账号，只要 3 步

```bash
cd unimsg-connector
cp .env.example .env        # Windows PowerShell 可用：Copy-Item .env.example .env

# 2) 只填“目标平台”那一段，其余留空即可（留空 = auto 回退 Mock）
#    飞书：FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_VERIFY_TOKEN / FEISHU_ENCRYPT_KEY
#    钉钉：DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET / DINGTALK_ROBOT_CODE / DINGTALK_STREAM=true
#    企微：WECOM_CORP_ID / WECOM_AGENT_ID / WECOM_SECRET（要收消息再加 WECOM_TOKEN / WECOM_AES_KEY）
#    邮箱：MAIL_<KEY>_ADDRESS / MAIL_<KEY>_AUTH_CODE（可配任意多个账号、任意服务商）

# 3) 先自检，再启动（自检只读：只换 token / IMAP 立基线 / SMTP 登录自检，不发任何业务消息）
pnpm run doctor
pnpm --filter @unimsg/server start
```

每个平台单独自检（`pnpm run doctor` 在 `unimsg-connector/` 下执行）：

| 平台 | 最少要填的变量 | 单平台自检 |
|---|---|---|
| 飞书 | `FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_VERIFY_TOKEN` | `pnpm run doctor -- --platform=feishu` |
| 钉钉 | `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET` / `DINGTALK_ROBOT_CODE` / `DINGTALK_STREAM=true` | `pnpm run doctor -- --platform=dingtalk` |
| 企业微信 | `WECOM_CORP_ID` / `WECOM_AGENT_ID` / `WECOM_SECRET`（收消息另加 `WECOM_TOKEN` / `WECOM_AES_KEY`） | `pnpm run doctor -- --platform=wecom` |
| 邮箱 | `MAIL_<KEY>_ADDRESS` / `MAIL_<KEY>_AUTH_CODE`（授权码，不是登录密码） | `pnpm run doctor -- --platform=mail` |

> ⚠️ 不要写 `pnpm doctor`：pnpm 9 自带同名内置命令会抢占它（变成诊断 pnpm 自身），本项目命令必须带 `run`，即 `pnpm run doctor`；在脚本里推荐写全路径 `pnpm --filter @unimsg/server run doctor`。

## 运行模式（auto / real / mock）

环境变量：`FEISHU_MODE`、`DINGTALK_MODE`、`WECOM_MODE`、`MAIL_MODE`，取值 `auto | real | mock`，**默认 `auto`**。

| 模式 | 语义 | 凭据不全时 |
|---|---|---|
| `auto`（默认） | 凭据足够（具备真实收或真实发能力）就走真实接口，否则本地 Mock | 自动回退 Mock，并在 `/api/accounts` 的 `reason` 里说明原因 |
| `real` | 强制真实接口，即使只具备一半能力也按真实通道处理 | 发送时**显式报错**并列出缺失变量（`assertRealSendable`），绝不静默假成功 |
| `mock` | 强制本地模拟，即使填了凭据也不外呼（适合离线演示 / 断网评审） | 不适用 |

`auto` 的判定（代码在 `packages/server/src/config/runtime.ts`）：

1. 平台具备「能收」或「能发」任一真实能力 → `mode=real`；两者都不具备 → `mode=mock`。
2. 邮箱特殊：`MAIL_ENABLED=false` 关闭轮询时，`auto` 直接回退 `mock`（避免“配置齐了却收不到”的歧义）；需要只发不收时请显式设 `MAIL_MODE=real`。
3. 旧全局 `MOCK` 变量**已废弃**：仅在没写 `*_MODE` 时作为默认策略（`MOCK=true→mock`、`MOCK=false→real`），启动日志与 `doctor` 都会打印废弃警告。请删除 `MOCK`，改用四个 `*_MODE`。
4. 非法取值（如 `FEISHU_MODE=enable`）会回退默认策略并给出警告，不会静默生效。

解析结果统一带 `policy / mode / configured / canSend / canReceive / missing / warnings / reason`，`/api/accounts`、启动日志、`doctor` 三处消费同一份数据，不会互相矛盾。

**Mock 绝不伪装成真实成功**，四处都会如实标注：

- 消息对象写入 `delivery.mode = "mock"`（真实发送为 `"real"`，并带平台返回凭证）；
- 闭环日志 `sent` 事件写「模拟发送（本地 Mock，未调用真实平台接口）」，`synced` 写「模拟状态回流（本地 Mock）」；
- `/api/health` 的 `sentMock` 单独计数，`modes` 标注每个平台本次实际通道；
- 前端账号页显示「真实接口 / Mock 模拟」Tag 与「模拟发送」计数，收件箱详情的「投递方式」同样醒目展示。

### 三个典型配置示例

**A. 只配钉钉（Stream 长连接，本机免公网）**

```dotenv
DINGTALK_MODE=auto
DINGTALK_CLIENT_ID=dingxxxxxxxxxxxxxxxx
DINGTALK_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
DINGTALK_ROBOT_CODE=dingxxxxxxxxxxxxxxxx
DINGTALK_STREAM=true
# 飞书 / 企微 / 邮箱不填 → auto 自动 Mock，不影响钉钉真实收发
```

**B. 只配邮箱（多账号、任意服务商）**

```dotenv
MAIL_MODE=auto
MAIL_POLL_SECONDS=45
MAIL_ACCOUNTS=qq,work          # 可省略；省略时自动发现所有 MAIL_<KEY>_ADDRESS
MAIL_QQ_ADDRESS=you@qq.com
MAIL_QQ_AUTH_CODE=xxxxxxxxxxxxxxxx
MAIL_QQ_FOLDERS=INBOX,Junk     # 反垃圾可能把信扔进垃圾箱，可选一起监听
MAIL_WORK_ADDRESS=you@company.com
MAIL_WORK_AUTH_CODE=xxxxxxxxxxxxxxxx
MAIL_WORK_PROVIDER=custom      # 126/yeah/gmail/outlook/icloud 等有内置预设
MAIL_WORK_IMAP_HOST=imap.company.com
MAIL_WORK_SMTP_HOST=smtp.company.com
MAIL_WORK_SMTP_PORT=587        # 587 自动按 STARTTLS 处理
```

**C. 四个平台全真实（其余参数用默认即可）**

```dotenv
FEISHU_MODE=real
DINGTALK_MODE=real
WECOM_MODE=real
MAIL_MODE=real
# 然后补齐各平台的凭据段；缺凭据时发送会显式报错，按错误/doctor 建议补
```

## 只有部分平台账号时的行为矩阵

| 平台 | 配置状态 | 收 | 发 | 实际通道 / UI 标注 |
|---|---|---|---|---|
| 飞书 | 什么都没填 | ✗ | ✗ | `mock`；账号页「未配置 / Mock 模拟」，回写标「模拟发送」 |
| 飞书 | 只有 App ID + Secret（缺 Verification Token） | ✗ | ✓ | `real`；警告「只能发不能收」，收到回调会验签失败 |
| 飞书 | App ID + Secret + Verification Token（可选 Encrypt Key） | ✓ | ✓ | `real`；若租户被 21001 拦，`doctor` 会 FAIL 并给建议 |
| 钉钉 | 什么都没填 | ✗ | ✗ | `mock`；账号页「未配置 / Mock 模拟」 |
| 钉钉 | Client ID/Secret + RobotCode（未开 Stream、无 AES） | ✗ | ✓ | `real`；警告「暂时收不到消息」 |
| 钉钉 | 上述 + `DINGTALK_STREAM=true`（或 HTTP 回调 Token/AES） | ✓ | ✓ | `real`；本机长连接即可收，无需公网 |
| 企业微信 | 什么都没填 | ✗ | ✗ | `mock` |
| 企业微信 | CorpID + Secret + AgentId（缺 Token/AESKey） | ✗ | ✓ | `real`；警告「只能发不能收」+ 可信 IP（60020）风险 |
| 企业微信 | 全部填齐 | ✓ | ✓ | `real`；出口 IP 必须已加入「企业可信 IP」 |
| 邮箱 | 什么都没填 | ✗ | ✗ | `mock`；回写标「模拟发送」 |
| 邮箱 | 至少一个账号 | ✓ | ✓ | `real`；默认有账号即开 IMAP 轮询（`MAIL_ENABLED=false` 可关收） |
| 邮箱 | 有账号 + `MAIL_ENABLED=false` + `MAIL_MODE=auto` | ✗ | ✓（模拟） | `mock`（auto 下轮询关闭按模拟处理）；显式 `MAIL_MODE=real` 才真实发送 |
| 任一平台 | 显式 `*_MODE=mock` | ✗ | ✗ | `mock`；即使填了凭据也不外呼 |
| 任一平台 | 显式 `*_MODE=real` 但缺凭据 | — | 报错 | `real`；发送抛错并列出缺失变量，不产生假的「已发送」 |

## 当前进度

| 模块 | 状态 |
|---|---|
| 共享消息契约（`shared/src/message.ts`） | ✅ 完成（含 `conversation`、`delivery`、邮箱 `mailMeta`；`SendResult.mode` 强制如实标注通道） |
| 运行时可替换性（`config/runtime.ts`） | ✅ 完成：四平台独立 `*_MODE`、`auto` 自动判定、`missing/warnings/reason`，旧 `MOCK` 废弃兼容 |
| 平台适配器（飞书 / 钉钉 / 企业微信 / 邮箱） | ✅ 代码与单测全部完成；钉钉 Stream 真实收发、邮箱四跳闭环已实测；飞书卡租户策略 `21001`；企微卡「企业可信 IP」 |
| 邮箱数据源 | ✅ 任意数量 / 任意服务商（8 个常见服务商预设 + `custom`）；IMAP 收 + SMTP 发；993/465 隐式 TLS 与 143/587/25 STARTTLS 均支持 |
| `doctor` 自检 | ✅ 环境 + 模式 + 逐平台探针（飞书 token / 钉钉 token + 机器人 + 通道 / 企微 gettoken / 邮箱 IMAP+SMTP 登录）+ 出口公网 IP + 中文修复建议；支持 `--json`、`--platform=`、`--help` |
| 真实平台 API 接入 | ✅ 钉钉 Stream 端到端（真实收 + 回写）；✅ 邮箱四跳闭环；🟡 飞书适配器完成，token 被租户策略 `21001` 拦截；🟡 企微 `gettoken` 通过，真实发送卡「企业可信 IP」 |
| 消息中枢：状态机 / 幂等 / 异步回写 / 回流 | ✅ 完成（状态回流单向防倒退） |
| 安全：Bearer 鉴权 + WebSocket 握手校验 | ✅ 完成 |
| 闭环日志（traceId 全链路可回放） | ✅ 完成（Mock 与真实通道分开描述） |
| 边界降级：限流退避、OCR 置信度、意图失败回退、DLQ | ✅ 完成 |
| 单元测试 / 端到端冒烟 | ✅ 2026-11-06 实测：server **217** 条、web **76** 条、e2e **20** 项断言、契约自检 **46** 项全绿 |
| 上手与交付文档 | ✅ [quickstart.md](docs/quickstart.md)（5 分钟上手）/ [demo-script.md](docs/demo-script.md)（演示脚本）/ [delivery-checklist.md](docs/delivery-checklist.md)（交付打包）/ [risk-register.md](docs/risk-register.md)（风险台账）；README 顶部有「30 秒选路径」 |
| 健壮性加固（本轮） | ✅ webhook 空/畸形事件 400 不入库、端口占用中文提示、CORS 白名单、状态回流防倒退、日志脱敏、空 `API_TOKEN` 不关鉴权、邮箱嵌套 MIME/水位持久化/中文目录 |
| 大模型 / OCR 真实调用 | 🚧 未实现：当前按关键词规则 Mock（配置项已预留） |
| PostgreSQL / Redis 实装 | 🚧 仅有 DDL 与仓储接口，实际始终走内存 |
| 前端统一入口 | ✅ 四类数据源版本：收件箱 / 待办 / 全链路回放 / 平台账号（含模式 Tag、缺失变量、模拟发送计数、首启 3 步引导、断连如实显示） |

## 功能特性（对应业务闭环五要素）

- **接收**：四类数据源统一接入。飞书 Webhook（校验 Verification Token，配置 Encrypt Key 时 AES 解密，支持 `url_verification` challenge）；钉钉 **Stream 长连接**（本机免公网）或 HTTP 回调（`timestamp + HMAC` 签名 + AES 解密）；企业微信 XML 回调（SHA1 验签 + AES 解密 + GET `echostr` 握手）；邮箱 IMAP 轮询（UID 水位，首轮只立基线）。Mock 下签名带 `mock` 或 `dev*` 前缀即通过。
- **展示**：REST 列表 + WebSocket 实时推送，按平台 / 状态筛选。
- **处理**：直接回复、标记完成；规则 Mock 给出意图与回复草稿（真实大模型调用尚未接入）。
- **回写**：按目标平台格式转换后异步发送，结果经 WS 推送，并写入 `delivery`。真实接口：飞书 `im/v1/messages`、钉钉机器人 `groupMessages/send` / `oToMessages/batchSend`、企微 `cgi-bin/message/send`、邮箱 SMTP（带 `In-Reply-To` 串回会话）。
- **回流**：平台状态事件经 Webhook 回流（邮箱由轮询回收），`syncStatus` 更新本地并留痕，支持按 `traceId` 或 `externalId` 定位消息。

### 状态机

```
received → processing → replied → sent → synced
                └────────── 发送失败 → failed（指数退避重试，耗尽写 DLQ）
```

### 关键设计

- **可替换性**：换账号只改 `.env`；每个平台的 `mode / policy / 收 / 发 / missing / warnings / reason` 是纯函数解析结果，可单测、可被 API、日志、doctor 复用。
- **幂等**：以 `(platform, externalId)` 为唯一键，平台重推直接返回已有记录（`duplicate=true`），不重复入库（DDL 中有 `UNIQUE` 约束）。邮箱的 `externalId` 为 `<账号>:<目录>:<UID>`，多账号、多目录互不撞车。
- **异步回写**：`reply` 先同步推进到 `replied`，随即返回 `202 + taskId`，真正发送在后台完成，避免接口阻塞。
- **边界降级**：限流令牌桶 + 指数退避只作用于发送路径（每平台容量 60、每秒补 30，重试上限 `SEND_MAX_RETRY`）；OCR 置信度低于 `OCR_CONFIDENCE_THRESHOLD`（默认 0.7）标记「待人工确认」；LLM 超时 / 失败回退「未分类」，绝不伪造意图；重试耗尽写入 DLQ。
- **密钥安全**：平台 / 大模型 / OCR 凭据只从服务端环境变量读取，绝不以 `VITE_` 注入前端，`.env` 已被 `.gitignore` 忽略。

## 技术栈

- 运行时：Node.js ≥ 20（本机实测 24.14.0）、TypeScript 5.6
- 后端：Express 4、ws（WebSocket）
- 前端：React 18 + Vite 5 + TypeScript + Ant Design 5（Mock / 真实后端双模式，由 `VITE_API_BASE` 切换）
- 真实接入：飞书 / 钉钉 / 企微适配器使用 Node 内置 `fetch` + 进程内 token 缓存；钉钉收消息使用官方 `dingtalk-stream`（唯一的额外依赖）；邮箱使用自研 IMAP/SMTP 客户端（`node:tls` / `node:net`，零额外依赖）
- 仓储：内存实现（当前唯一实现）；PostgreSQL 仅有 `001_init.sql` 与仓储接口，尚无 PgRepository；Redis 未接入
- 智能：LLM / OCR 均为规则 Mock；文心 / 通义 / 腾讯云 OCR 只保留配置项，真实调用未实现

## 目录结构

```
LinkHub-test/
├── README.md
├── LICENSE
├── docs/
│   ├── quickstart.md           # 5 分钟上手（三类用户分流 + 常见卡点表）
│   ├── swap-accounts.md        # 换账号指南：逐平台 checklist / errcode 排错 / 邮箱预设表
│   ├── demo-script.md          # 5–8 分钟现场演示脚本（含演示前检查与纯 Mock 兜底）
│   ├── delivery-checklist.md   # 交付/打包 checklist
│   └── risk-register.md        # 用户风险台账（31 条，按 P0–P3 排序）
├── .github/workflows/ci.yml    # typecheck + 测试 + web build + e2e:sh
├── documents/                  # 设计文档（初赛精简版 / 决赛完整版）
├── test.photos/                # 历史冒烟截图（2026-11-02 旧版，界面已改版，仅作记录）
└── unimsg-connector/           # pnpm monorepo 源码
    ├── packages/shared/src/message.ts      # 前后端共享契约（含 delivery）
    ├── packages/web/                       # 前端（React + AntD，账号页含模式标注、首启 3 步引导）
    │   └── README.md                       # 前端说明（模式 / 环境变量相关小节）
    ├── packages/server/src/
    │   ├── config/runtime.ts  # 运行模式解析 / 邮箱多账号解析（可替换性核心）
    │   ├── config.ts          # 服务端私有配置（凭据只在此读取）
    │   ├── doctor.ts          # pnpm run doctor 入口
    │   ├── doctor/            # 探针（probes）、报告渲染（report）、环境变量拼写检查（env-check）
    │   ├── connectors/        # 飞书 / 钉钉 / 企微 / 邮箱适配器（crypto / real 为真实接入工具）
    │   ├── core/              # 闭环日志 / 幂等 / 指标
    │   ├── services/          # 消息中枢 / 回流 / LLM / OCR / 限流
    │   ├── stream/            # 钉钉 Stream 长连接 / 邮箱 IMAP 轮询器（水位持久化）
    │   ├── routes/            # health / webhook / messages（含 /api/accounts）
    │   ├── middlewares/auth.ts
    │   ├── db/                # 仓储 + migrations/001_init.sql
    │   └── app.ts / index.ts / ws.ts
    ├── scripts/               # smoke.py + e2e.ps1 / e2e.sh + deliver.mjs（交付打包）
    ├── .env.example           # 配置模板（配置的权威来源）
    └── .mail-watermarks.json  # （运行时生成，已 gitignore）邮箱 UID 水位，重启续传
```

## 快速开始

环境要求：Node.js ≥ 20、pnpm ≥ 9、Python 3（仅 `e2e` 冒烟脚本需要）。

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
  # macOS / Linux / Git Bash：
  printf 'VITE_API_BASE=http://127.0.0.1:3001\nVITE_API_TOKEN=dev-token\n' > packages/web/.env
  # Windows PowerShell：
  # "VITE_API_BASE=http://127.0.0.1:3001`nVITE_API_TOKEN=dev-token" | Set-Content packages/web/.env
  pnpm --filter @unimsg/web dev
  ```

  没有任何平台凭据时，四类数据源都会以 `mock` 通道运行：`/api/health` 的 `modes` 全为 `mock`，回写会在消息里标注「模拟发送」。想灌几条演示消息，可在另一个终端用 `scripts/smoke.py`（先启动后端），或直接调 `POST /api/webhook/feishu|dingtalk|wecom`。

- **一键端到端（自动起服务 → 冒烟 → 关闭）**：

  ```bash
  pnpm e2e
  ```

  > 端口冲突时改端口用 `pnpm e2e -Port 3102`。不要写成 `pnpm e2e -- -Port 3102`：pnpm 9 会把 `--` 原样传给脚本，PowerShell 解析参数失败。
  > 想手动验证，服务启动后另开终端执行 `python scripts/smoke.py http://127.0.0.1:3001`。
  > `scripts/e2e.sh` 会自动探测 `python` / `python3`；都找不到时提示安装 Python 3。e2e 会强制四个平台 `mock` 并关闭邮箱轮询，完全离线可复现，不受本机真实 `.env` 影响。

## 配置说明

复制 `unimsg-connector/.env.example` 为 `unimsg-connector/.env`（服务会自动从 monorepo 根目录加载），按需填写。**下表与 `.env.example` 逐项对应，是配置的权威来源。**

### 服务与模式

| 变量 | 说明 |
|---|---|
| `SERVER_PORT` | 服务端口，默认 `3001` |
| `SERVER_HOST` | 监听地址；留空 = 所有网卡（局域网/容器可访问）。只想本机访问可设 `127.0.0.1`（注意：局域网访问时默认 `dev-token` 有风险，见安全提示） |
| `API_TOKEN` | 入口鉴权令牌（默认 `dev-token`，生产务必修改；REST 用 Bearer，`/ws?token=` 用同名令牌）。**留空会回退 `dev-token` 并告警、仍强制鉴权**；`NODE_ENV=production` 且仍为空/默认时拒绝启动 |
| `CORS_ORIGINS` | CORS 白名单，逗号分隔 Origin（如 `http://127.0.0.1:5173`）。**留空 = 放行所有来源**（兼容本地演示）；填了则名单外 Origin 返回 403 JSON |
| `DATABASE_URL` / `REDIS_URL` | 预留项：不影响存储实现；填 `DATABASE_URL` 只会让启动日志显示 `postgres(未启用·当前内存)` |
| `FEISHU_MODE` / `DINGTALK_MODE` / `WECOM_MODE` / `MAIL_MODE` | 每平台运行模式，`auto`（默认）/ `real` / `mock`，见上文「运行模式」 |
| `MOCK` | **已废弃**，仅为兼容旧配置保留；只在没写 `*_MODE` 时作为默认策略，会打印废弃警告 |

### 边界降级与智能（预留）

| 变量 | 说明 |
|---|---|
| `OCR_CONFIDENCE_THRESHOLD` | OCR 置信度阈值，默认 `0.7`；低于阈值标记「待人工确认」 |
| `SEND_MAX_RETRY` | 发送最大重试次数，默认 `3` |
| `RETRY_BASE_MS` | 重试退避基数，默认 `1000`（ms） |
| `LLM_TIMEOUT_MS` | 真实平台 API 与 LLM 调用超时，默认 `8000`（ms） |
| `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_ENDPOINT` | 大模型配置：`mock`（默认）/ `wenxin` / `qwen`；**真实调用尚未实现，填了也仍走 Mock** |
| `OCR_PROVIDER` / `OCR_API_KEY` / `OCR_SECRET_ID` | OCR 配置：`mock`（默认）/ `tencent`；**真实调用尚未实现，填了也仍走 Mock** |

### 飞书

| 变量 | 说明 |
|---|---|
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 自建应用凭证（开发者后台 → 凭证与基础信息） |
| `FEISHU_VERIFY_TOKEN` | 事件订阅 Verification Token（收消息验签必需） |
| `FEISHU_ENCRYPT_KEY` | 事件加密 Encrypt Key（后台开启加密策略时必需；未配置只能收明文回调） |
| `FEISHU_BASE_URL` | 开放平台基址，默认 `https://open.feishu.cn`（国际版 Lark / 代理网关可覆盖） |

### 钉钉

| 变量 | 说明 |
|---|---|
| `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET` | 应用凭证（新版后台叫 Client ID / Secret；旧版 `DINGTALK_APP_KEY` / `_APP_SECRET` 仍兼容） |
| `DINGTALK_ROBOT_CODE` | 机器人编码；留空自动取 Client ID（企业内部应用通常相同） |
| `DINGTALK_STREAM` | `true` 时用 Stream 长连接收机器人消息，本机无需公网（需在后台把机器人消息接收模式选为 Stream 并发布版本） |
| `DINGTALK_AES_TOKEN` / `DINGTALK_AES_KEY` | HTTP 回调模式才需要（事件订阅的 Token / 加密密钥） |
| `DINGTALK_BASE_URL` | 开放平台基址，默认 `https://api.dingtalk.com` |

### 企业微信

| 变量 | 说明 |
|---|---|
| `WECOM_CORP_ID` | 企业 ID（管理后台 → 我的企业 → 企业信息） |
| `WECOM_AGENT_ID` / `WECOM_SECRET` | 自建应用 AgentId / Secret（应用详情页，Secret 点「眼睛」查看，**不要点重置**） |
| `WECOM_TOKEN` / `WECOM_AES_KEY` | 应用「接收消息 → 设置 API 接收」的 Token / EncodingAESKey（43 位）；收消息必需 |
| `WECOM_BASE_URL` | 企微 API 基址，默认 `https://qyapi.weixin.qq.com`；发信出口 IP 必须加入「企业可信 IP」，否则报 60020（`doctor` 会显示当前出口 IP） |

### 邮箱（任意数量 / 任意服务商）

| 变量 | 说明 |
|---|---|
| `MAIL_POLL_SECONDS` | IMAP 轮询间隔秒数，默认 `45`（最小 5）；不是实时推送 |
| `MAIL_STATE_FILE` | UID 水位状态文件路径（默认 `unimsg-connector/.mail-watermarks.json`，已 gitignore）；**重启后续传水位、不再漏信**；异常重建目录（UIDVALIDITY 变化）会自动重导 |
| `MAIL_ENABLED` | 兼容旧行为：不填 = 有账号就开启轮询；`false` = 只发不收 |
| `MAIL_ACCOUNTS` | 显式声明要启用的账号（只加载列出的 key），如 `qq,163,work`；**可省略**，省略时自动发现所有 `MAIL_<KEY>_ADDRESS` |
| `MAIL_<KEY>_ADDRESS` / `MAIL_<KEY>_AUTH_CODE` | 邮箱地址 + **授权码**（网页端开启 IMAP/SMTP 后生成，不是登录密码）；`KEY` 可随意取（`qq` / `163` / `work` / `school2` …） |
| `MAIL_<KEY>_PROVIDER` | 服务商：`qq` / `foxmail` / `163` / `126` / `yeah` / `gmail` / `outlook` / `icloud` / `custom`；也可按邮箱域名自动推断 |
| `MAIL_<KEY>_LABEL` | 展示名称（默认取预设名，如「QQ邮箱」） |
| `MAIL_<KEY>_IMAP_HOST` / `MAIL_<KEY>_SMTP_HOST` | 收发服务器；内置预设可省略，`custom` 或未知服务商必填 |
| `MAIL_<KEY>_IMAP_PORT` / `MAIL_<KEY>_SMTP_PORT` | 端口；不填用预设。`993/465` = 隐式 TLS（默认），`143/587/25` = STARTTLS |
| `MAIL_<KEY>_IMAP_SECURE` / `MAIL_<KEY>_SMTP_SECURE` | 显式覆盖加密方式（`true`=隐式 TLS，`false`=STARTTLS）；一般按端口自动推断即可 |
| `MAIL_<KEY>_FOLDERS` | 监听目录，默认 `INBOX`；反垃圾把信扔进垃圾箱时可写 `INBOX,Junk`（多个用逗号分隔） |

> 邮箱的 `externalId` 形如 `<账号key>:<目录>:<UID>`，所以多账号、多目录同时监听也不会互相吞消息；授权码只存服务端，`/api/accounts` 只返回脱敏地址与端口/加密方式。

## 真实接入配置

逐平台的「后台点什么 → 填哪些 env → 验证命令 → 常见报错」完整 checklist、errcode 排错表、邮箱 provider 预设表与端口/加密表、多账号示例、可信 IP 与飞书企业认证的现实说明，统一见 **[docs/swap-accounts.md](docs/swap-accounts.md)**。下面是速查入口：

| 平台 | 收消息方式 | 需要公网吗 | 关键点 | 验证命令（在 `unimsg-connector/` 下） |
|---|---|---|---|---|
| 飞书 | 事件订阅 HTTP 回调 | 是（需公网 URL） | `im.message.receive_v1` 事件 + Verification Token（可选 Encrypt Key） | `pnpm run doctor -- --platform=feishu` |
| 钉钉 | Stream 长连接（推荐）或 HTTP 回调 | Stream 否 / 回调是 | 机器人消息接收模式选 Stream，`DINGTALK_STREAM=true`，发布版本 | `pnpm run doctor -- --platform=dingtalk` |
| 企业微信 | 应用「API 接收」回调 | 是（需公网 URL） | Token / EncodingAESKey + 出口 IP 加入「企业可信 IP」 | `pnpm run doctor -- --platform=wecom` |
| 邮箱 | 本机 IMAP 轮询 | 否 | 网页端开启 IMAP/SMTP + 生成授权码；可多账号 | `pnpm run doctor -- --platform=mail` |

- 飞书：`https://<域名>/api/webhook/feishu`（配置回调 URL 时服务自动回 `challenge`）。
- 钉钉 HTTP 回调：`https://<域名>/api/webhook/dingtalk`，把 Token / AES Key 填进 `DINGTALK_AES_TOKEN` / `DINGTALK_AES_KEY`。
- 企业微信：`https://<域名>/api/webhook/wecom`，GET 握手会解密 `echostr` 回明文。
- 邮箱：没有平台回调，真实模式下 `/api/webhook/mail` 一律拒绝（防伪造），邮件只能由本机 IMAP 轮询入库。
- 反向代理场景下把 `https://<域名>/api` 整体转到 `127.0.0.1:3001` 即可，路由本身不依赖前缀。

## API 一览

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/health` | 公开 | 健康检查 + 运行指标（`received` / `deduped` / `sent` / `sentMock` / `failed` / `dlq`）+ **`modes`（每平台实际通道）** |
| POST | `/api/webhook/:platform` | 平台签名 | 接收消息或状态回流事件（`feishu` / `dingtalk` / `wecom`；`mail` 仅 Mock 演示） |
| GET | `/api/accounts` | Bearer | 返回 **4 个平台**的 `configured` / `policy` / `mode` / `canReceive` / `canSend` / `missing` / `warnings` / `reason`；邮箱另带 `accounts[]` 明细与 `issues[]` |
| GET | `/api/messages` | Bearer | 消息列表，支持 `?platform=&status=` |
| GET | `/api/messages/:id` | Bearer | 消息详情（`:id` 传 `traceId`；消息内含 `delivery` 投递标注） |
| POST | `/api/messages/:id/reply` | Bearer | 回复（`202`，异步回写） |
| POST | `/api/messages/:id/done` | Bearer | 标记待办完成（置 `done`，不改状态机状态） |
| GET | `/api/messages/trace/:traceId` | Bearer | 全链路回放（消息 + 闭环日志；未知 traceId 返回空数组） |
| WS | `/ws?token=<API_TOKEN>` | Token | 推送 `connected` / `message.received` / `message.updated` / `message.failed`；token 错误直接 `1008` 关闭 |

鉴权示例：`Authorization: Bearer dev-token`，业务接口也接受 `?token=dev-token`（默认开发 token，生产请在 `.env` 中改 `API_TOKEN`）。

## 测试与验证

实测环境：Windows 11、Node 24.14.0、pnpm 9.15.9（corepack / shim）、Python 3.12.10；日期 **2026-11-06**（保留 2026-11-03 的真实接入记录，见下）。

| 命令 | 实测结果 |
|---|---|
| `pnpm typecheck` | `shared` / `server` / `web` 三包检查通过（exit 0） |
| `pnpm test`（server） | **217 passed / 217**（16 个测试文件：连接器、真实适配器、MIME、IMAP 水位/目录、webhook HTTP 级、app/CORS、doctor 探针/渲染/拼写检查等），约 1–2s |
| `pnpm test:web` | **76 passed / 76**（11 个测试文件：HttpApi / WsRealtime / AppStore / MockApi / AccountsPage / FirstRunGuide / footerState / InboxPage / MessageCard / ReplyComposer / format） |
| `pnpm e2e`（Windows PowerShell，默认 3001） | **20 项断言全部 PASS + `SMOKE OK`**，exit 0（约 10s）；强制四平台 `mock`，完全离线 |
| `pnpm e2e:sh`（Git Bash，3123 端口） | 同上，**20 项 PASS + `SMOKE OK`**（CI 使用此命令） |
| 契约自检（后端起 mock 后） | `node packages/web/scripts/verify-contract.mjs http://127.0.0.1:3001 dev-token` → **46 PASS / 0 FAIL**（含 `modes` / `sentMock` / `mode`+`policy` / 邮箱账号明细 / `delivery` / WS 握手） |
| `pnpm run doctor` | **PASS 8 / FAIL 1 / SKIP 0，退出码 1**：唯一 FAIL 为飞书 `21001`（租户策略，代码无解）；退出码 1 是「有 FAIL」的约定结果 |
| `pnpm run doctor -- --platform=mail` | **PASS 4 / FAIL 0**（两个邮箱账号的 IMAP 登录基线 + SMTP 认证；地址已脱敏） |
| CI（`.github/workflows/ci.yml`） | Ubuntu + Node 22 + pnpm 9.15.9：install → typecheck → server 测试 → web 测试 → web build → `e2e:sh 3121` |

### 本轮健壮性加固验收（2026-11-04 实测）

| 验收项 | 结果 |
|---|---|
| 空 / `{}` / 畸形 JSON webhook | 均 **400** JSON 错误说明，不入库、不占幂等键；正常三平台样例仍 200 / 企微 `success` |
| 状态回流防倒退 | `synced` 后再推 `received` → 状态保持 `synced`（写入 `sync_ignored` 留痕），HTTP 仍 200 |
| 端口占用 | 第二个实例启动 → 中文提示「端口 X 已被占用」+ 结束进程命令，退出码 1，无英文栈 |
| CORS 白名单 | 配置 `CORS_ORIGINS` 后：名单内 Origin 200 + 回显、名单外 **403**、无 Origin 的 curl 放行 |
| 鉴权边界 | `API_TOKEN=` 留空 → 回退 `dev-token` 并告警，**仍强制 Bearer**（无 token → 401）；`NODE_ENV=production` + 默认/空 token → 拒绝启动 |
| 邮箱数据可信 | 嵌套 `multipart/mixed(alternative+attachment)` 正文递归提取（11 条 MIME 单测）；水位持久化 + 单轮多批追平 + UIDVALIDITY 变化自动重导；中文目录 modified UTF-7 有单测 |
| doctor 退出码 | 修复 Windows + Node 24 下「报告 PASS 但退出码 0xC0000409」的强制退出竞态；实测 `--platform=dingtalk/wecom/mail` exit 0、`--platform=feishu` exit 1，稳定可脚本化 |
| 首启引导 | 真实后端 + 空收件箱显示「3 步上手」（四平台通道 Tag/缺失变量/可复制命令）；Mock 模式不显示；后端 500 时不误报「已连上」；页脚按连接状态如实显示 |

`doctor` 实测摘要（2026-11-04，真实凭据、只读探针，未发送任何业务消息）：

- 环境：Node v24.14.0 ✔、`unimsg-connector/.env` 已加载、无旧 `MOCK` / 非法模式警告；邮箱账号 2 个（IMAP 轮询开启）。
- 平台模式：飞书 / 钉钉 / 企业微信 / 邮箱均为 `auto → real`；企微缺 `WECOM_TOKEN` / `WECOM_AES_KEY`（只能发不能收）。
- 探针：钉钉 accessToken、`DINGTALK_ROBOT_CODE`、Stream 通道三条全 **PASS**（Stream 模式下 AES Token/Key 不再被误报为缺失）；企微 `gettoken` **PASS**；163 与 QQ 两个邮箱的 IMAP 登录基线与 SMTP 认证四条全 **PASS**（地址脱敏为 `1******@163.com` / `3******@qq.com`）。
- 唯一 **FAIL**：飞书 `tenant_access_token` 返回 `21001 Access denied due to platform policy`，建议文案已指向「企业认证 / 换合规租户」。
- 说明：HTTP 类探针超时 8s；IMAP/SMTP 登录往返较慢，邮箱探针超时放宽到 25s（避免假超时）。
- 出口公网 IP：`pnpm run doctor` 每次都会打印当前出口公网 IP（企业微信可信 IP 绑定的就是它）；本次实测 2026-11-03 → 11-04 同一网络出口 IP 保持不变——电脑重启一般不影响，但重启路由器 / 切换网络 / 开代理后需要重新核对。

### 真实接入实测记录

- **真实模式启动（2026-11-04，`.env` 填真实凭据）**：启动日志实测为
  `[unimsg] 运行模式: 飞书=real(auto) 收✓发✓ | 钉钉=real(auto) 收✓发✓ | 企业微信=real(auto) 收✗发✓ | 邮箱=real(auto) 收✓发✓`；
  钉钉 Stream 已连接（`[stream] 钉钉 Stream 已连接`）；163 与 QQ 两个邮箱 IMAP 基线连接成功（`已连接，基线 UID=…`，QQ 的 `Junk` 目录也纳入监听）。
- **钉钉端到端已跑通（2026-11-03，Stream 模式，本机无公网）**：手机钉钉给机器人发 3 条消息 → 全部实时入库并带出 `conversation`；调 `reply` 接口 → 状态走完 `replied → sent → synced`，`/api/health` 的 `sent` 递增，机器人消息真的回到钉钉会话。钉钉 `POST /v1.0/oauth2/accessToken` 用真实 Client ID/Secret 换取 accessToken 成功；未认证企业也可用。
- **邮箱四跳闭环已机器验证（2026-11-03，本机无公网）**：
  1. 自研 SMTP 客户端从 `smtp.163.com:465` 发信到 QQ → 回执 `250 Mail OK queued as …`；
  2. 轮询从 `imap.qq.com:993` 把它收进中枢 → `externalId=qq:INBOX:<UID>`、`status=received`；
  3. 调 `POST /api/messages/:traceId/reply` → 走 **QQ 的 SMTP** 回写 → 状态 `sent → synced`，`/api/health` 的 `sent` 递增；
  4. 回信落到 163 收件箱后被轮询收回 → `externalId=163:INBOX:<UID>`，`mailMeta.inReplyTo` 是 QQ 真实返回的 Message-ID。
  全程中文主题与正文无损，两个发信账号与两个收信账号都各跑通一次。
- **邮箱多账号与 STARTTLS（本轮新增）**：任意数量账号（`MAIL_ACCOUNTS` 显式列表或自动发现 `MAIL_<KEY>_ADDRESS`）、8 个常见服务商预设 + `custom`、993/465 隐式 TLS 与 143/587/25 STARTTLS 均实现并有单测覆盖；2026-11-04 `doctor --platform=mail` 用真实账号验证了 IMAP 基线 + SMTP 认证（PASS 4/4）。真实服务商 587/143 端到端尚未实测（已有实测链路走 465/993）。
- **飞书 21001（2026-11-03）**：`POST /auth/v3/tenant_access_token/internal` 返回 `21001 Access denied due to platform policy`。已排除密钥错误（错误密钥返回 `10014`）、IP 白名单（未开启）、应用未发布（已发布 1.0.0 且状态「已启用」）、测试企业通道（建了测试企业并关联应用，仍 `21001`）——属租户级平台策略，需要企业认证或符合策略的租户。
- **企业微信（代码就绪，卡可信 IP）**：真实适配器与 19 条单测已完成（SHA1 验签、AES 加解密、XML 解析、GET 握手、`gettoken` → `message/send`）；2026-11-04 `gettoken` 实测 **PASS**。当前 `.env` 只配了发信凭据（`WECOM_CORP_ID` / `WECOM_AGENT_ID` / `WECOM_SECRET`），缺 `WECOM_TOKEN` / `WECOM_AES_KEY` 所以收不到消息；真实发送还要求发信出口 IP 已加入「企业可信 IP」，否则报 **60020**（本轮真实接入即卡在这一步，`doctor` 会直接打印当前出口公网 IP）。
- **Mock 标注已被机器校验**（`scripts/smoke.py` / e2e，以及 46 项契约自检）：`delivery.mode=mock`、`health.sentMock>=1`、闭环日志 `sent` 含「模拟发送」、`/api/accounts` 四平台均带 `mode/policy` 且为 `mock`。

### 手工补充验证（沿用历史记录）

- `/api/accounts`：无 token / 错 token 返回 401，Bearer 与 `?token=` 均 200；只返回布尔值、变量名与脱敏邮箱，不返回任何密钥。
- 验签：`x-signature` 篡改为非法值时 401；未知平台 404。
- WebSocket：正确 token 收到 `connected` 与 `message.received`；回复链路依次收到 4 帧 `message.updated`（processing / replied / sent / synced）；错 token、无 token 均 `1008 unauthorized`。
- 异步回写：`reply` 返回 202 + `taskId`，后台完成后状态为 `synced`；失败重试耗尽后 `failed` + DLQ。
- 回流：状态事件经 Webhook 按 `traceId` / `externalId` 均能把状态改为目标值并写入 `sync` 日志。
- 本地全栈联调（2026-11-03，Mock）：后端 3001 + 前端 5173，页面显示「真实后端 · 已接入 LinkHub Server」；Webhook 灌入 4 条消息 → 收件箱计数 4、待办 2；页面内回复后状态走完 `received → processing → replied → sent → synced`，`/api/health` 中 `sent=1`，前端经 WebSocket 实时更新。
- 截图见 `test.photos/`（2026-11-02 旧版界面，仅作历史记录）；当前版本的演示流程与界面说明见 [docs/demo-script.md](docs/demo-script.md)。

## 设计文档承诺 vs 当前实现（验收前必读）

设计文档（`documents/`）是"目标态"，本仓库是"当前态"。为避免评审/验收时按文档核对产生误会，这里如实列出差异：

| 设计文档承诺 | 当前实现 | 说明 / 后续 |
|---|---|---|
| 四类数据源（飞书 / 钉钉 / 企微 / 邮箱）统一接入 | ✅ 已实现（邮箱为超出原设计的新增数据源） | 三平台 + 邮箱，均可 Mock/真实独立切换 |
| 完整闭环（接收→展示→处理→回写→回流）+ traceId 回放 | ✅ 已实现并有单测/e2e 覆盖 | `pnpm e2e` 20 项断言 |
| 独立部署：Docker Compose 拉起 postgres/redis/server/web | ❌ **尚未提供** Dockerfile / docker-compose | 当前用 pnpm 本地启动；内存存储，重启即清空；补容器化列入后续计划 |
| PostgreSQL / Redis 持久化 | ❌ 未实现 | 仅有 `001_init.sql` 与仓储接口，实际始终内存 |
| 真实大模型意图识别 / OCR | ❌ 未实现 | 规则 Mock（配置项已预留，降级策略已实现） |
| 三平台真实收发 | 🟡 部分 | 钉钉 Stream 真实收发已跑通；飞书卡租户策略 `21001`；企微卡「企业可信 IP」`60020`（`pnpm run doctor` 可自证） |
| 入口鉴权（Bearer + WS）| ✅ 已实现 | `/api/*` 与 `/ws` 同一 token；默认 `dev-token` 仅演示用，对外需改 |
| CORS 白名单 | ✅ 已实现 | `CORS_ORIGINS` 白名单（不填保持 `*` 兼容本地；填了名单外 403 JSON） |
| 日志脱敏 | ✅ 已实现 | 闭环日志不含正文；doctor 报告邮箱脱敏；启动日志与 `mock-send` 已不打印邮箱/正文 |
| Webhook 健壮性 | ✅ 本轮加固 | 空 / 畸形事件 400 不入库；状态回流防倒退；畸形 JSON 返 JSON 错误 |

> 风险全量清单（含每条的影响/修复状态/兜底方案）见 [docs/risk-register.md](docs/risk-register.md)；交付前务必走 [docs/delivery-checklist.md](docs/delivery-checklist.md)。

## 已知限制

- **飞书真实收发被租户策略 `21001` 拦住**：代码与配置都已就绪，但要企业认证或换合规租户才能验证；此外 `im:message`（获取与发送单聊、群组消息）权限尚未开通，当前只有 `im:message:send_as_bot`。
- **企业微信**：真实适配器与 19 条单测已就绪、`gettoken` 已通，但**卡在「企业可信 IP」**——当前出口 IP 不在白名单，真实发送端到端尚未验证（典型报错 60020）；同时缺回调 Token/EncodingAESKey，暂时收不到消息。`pnpm run doctor` 每次都会打印当前出口公网 IP：电脑重启一般不影响（公网出口在网关/运营商侧），但重拨路由器、换网络、开代理后可能变化，演示前先核对即可。
- **钉钉**真实收消息依赖 Stream 长连接（本机可用）或公网 HTTP 回调；`DINGTALK_STREAM` 默认关闭，需要显式开启并在后台发布版本。
- **钉钉 / 企业微信群聊只推「@机器人」的消息**（平台规则，不是本项目限制）：普通群消息不会推给机器人，钉钉 Stream 的机器人通道只投递「单聊」和「群内 @机器人」。所以群聊场景能聚合的就是被 @ 的那一条，**不能承诺"群里所有消息都收"**。另外群里要添加的是**企业内部应用机器人**（自定义 Webhook 机器人只能发、不能收）。群内 @ 消息入库后会保留群会话与群名，回复走群消息接口回到原群（界面「会话」一行显示「群聊「群名」· 回复会发回该群」）。参考：[钉钉机器人接收消息](https://open.dingtalk.com/document/robots/receive-message)。
- **邮箱**没有平台回调：真实模式下 `/api/webhook/mail` 一律验签失败，新信只能由本机轮询 ingest，默认 45s 一轮，不是实时。
- 邮箱 UID 水位已持久化到 `.mail-watermarks.json`（`MAIL_STATE_FILE` 可改路径），重启续传、不再跳过停机期间的邮件；单轮最多追 5 批（每批 20），大批量新邮件会跨轮继续，不会跳水位。**升级到本版本之前**已发生过的「目录被清空/重建」无法识别（旧状态没有 UIDVALIDITY）；升级后遇到 UIDVALIDITY 变化会按「宁可重复、不漏信」自动重导（若目录重建但保留原邮件，可能重复导入一次）。
- 邮箱 STARTTLS（143/587/25）已实现并有单测，但真实服务商 587/143 端到端尚未实测；部分服务商（如 Gmail 需应用专用密码，部分 Microsoft 365 租户关闭基础认证）可能拒绝账号密码/授权码登录，遇到时需改用应用专用密码或换服务商。
- 邮箱附件：正文会递归解析嵌套 multipart（不会因带附件而丢正文），附件名只出现在正文摘要/`attachments` 字段，不下载附件内容；中文 IMAP 目录已支持 modified UTF-7 编码（仅对配置的目录 SELECT，未实现目录自动发现）。
- 真实大模型 / OCR 尚未实现：`LLM_*` / `OCR_*` 只是预留配置，实际始终走规则 Mock。
- PostgreSQL / Redis 仅有 DDL 与仓储接口，实际始终走内存；多实例部署时限流、token 缓存、消息均不共享。**Docker Compose 尚未提供**（设计文档承诺项，见上表）。
- 前端默认跑内存 Mock 数据；配 `VITE_API_BASE` / `VITE_API_TOKEN` 后即接本仓库后端。入口令牌是演示性质（`VITE_` 会进前端 bundle），生产需换成登录后签发的短期凭证。
- 默认监听所有网卡（`SERVER_HOST` 留空）+ 默认 `dev-token` 只适合本机演示；公共 Wi-Fi / 局域网演示时同网段可访问接口，**对外暴露前必须改 `API_TOKEN`、按需设 `CORS_ORIGINS` / `SERVER_HOST`**。
- Mock 下不带签名头时按 `mock` 放行、`dev*` 前缀签名同样放行，仅适合本地演示；邮箱真实模式没有回调通道也是防伪造的有意设计。
- 所有消息、闭环日志、DLQ 都在内存里，进程重启即清空（邮箱水位除外，已落盘）。
- `scripts/e2e-server.log.err`：旧版本曾误提交，本版本已从 git 索引删除，并把 `*.log.err` / `*.log` 加入 `.gitignore`（日志类产物不再进仓库）。
- `test.photos/` 是 2026-11-02 旧版界面截图，当前 UI 已改版（新增账号页模式标注、首启引导等），仅作历史证据保留。

## 常用命令

在 `unimsg-connector/` 目录下执行：

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 开发模式（tsx watch） |
| `pnpm start` | 启动服务（:3001） |
| `pnpm typecheck` | TypeScript 类型检查（shared + server + web） |
| `pnpm test` | 服务端单元测试（217 条，含 doctor / webhook / MIME / 水位） |
| `pnpm test:web` | 前端单元测试（73 条） |
| `pnpm run doctor` | 只读自检：环境 + 模式 + 逐平台探针 + 出口公网 IP + 中文修复建议；有 FAIL 时退出码 1 |
| `pnpm run doctor -- --platform=feishu,mail` | 只检查指定平台 |
| `pnpm run doctor -- --help` | 查看 doctor 全部参数与退出码 |
| `pnpm --filter @unimsg/server run --silent doctor -- --json` | 机器可读 JSON（stdout 严格合法 JSON；`--silent` 避免 pnpm banner 混入） |
| `pnpm e2e` | 一键端到端冒烟（Windows PowerShell） |
| `pnpm e2e:sh` | 一键端到端冒烟（macOS / Linux / Git Bash） |
| `pnpm run deliver` | 交付打包：`git archive` 生成 zip，自动排除 `.env*` / 日志 / 状态文件 / `node_modules`（工作区不干净会拒绝） |
| `pnpm --filter @unimsg/web dev` | 前端开发模式（:5173，不配 `.env` 时为 Mock 数据） |
| `pnpm --filter @unimsg/web build` | 前端生产构建 |
| `node packages/web/scripts/verify-contract.mjs http://127.0.0.1:3001 dev-token` | 前后端契约自检（后端已启动；当前 **46 PASS / 0 FAIL**） |

`e2e` / `e2e:sh` 都可直接追加端口参数，例如 `pnpm e2e -Port 3102`、`pnpm e2e:sh 3102`。

要连真实钉钉收发（Stream 模式，无需公网）：

```bash
DINGTALK_STREAM=true DINGTALK_MODE=auto pnpm --filter @unimsg/server start
```

> Windows PowerShell 请先 `$env:DINGTALK_STREAM="true"` 再启动，或直接写进 `.env`（推荐）。

## 设计文档

- [documents/赛题A_多平台连接器_初赛设计文档_精简版.docx](documents/赛题A_多平台连接器_初赛设计文档_精简版.docx)（初赛，≤10 页）
- [documents/赛题A_多平台连接器_竞赛执行文档_v3.docx](documents/赛题A_多平台连接器_竞赛执行文档_v3.docx)（决赛完整版，≤15 页）

## License

见 [LICENSE](LICENSE)。
