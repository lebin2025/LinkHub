# LinkHub 交付 / 打包 checklist

> 原则：**交付包 = `git archive` 白名单产物**——只含 git 已跟踪文件；凭据、日志、本机状态文件、`node_modules` 一律不进包。打包后必须解压再自检一遍。
> 相关文档：[quickstart.md](quickstart.md) · [demo-script.md](demo-script.md) · [swap-accounts.md](swap-accounts.md) · [risk-register.md](risk-register.md) · [README.md](../README.md)

## 0. 一句话流程（在 `unimsg-connector/` 下）

```bash
git status                  # 必须干净：所有改动先 commit（含新增的 docs/、scripts/deliver.mjs）
pnpm run deliver            # 生成 LinkHub-deliver-<时间>.zip 到仓库上一级目录
pnpm run deliver -- --out D:\deliver\LinkHub.zip   # 可选：自定义输出路径（--allow-dirty 仅本地试打包）
```

`scripts/deliver.mjs` 会做三道检查，任一不过直接拒绝打包：
① 工作区不干净（`git status` 有输出）→ 拒绝（`--allow-dirty` 例外，但未提交改动不会进包）；
② 已跟踪文件命中黑名单（`.env` / `.env.*` / `*.log` / `*.log.err` / `.mail-watermarks.json` / `node_modules/` / `*.zip`；`.env.example`、`.env.sample` 除外）→ 拒绝；
③ 打包用 `git archive --format=zip HEAD`，从根上排除一切未跟踪文件。

## 1. 打包前 checklist

- [ ] **所有改动已 commit**：`git status --porcelain` 无输出；新增文件（`scripts/deliver.mjs`、`docs/*.md`、`.github/` 等）都已 `git add` 并提交
- [ ] **交付包不得含**：`unimsg-connector/.env`、`.env.bak*`、`packages/web/.env`、`*.log` / `*.log.err`、`.mail-watermarks.json`（邮箱 UID 水位）、`node_modules/`、`dist/`、本地 zip
- [ ] **凭据检查**（结果应只看到 `.env.example`；`packages/web/.env` 也不应出现）：
  ```bash
  # Git Bash / macOS / Linux
  git ls-files | grep -Ei '(^|/)\.env|\.log|mail-watermarks|node_modules|^dist/'
  # Windows PowerShell
  git ls-files | Select-String -Pattern '(^|/)\.env|\.log|mail-watermarks|node_modules|^dist/'
  ```
- [ ] **纯前端 Mock 最短路径**：确认交付包/演示目录里没有 `packages/web/.env`（它有 `VITE_API_BASE` 会让“只起前端”变成连后端，页面报「数据加载异常」）；交付包由 `git archive` 生成，天然不含该文件
- [ ] 跑一次 `pnpm run deliver`，记下输出里的 **commit hash** 与 **zip 路径**，确认 `[deliver] ✔ 打包完成`
- [ ] **抽检交付 zip**：解压一份，确认里面只有 `.env.example`，没有 `.env` / `.env.bak*` / 日志 / `.mail-watermarks.json` / `node_modules/`
- [ ] 用 `git archive` 的 zip，**不要右键压缩整个目录**（会带上 `.env.bak`、日志、`node_modules`）

## 2. 交付前全量自检（最后一遍）

```bash
cd unimsg-connector
pnpm typecheck        # shared / server / web 全部 Done
pnpm test             # 服务端单测全部通过（条数以实际输出为准）
pnpm test:web         # 前端单测全部通过（条数以实际输出为准）
pnpm e2e              # 20 项 PASS + SMOKE OK；macOS / Linux / Git Bash 用 pnpm e2e:sh
pnpm run doctor       # 全 PASS 最好；飞书 21001 是已知外部限制（退出码 1），交付说明里写明
```

契约自检（必须用 **Mock 后端**，否则回复会走真实通道导致断言失败）：

```bash
# 终端 1：Git Bash / macOS / Linux
FEISHU_MODE=mock DINGTALK_MODE=mock WECOM_MODE=mock MAIL_MODE=mock DINGTALK_STREAM=false MAIL_ENABLED=false pnpm --filter @unimsg/server start
# Windows PowerShell 先逐行执行：$env:FEISHU_MODE="mock"; $env:DINGTALK_MODE="mock"; $env:WECOM_MODE="mock"; $env:MAIL_MODE="mock"; $env:DINGTALK_STREAM="false"; $env:MAIL_ENABLED="false"
# 终端 2
node packages/web/scripts/verify-contract.mjs http://127.0.0.1:3001 dev-token   # 期望 `<N> PASS / 0 FAIL`（当前 46 项，以实际输出为准）
```

## 3. 解压后自检（收包人视角，附进交付说明）

```bash
# 解压 LinkHub-deliver-xxxx.zip 后
cd unimsg-connector
corepack pnpm install --frozen-lockfile    # 有 pnpm>=9 可直接 pnpm install --frozen-lockfile
pnpm typecheck
pnpm e2e                                   # Windows；macOS / Linux / Git Bash：pnpm e2e:sh
```

期望：`e2e` 20 项 PASS + `SMOKE OK`（`e2e` 需要 Python 3；没有 Python 时先装，或至少 `pnpm typecheck` 通过）。说明：包内没有 `.env`，四个平台会 `auto → Mock`（正常）；要通过界面看效果按 [quickstart.md](quickstart.md) 路径 A，要接真实账号按路径 B。

## 4. 演示前检查（若交付后要现场演示）

- [ ] 端口 3001 / 5173 空闲（Windows：`netstat -ano | findstr :3001`；macOS / Linux：`lsof -i :3001`）
- [ ] 网络 / 代理正常；如演示企微真实发送，先确认当前出口 IP 仍在「企业可信 IP」内（`pnpm run doctor` 会打印出口 IP）
- [ ] `API_TOKEN`：演示保持 `dev-token`；**不要留空**（空值会回退默认 `dev-token` 并告警、**仍强制鉴权**，不会关闭鉴权）；对外暴露必须改成强随机值，`NODE_ENV=production` 且仍为默认/空 token 会拒绝启动
- [ ] 浏览器无痕窗口 / 清缓存；投屏前关闭 `.env` 终端窗口（启动日志里的邮箱地址已脱敏，但仍不建议整屏投屏）
- [ ] 完整分镜与纯 Mock 兜底见 [demo-script.md](demo-script.md)

## 5. 交接信息模板（复制到交付说明）

| 项 | 填什么 |
|---|---|
| 版本 | commit `<git log -1 --format="%H">`（或 tag） |
| 运行环境 | Node `<node -v>`、pnpm `<pnpm -v>`（package.json 固定 pnpm 9.15.9，可用 corepack） |
| 真实可用 | 钉钉 Stream 收 + 机器人回写；邮箱 IMAP 收 + SMTP 发（多账号 / STARTTLS） |
| 受限能力 | 飞书 `21001`（需企业认证/合规租户）；企微 `60020`（需企业可信 IP + 回调 Token/AESKey + 公网） |
| 未实现 | PostgreSQL/Redis 持久化、LLM/OCR 真实调用、Docker Compose（详见 README「承诺 vs 实现」） |
| 文档索引 | quickstart / demo-script / swap-accounts / risk-register / README |
| 已知风险 | 全部见 [risk-register.md](risk-register.md) |
