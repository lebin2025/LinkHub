# LinkHub 5 分钟快速上手

> 目标：**不配任何平台账号，也能看到完整闭环**；以后换成自己的账号只改 `.env`，不改代码。
> 从交付包根目录开始，先 `cd unimsg-connector`；下文命令都在该目录下执行（仓库根目录没有 `package.json`，在根目录跑 `pnpm` 会报错）。
> README 顶部也有同样的一张「30 秒选路径」表，两边内容一致。

## 先判断你属于哪类人

| 你想做什么 | 走哪条路 | 预计耗时 |
|---|---|---|
| **只想看效果**（零账号、零平台配置） | [路径 A：零账号演示](#path-a) | 约 5 分钟 |
| **要换成自己的账号**（飞书 / 钉钉 / 企微 / 邮箱任选一个即可） | [路径 B：换账号](#path-b) | 约 10 分钟 |
| **要现场演示 / 交付给评审 / 部署** | [路径 C：演示与交付](#path-c) | 按场景 5–30 分钟 |

## 30 秒前置检查

```bash
node -v            # 需要 v20 及以上
pnpm -v            # 需要 9.x；没有 pnpm：在 unimsg-connector/ 下执行 corepack pnpm install
python --version   # 仅跑 e2e 需要 Python 3（没有也不影响起服务）
```

- **装不上 pnpm**：先试 `corepack pnpm install`（Node 自带，无需全局安装）；仍不行再 `npm i -g pnpm@9`。
- **`pnpm install` 很慢（可选）**：`pnpm config set registry https://registry.npmmirror.com` 换国内镜像；公司有私有源则按团队规范配置。
- 项目当前在中文路径下也可正常运行；若个别工具报奇怪的路径错误，把项目移到纯英文路径（如 `C:\dev\LinkHub`）再试。

<a id="path-a"></a>
## 路径 A：零账号 5 分钟看效果

```bash
cd unimsg-connector
corepack pnpm install        # 已有 pnpm>=9 时可直接 pnpm install；约 1–3 分钟，看网络
pnpm typecheck               # 约 10 秒
pnpm e2e                     # 约 10–20 秒；macOS / Linux / Git Bash 改用：pnpm e2e:sh
pnpm --filter @unimsg/server start   # 约 2 秒；保持这个终端不关
# 另开一个终端（同样先 cd unimsg-connector）：
pnpm --filter @unimsg/web dev        # 约 2 秒；浏览器打开 http://127.0.0.1:5173
```

| 步骤 | 成功信号 | 预计耗时 |
|---|---|---|
| `pnpm install` | 出现 `Done`，没有 `ERR_` / `ELIFECYCLE` | 1–3 分钟 |
| `pnpm typecheck` | `shared` / `server` / `web` 三行 `Done` | 约 10 秒 |
| `pnpm e2e` | 20 条 `PASS` + `SMOKE OK` + `[e2e] PASS` | 约 10–20 秒 |
| 起后端 | `server listening ... :3001` + `运行模式: ...=mock(auto)`（无 `.env` 时全部 Mock） | 约 2 秒 |
| 起前端 | 5173 页面打开，左下角「前端演示模式 · 未接后端」，收件箱有内置演示消息 | 约 2 秒 |

> **两种「看效果」方式别混用**：不配 `VITE_API_BASE` 时前端用内置 Mock 数据；一旦存在 `packages/web/.env` 且写了 `VITE_API_BASE`，前端就会去连后端。
> 如果页面出现「数据加载异常」，多半是目录里带着别人的 `packages/web/.env`：先改名/删除它再重启前端（交付包默认不带这个文件）。

### 想把界面接到刚起的后端，看更真实的闭环

```bash
# 终端 1（若未启动）
pnpm --filter @unimsg/server start
# 终端 2：写两行前端配置后重启 Vite
printf 'VITE_API_BASE=http://127.0.0.1:3001\nVITE_API_TOKEN=dev-token\n' > packages/web/.env
# Windows PowerShell 写法： "VITE_API_BASE=http://127.0.0.1:3001`nVITE_API_TOKEN=dev-token" | Set-Content packages/web/.env
pnpm --filter @unimsg/web dev
```

成功信号：左下角变为「已接入 LinkHub Server」；账号页 4 张卡显示 `Mock 模拟`；回复后的「投递方式」显示 `模拟发送（未调用真实平台）`。
新后端收件箱为空是正常的，可灌入演示消息：`python scripts/smoke.py http://127.0.0.1:3001`（要求后端是全新无 `.env` 的 Mock 状态）。

> 如果你拿到的是**带 `.env` 的工作区**（别人配过真实账号），后端启动后会按 `.env` 走真实/受限通道，不再是全 Mock；想纯 Mock 演示，启动前临时设置 `FEISHU_MODE=mock` 等四个环境变量（见 [demo-script.md](demo-script.md) 的纯 Mock 兜底路线），或直接用全新解压的交付包。

停止：两个终端分别 `Ctrl + C`。

<a id="path-b"></a>
## 路径 B：换成自己的账号（约 10 分钟）

```bash
cd unimsg-connector
cp .env.example .env                 # Windows PowerShell：Copy-Item .env.example .env
# 2) 只填“目标平台”那一段，其他平台留空 = auto 自动 Mock：
#    飞书：FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_VERIFY_TOKEN
#    钉钉：DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET / DINGTALK_ROBOT_CODE / DINGTALK_STREAM=true
#    企微：WECOM_CORP_ID / WECOM_AGENT_ID / WECOM_SECRET（要收消息再加 WECOM_TOKEN / WECOM_AES_KEY）
#    邮箱：MAIL_QQ_ADDRESS / MAIL_QQ_AUTH_CODE（授权码，不是登录密码；可配多个账号）
# 3) 先自检，再重启后端
pnpm run doctor
pnpm --filter @unimsg/server start
```

> ⚠️ 必须写 **`pnpm run doctor`**，不要写 `pnpm doctor`：pnpm 9 自带同名内置命令会抢走它（变成诊断 pnpm 自身）。
> 只想看某一平台：`pnpm run doctor -- --platform=dingtalk,mail`。

> `API_TOKEN` 不要留空：演示保持默认 `dev-token`，对外部署必须改成强随机值。**留空会回退 dev-token 并打印告警，仍强制 Bearer 鉴权**（不会出现"空令牌 = 不鉴权"）；`NODE_ENV=production` 且仍是默认/空令牌时服务会拒绝启动。

**成功信号（三处任看其一即可）**：

1. `doctor` 输出 `[PASS]`，结论 `✔ 自检通过：PASS x / FAIL 0`；正常退出码 **0**（0 = 全 PASS/SKIP，1 = 有 FAIL，2 = 参数错，3 = 自检异常）。若终端退出码和报告结论对不上，重跑一次即可（历史版本在 Windows + Node 24 下有过强制退出导致异常码的问题，已修复）。
2. 后端启动日志出现 `运行模式: ...=real(auto) 收✓ 发✓`。
3. `curl http://127.0.0.1:3001/api/health` 的 `modes` 中该平台为 `real`；`curl -H "Authorization: Bearer dev-token" http://127.0.0.1:3001/api/accounts` 中该平台 `mode=real`。

两个平台的外部限制要提前知道：飞书可能报 `21001`（需企业认证 / 合规租户）、企微可能报 `60020`（出口 IP 要加入「企业可信 IP」）。doctor 会给中文修复建议；逐平台步骤见 [swap-accounts.md](swap-accounts.md)。
改完 `.env` 必须**重启后端**；改了前端 `.env` 必须**重启 Vite**。

<a id="path-c"></a>
## 路径 C：现场演示 / 交付评审 / 部署

- 现场演示 → [demo-script.md](demo-script.md)（含演示前 10 分钟检查清单与纯 Mock 兜底）
- 打包交付 → [delivery-checklist.md](delivery-checklist.md)（`pnpm run deliver` + 交付前后自检）
- 完整真实接入（后台点什么、填哪些变量、常见报错）→ [swap-accounts.md](swap-accounts.md)
- 承诺 vs 实现、已知边界与风险 → [README.md](../README.md) 的「设计文档承诺 vs 当前实现」与 [risk-register.md](risk-register.md)

部署三条底线：飞书/企微回调需要公网可达；企微发信出口 IP 必须在「企业可信 IP」；生产必须改强随机 `API_TOKEN`（`NODE_ENV=production` 且仍是默认 `dev-token` 会拒绝启动；也**不要**把它留空，空值会关闭鉴权）。

## 常见卡点一张表

| 现象 | 原因 | 一句话解决 |
|---|---|---|
| `pnpm: command not found` | 没装 pnpm | 在 `unimsg-connector/` 下执行 `corepack pnpm install`；或 `corepack enable` 后重开终端 |
| 报 Node 版本 / `tsx` 不兼容 | Node < 20 | 装 Node 20 或 22 LTS，重开终端再试 |
| `启动失败：端口 3001 已被占用` | 上次进程没关 / 别的软件占用 | 改 `.env` 的 `SERVER_PORT=3101` 并把前端 `VITE_API_BASE` 同步到 3101；或按提示 `netstat -ano | findstr :3001` + `taskkill`（macOS/Linux 用 `lsof -i :3001` + `kill`）；e2e 用 `pnpm e2e -Port 3102` |
| 配了账号，页面却全是 Mock | `.env` 放错目录（必须在 `unimsg-connector/.env`，仓库根的不加载）或变量名拼错（如 `FEISHU_APPID`） | 照 `.env.example` 检查拼写；`pnpm run doctor` 会提示「疑似拼错的变量」；改完重启后端 |
| `doctor` 里全是 SKIP | 当前是 Mock 状态，doctor 按约定不跑真实探针 | 不是失败；填好凭据会自动变 `real`，或显式设 `*_MODE=real` 强制自检 |
| 接口 401 / 页面提示未授权 | 前端 `VITE_API_TOKEN` 与后端 `API_TOKEN` 不一致 | 两处改成同一个值（默认 `dev-token`），重启后端与 Vite |
| 前端显示「数据加载异常」 | 后端没起、地址/端口不对、或 `packages/web/.env` 指向旧地址 | 先 `curl http://127.0.0.1:3001/api/health` 确认后端；核对 `VITE_API_BASE`；改完重启 Vite |
| 页面提示 403「Origin 不在 CORS 白名单」 | `.env` 配了 `CORS_ORIGINS` 但没含前端地址 | 把 `http://127.0.0.1:5173` 加进 `CORS_ORIGINS`，或清空该变量 |
| `e2e` 提示找不到 Python | e2e 冒烟脚本需要 Python 3 | 安装 Python 3 并确保 `python` / `python3` 在 PATH（Windows 安装时勾选 Add to PATH）；不跑 e2e 不影响起服务 |
| 中文路径下个别命令报错 | 少数工具链对非 ASCII 路径兼容差 | 把项目移到纯英文路径（如 `C:\dev\LinkHub`）后重试 |
| `doctor` / 接口连接超时 | 公司代理、VPN、防火墙拦截 | 临时关代理或换手机热点重试；`pnpm install` 慢可换 registry 镜像（见上） |

## 下一步看什么

- 换真实账号 / 排错：[swap-accounts.md](swap-accounts.md)
- 现场演示讲稿：[demo-script.md](demo-script.md)
- 交付打包：[delivery-checklist.md](delivery-checklist.md)
- 全量风险与边界：[risk-register.md](risk-register.md)
