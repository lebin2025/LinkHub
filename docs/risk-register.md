# LinkHub 用户风险台账（需求经理 / 风险分析）

> 文档版本：v1.0（2026-11-04）｜分析对象：git HEAD `be9321b` + 工作区未跟踪文件｜产出人：requirements-manager
> 定位：回答用户原话「根据项目文档需求发散思考，想一下还会出现什么情况，尽量避免用户使用的时候出问题」，并把重点收敛到 **新用户快速上手 / 学习成本**。
> 声明：本轮为**只读静态分析**（未启动服务、未运行 `e2e`/`doctor`、未修改任何代码/README/.env、未 commit/push）。文中不转述任何凭据值，邮箱/手机号一律脱敏；真实平台状态（飞书 21001、企微 60020）引自 README 实测记录。
>
> **配套文档**：[quickstart.md](quickstart.md)（5 分钟上手）｜[demo-script.md](demo-script.md)（现场演示脚本）｜[delivery-checklist.md](delivery-checklist.md)（交付/打包 checklist）｜[swap-accounts.md](swap-accounts.md)（换账号指南）
>
> **v1.1 收尾说明（Lead 补注）**：§7.3 中标 🧪 的修复已在收尾轮合并并验收（`pnpm typecheck` / server 测试 / web 测试 / `pnpm e2e` / 契约自检全绿，数字见 README「测试与验证」）；本台账保留原文用于复盘，状态以 README 与代码为准。R-02（`packages/web/.env` 与页脚状态）、R-19（日志脱敏）、R-24（UIDVALIDITY）均已有对应修复。

---

## 0. 结论速览（TL;DR）

1. **最大的上手风险不是"功能没做完"，而是"新用户按文档走，不一定能顺利看到效果"**：交付目录里带着真实凭据 `.env`、带 `packages/web/.env`（会让「纯前端 Mock 演示」这条最短路径失效）、端口占用/空数据/失败原因都没有"下一步"提示。
2. **真实链路可用面只有钉钉（Stream）+ 邮箱（IMAP/SMTP）**；飞书卡租户策略 `21001`、企微卡可信 IP `60020` 且缺回调 Token/AES。设计文档 7.2 的演示脚本第②③④⑤步依赖飞书/企微真实收发，**照文档演示会在第 2 步卡住**。
3. **数据正确性有两个"用户真的会踩"的坑**：邮箱带附件/嵌套 multipart 邮件正文整段丢失；IMAP 单轮最多 20 封且水位只存内存 → 重启或突发邮件会漏信。两者都在真实可用链路上，不是 Mock 演示问题。
4. **5 分钟上手的最大摩擦是信息结构**：README 共 466 行，快速开始在第 213 行、有 3 种相互排斥的启动方式；且当前工作区的 `packages/web/.env` 会让"只启动前端看 Mock"变成"连不上后端"的报错页。
5. 计数：**P0 7 条 / P1 14 条 / P2 8 条 / P3 2 条，共 31 条**；写作期间已有 **10 条**在工作区看到代码改动（🧪，见 §7.3 快照，均未验收）；R-24（UIDVALIDITY）与已派的水位持久化相邻，建议一并处理。

**本轮修复状态图例**：🧪 已落代码待验收（写作期间已见工作区改动）｜🔧 本轮修复中（已被派工）｜📄 文档兜底（Lead 在写）｜⏳ 待排期｜✅ 接受并说明。

---

## 1. 分析范围与方法

### 1.1 输入材料（全部实际读过）

| 类别 | 材料 | 说明 |
|---|---|---|
| 赛题文档 | `documents/赛题A_多平台连接器_初赛设计文档_精简版.docx`（85 段+9 表）、`documents/赛题A_多平台连接器_竞赛执行文档_v3.docx`（148 段+10 表） | 用 python-docx 提取正文与表格，提炼"文档承诺 / 评分关注点" |
| 项目文档 | 根 `README.md`（466 行）、`docs/swap-accounts.md`（换账号指南）、`unimsg-connector/.env.example`、`packages/web/README.md` | 承诺、已知限制、配置权威来源 |
| 代码 | `packages/server/src/**`（config、runtime、connectors、doctor、services、routes、stream、core、db、ws）、`packages/web/src/**`（页面/错误态/WS/store）、`packages/shared/src/message.ts`、`scripts/{e2e.ps1,e2e.sh,smoke.py}` | 逐条对照"承诺 vs 实现" |
| 交付面 | 工作区未跟踪文件（`.env`、`.env.bak-2026-11-03`、`scripts/e2e-server.log`、`packages/web/.env`、`test.photos/*.png`、`node_modules/`）、`.gitignore`、`git ls-files`、git 历史 | 打包/交付泄露面 |
| 实测记录 | README「测试与验证」「已知限制」、`test.photos/` 截图 | 无新实测；只引用已有记录 |

### 1.2 方法

1. **文档承诺 → 实现核对**：把两份 docx 的部署/闭环/安全/AI/演示承诺逐条映射到代码与 README，找出"评审会按文档验证、但当前交付不成立"的缺口（§2）。
2. **用户旅程走查**：以"第一次接触项目的人"视角走 6 条真实路径，记录每一步会看到什么、在哪一步需要查文档（§3）。
3. **上手成本量化**：四类用户（评审 / 换号同学 / 接手开发 / 对照文档验收）分别数步骤、估耗时、标摩擦与学习成本（§4）。
4. **代码定位**：每条风险给出 `文件:行` 证据、根因与可执行建议，并区分「代码修复 / 文档兜底 / 接受并说明」（§5）。

**分级标准**：P0 = 评审/同学会直接卡住、数据错误或凭据泄露；P1 = 很容易踩、体验差、需查文档才能继续；P2 = 边缘场景或有替代路径；P3 = 可接受/仅体验瑕疵。

**局限**：未运行服务与耗时命令，未使用真实平台现场复现；真实平台行为以 README 2026-11-03/04 实测记录为准。**写作期间 Lead 已并行派工修复，工作区出现大量未提交改动（见 §7.3 快照），因此文中 `文件:行` 以 git HEAD `be9321b` 为基线**；若最新代码行号偏移，按同名函数搜即可，条目状态以 §7.3 快照为准。**建议 Lead 收尾前按 §7 的单条只读命令抽查，不需要跑全量 e2e。**

---

## 2. 文档承诺 vs 实现缺口（评审验收视角，A/F）

| # | 文档承诺（出处） | 当前实现 | 证据 | 评审/用户会看到 | 建议 |
|---|---|---|---|---|---|
| G1 | Docker Compose 拉起 4 服务（postgres/redis/server/web），纯净服务器零依赖启动（执行文档 §5.1–5.3、交付物） | **仓库没有任何 Dockerfile / docker-compose.yml**；本机只能 `pnpm` 启动，依赖 Node/pnpm/网络安装 | 全仓库 grep `docker compose` 0 命中；README 全文无 Docker 章节 | 按文档找 compose 文件 → 找不到；"独立部署 7/20 分"无法演示 | 📄 补 README「承诺-实现对照表」；是否补最小 compose 骨架由 Lead 定（M/L） |
| G2 | PostgreSQL + Redis 持久化/缓存/限流（§2.6、§5.1） | 仅内存实现；`DATABASE_URL` 只影响启动日志一行 | `db/repository.ts:30-83`、`index.ts:58`、README:146 | 重启即清空，与"持久化"承诺不符 | ✅ 接受并说明（README 已写）；对照表标注 |
| G3 | 三平台（飞书/钉钉/企微）真实收发、稳定运行 +3 分（§6.3、§7.2） | 真实可用：钉钉 Stream、邮箱；飞书 `21001`（租户策略）+ `im:message` 权限未开；企微缺回调凭据且 `60020` | README:143、398-400；`connectors/feishu.ts:105`、`wecom.ts:188` | 按演示脚本第②③④⑤步操作 → 发不出/收不到 | 📄 演示脚本 v2：钉钉+邮箱真实、飞书/企微明确 Mock + 替代路径（M） |
| G4 | 大模型意图识别/摘要/草稿，抽样 ≥30 条准确率 ≥85%（§6.1、初赛 §6.2） | 关键词规则 Mock；无抽样集、无准确率证据 | `services/llm.ts`、README:145 | 提问"AI 在哪/准确率"时只能答规则 | 📄 文档如实降级说明 + 演示时标注「规则 Mock」 |
| G5 | OCR（腾讯云）图片/文件文字提取 | 规则 Mock，未调用任何 OCR | `services/ocr.ts`、README:145 | 图片消息 OCR 结果为占位/待确认 | 📄 同 G4 |
| G6 | CORS 白名单、后端仅内网（执行文档 §2.5） | 默认仍是 `cors()` 全放行、`listen(port)` 绑定所有网卡、默认 token；本轮新增 `CORS_ORIGINS` 白名单（不填仍 `*`）与 `SERVER_HOST` | HEAD `app.ts:14`、`index.ts:57`、`config.ts:85`；工作区已改（§7.3） | 同网段任何人可读取/回复消息（演示 Wi-Fi 场景） | 🧪 已落代码（白名单/告警/生产闸门）；空 token 仍会关鉴权，见 R-10 |
| G7 | 日志对 sender.id、body 脱敏；单行 JSON 日志（§2.5、§5.4） | 单行 JSON 闭环日志已实现且不含正文（`core/loop-log.ts`）；但启动日志打印**完整邮箱地址**、`mock-send` 打印正文 JSON | `index.ts:52`、`connectors/base.ts:29`、`core/loop-log.ts` | 截图/日志给评审即泄露邮箱与内容 | ⏳ 见 R-19（S） |
| G8 | 状态回流：平台回执/对方回复/平台标记完成经 Webhook 回流（§1.3、§2.3） | 无任何真实平台事件→status 的映射；`sent→synced` 是本地自动推进；`syncStatus` 接受任意状态（可倒退） | `services/message.ts:157-164/185-193`、`services/sync.ts:9-18` | "已同步"绿色标签≠对方收到；评审问回流证据时只有自造事件 | 🔧 已派"状态回流防倒退"；文案/证据另见 R-11 |
| G9 | 平台事件 `event_id` 二次去重、同一 traceId 状态串行（§4.3） | 未实现事件级去重；无状态迁移校验 | `services/message.ts:47-52` | 并发/重推下状态可能回退或漏记 | ⏳ 随 R-11/R-06 一并 |
| G10 | 初步验证证据：三平台连通性截图、样例事件单测、Mock 录屏、意图抽样（执行文档 §1.4） | 仓库仅 `test.photos/` 两张 **2026-11-02 旧版** smoke 截图（路径 `C:\LinkHub`，旧日志格式），无三平台连通/意图抽样证据 | `test.photos/test (1).png`、`test (2).png` | 初赛要求的证据链不齐，截图与当前版本不一致 | 📄 更新证据或明确注明"历史截图"；见 R-21 |

---

## 3. 用户旅程走查（A 迁移）

### 3.1 评审零账号 5 分钟演示

| 步骤 | 会做什么 | 可能卡点 | 级别 |
|---|---|---|---|
| 1 | 打开交付目录，找入口 | README 466 行，「快速开始」在第 213 行；仓库根**没有 package.json**，在根目录执行 `pnpm install` 直接报 `No package.json` | P1（R-16） |
| 2 | 选启动方式 | 3 种方式（纯前端 Mock / 前后端联调 / e2e）需先读懂差异；**当前工作区 `packages/web/.env` 存在 → 纯前端 Mock 方式实际会连 3001 并报"无法连接后端"** | **P0（R-02）** |
| 3 | 装依赖/起服务 | 有 `node_modules` 可直接起；干净环境需 corepack/pnpm 联网安装（1–3 分钟） | P2（R-15） |
| 4 | 起后端 | 3001 被上次演示进程占用 → 直接抛英文 `EADDRINUSE` 栈 | **P0（R-05，🧪）** |
| 5 | 打开页面 | 新后端 0 条消息 → 空态只写"没有匹配的消息 / 清空筛选"，**没有"怎么灌一条消息"的指引** | P1（R-28） |
| 6 | 看"真实/模拟"标识 | 左下角"真实后端 · 已接入 LinkHub Server"只按数据源类型判断、**不按连接状态**，断线时仍显示"已接入" | P1（R-02/R-13） |
| 7 | 演示回复闭环 | Mock 回复标注「模拟发送（未调用真实平台）」——这点做得对，可放心讲 | ✅ |

### 3.2 同学换成自己的账号

| 步骤 | 会做什么 | 可能卡点 | 级别 |
|---|---|---|---|
| 1 | 找配置入口 | README:259「复制 unimsg-connector/.env.example 为 unimsg-connector/.env」，但同句又说"服务会自动从 monorepo 根目录加载"；放到仓库根 `LinkHub-test/.env` 不会被加载（服务 cwd 是 packages/server） | P1（R-09） |
| 2 | 填凭据 | 变量名拼错（如 `FEISHU_APP_IDD`）→ **静默回退 Mock**，无任何报错；doctor 也不点名拼错的变量 | P1（R-09） |
| 3 | 自检 | `pnpm run doctor` 输出质量较好（PASS/FAIL/中文建议/出口 IP），但结论段没有"疑似拼写错误""找到但未加载的 .env" | P1（R-09/R-25） |
| 4 | 起服务 | 换 `.env` 后必须重启；`.env` 的加载优先级不透明（`import 'dotenv/config'` 会先读 cwd，可能被 `packages/server/.env` 覆盖） | P2（R-25） |
| 5 | 前端联调 | 前端自己的 `packages/web/.env` 里 `VITE_API_TOKEN` 必须与后端 `API_TOKEN` 一致；**若按 README 把后端 token 改成生产值，前端会 401，且 `pnpm e2e` 必挂** | P1（R-08） |
| 6 | 真实收发 | 飞书 21001 / 企微 60020 需要"企业认证 / 可信 IP / 公网回调"，同学环境大概率无法满足；失败原因只在 trace 页可见 | P1（R-17/R-20） |
| 7 | 换邮箱 | 授权码、IMAP/SMTP 开启步骤文档很完整；但附件邮件正文会丢、IMAP 中文目录会失败 | **P0（R-04/R-07，🧪）** |

### 3.3 只配部分平台 / 多账号

- 只配钉钉（Stream）或只配邮箱：`auto` 回退逻辑正确，未配平台自动 Mock，`/api/accounts` 能看到 `mode/missing/reason`。✅
- **半可用歧义**：`auto` 只要"能收或能发"就判 `real`（`config/runtime.ts:561-568`）。例如只填 `FEISHU_VERIFY_TOKEN` → 收真实、发 Mock；企微只填 CorpId/Secret/AgentId → 发"真实"但必报 60020。账号页虽有 warnings，普通用户仍容易把「真实接口」理解成"都配好了"（P1，R-20）。
- **重复/多账号**：同一邮箱用两个 key 配置（或 `INBOX,inbox` 大小写不同）会产生两套 `externalId` → 同一封邮件重复入库（P2，R-22）。
- **MAIL_ACCOUNTS 显式列表写错 key**（如 `my_school` 对应应为 `MAIL_MYSCHOOL_*`）只报 warn 级 issue，账号被静默跳过（`config/runtime.ts:247-354`，P2/R-22）。

### 3.4 真实收发中网络抖动 / 断网

- 发送路径有令牌桶 + 3 次指数退避（1/2/4s，`services/rateLimiter.ts:24-39`），耗尽写 DLQ、状态 `failed`。✅
- **断网时前端不会自己恢复**：WS 最多重连 8 次（约 45s）后进入 `offline` 且不再重连、无"重试"按钮（`wsRealtime.ts:119-131`）；REST 也不轮询 → 后端恢复后必须手动刷新页面（P1，R-13）。
- 钉钉 Stream 建连失败只在启动时 `console.error` 一次（`index.ts:66-68`），换网/断线后界面无任何"长连接已断开"信号；`/api/accounts` 的 `canReceive` 仍为 true（P2，R-26）。
- **演示网络变化**：出口公网 IP 变化会直接导致企微 60020（README:383 已说明，doctor 每次打印出口 IP —— 这是好设计，文档层已兜底）。

### 3.5 电脑重启 / 换网 / 开代理

- 重启：内存存储清空（消息/闭环日志/DLQ 全丢）；邮箱 UID 水位在内存，重启后重新立基线，**停机期间到达的邮件被跳过**（README:418 已声明但用户未必读；P1，R-07/R-18）。
- 换网/开代理：本服务不读 `HTTP(S)_PROXY`，fetch/IMAP/SMTP 全直连；公司代理+SSL 拦截环境真实模式会整体失败（doctor 的报错建议覆盖了代理文案，但服务本身不代理）。P2，R-26。
- 时钟偏差：钉钉验签容忍 1 小时窗口（`connectors/dingtalk.ts:76`），企业微信 3600s（`wecom.ts:27/115`）；系统时间偏差大 → 回调统一 401，且错误信息只有 `verify failed`。P2，R-26。

### 3.6 中文 / emoji / 超长正文 / 附件

- 中文与 emoji：JSON/UTF-8 链路正常；邮件正文 base64 + UTF-8 正常；已实测中文主题/正文无损（README:396）。✅
- **超长**：前端限 2000 字符（`ReplyComposer.tsx:31`），后端无平台级限制校验；企微 `text.content` 上限约 2048 **字节**（约 680 汉字）、钉钉/飞书限制各不相同 → 真实发送失败，用户只看到"回写失败"（P1，R-14）。
- **附件**：带附件邮件在常见 `multipart/mixed > multipart/alternative + attachment` 结构下，正文会整段丢失、只剩 `[附件] 文件名`（P0，R-04，🔧）。图片/文件消息本身没有缩略图/附件下载入口，详情页只显示文字（P3，R-30）。

---

## 4. 新用户上手路径与学习成本（Lead 指定的分析主线）

### 4.1 四类用户对照

| 用户 | 关键步骤（理想） | 无摩擦耗时 | 当前现实耗时 | 主要卡点 | 摩擦级别 | 学习成本 | 建议（文档/产品） |
|---|---|---|---|---|---|---|---|
| **评审/评委**（零账号，5 分钟看演示） | 打开 README → 选纯前端 Mock → 起服务 → 浏览收件箱 → 演示一次回复闭环 | 3–5 min（已有 node_modules）；纯净环境 +2–3 min 装依赖 | **8–15 min** | 快速开始在第 213 行；3 种启动方式要选；`web/.env` 破坏纯前端 Mock；空态无"下一步"；端口占用栈 | **高** | 读文档 3–5 + 排错 5–10 | 📄 README 顶部「3 分钟零账号跑起来」+ 成功信号；📄 删/改 `web/.env`；🔧 前端首启引导 |
| **同学/接手人**（换成自己的账号） | 复制 `.env` → 填一段 → `doctor` → 重启 → `/api/accounts` 看 mode | 5–8 min（不含平台后台取凭据 10–30 min） | **15–30 min** | .env 放错位置/拼错变量静默 Mock；前端 token 双写；真实平台 21001/60020；失败原因不显眼 | **中高** | 5–8 + 排错 10–20 | 📄 一页"换号 checklist + 错误表"；🔧 doctor 加拼写/加载校验；⏳ 失败原因可见 |
| **队友接手开发** | clone → `cd unimsg-connector` → install → typecheck → test → e2e | 5–10 min（e2e 需 Python/PowerShell） | **6–15 min** | 根目录无 package.json，习惯性在根跑 install/start 会失败；pnpm 可能不在 PATH（本机需 shim）；Python 缺失时 e2e 才提示；Node <20 无硬阻断 | **中** | 3–8 | 📄 README 环境一节写"所有命令必须在 unimsg-connector/ 下"；🔧 启动时 Node 版本中文提示 |
| **老师/评委**（对照设计文档验收） | 读 docx → 按 §5 部署 → 按 §7.2 演示三平台闭环 → 按 §6 看 AI 能力 | 10–15 min | **30 min+ 且部分项无法通过** | 文档承诺 Docker/PG/Redis/LLM/OCR/三平台真实收发，交付没有；演示脚本第 2 步就断 | **高** | 10–15 + 20+ 解释 | 📄 承诺-实现对照表（§2）；📄 演示脚本 v2 默认 Mock 兜底；⏳ 证据更新 |

**一句话**：当前项目"能跑"但"跑起来之前要读懂的东西太多"；把 **最短路（纯前端 Mock 30 秒）** 修通、把 **失败提示都变成下一步**，四类用户的学习成本能从 15–30 分钟压到 5 分钟内。若 §7.3 的并行修复全部验收，预计：评审 **3–5 min**、同学换号 **5–8 min + 平台后台时间**、队友接手 **3–5 min**，即回到目标区间。

### 4.2 「5 分钟上手」建议的文档结构

README 顶部（前 60 行内）建议顺序越靠前越好：

1. **一句话定位 + 4 个标签**：零账号可跑 / 四类数据源 / Mock 不伪装真实 / 换账号只改 `.env`。
2. **60 秒跑起来（二选一，带"预期画面"）**：
   - A 纯前端 Mock（不启动后端）：`cd unimsg-connector && pnpm --filter @unimsg/web dev` → 打开 5173 → 应看到 3 条种子消息 + 左下角「Mock 数据」；
   - B 前后端联调：`pnpm --filter @unimsg/server start` → 另开终端 `pnpm --filter @unimsg/web dev`（并说明 `web/.env` 两个值必须与后端一致）。
   - 附 **成功信号**：页面「实时连接」绿点 + 左下角数据源标签；`curl :3001/api/health` 返回 `ok:true` 且 `modes` 全 mock；终端出现 `server listening on :3001`。
   - 附 **停止方式**（Ctrl+C / 关终端）与端口被占用怎么办（一句：改 `SERVER_PORT`，或看 §常见错误）。
3. **我现在是什么状态**：`/api/accounts` 的 `mode/policy/missing/warnings` 怎么读（一张 4 行小表）。
4. **换成我自己的账号**：3 步 + `pnpm run doctor` + 一句"只有 unimsg-connector/.env 会被加载"。
5. **常见错误一张表**：症状关键词 → 原因 → 下一步（建议 8–12 行，见下）。
6. 之后才是架构 / API / 测试 / 已知限制（当前第 60–466 行内容整体后移）。

建议新增/拆出：[quickstart.md](quickstart.md)（一页，评审可打印）、[demo-script.md](demo-script.md)（5 分钟分镜 + 兜底：网络/凭据失效 → 全 Mock）、`docs/troubleshooting.md`（从 `swap-accounts.md` §6.8/§7 抽错误表；本轮先并入 quickstart 的「常见卡点一张表」）。

**常见错误表建议条目**：`EADDRINUSE`→端口被占用改 SERVER_PORT；`无法连接后端服务`→后端未启动/端口不一致/`web/.env` 残留；`未授权：API Token 无效`→两处 token 不一致或 `API_TOKEN=` 留空；`pnpm install` 在根目录报 No package.json→先 `cd unimsg-connector`；`doctor` 显示全 Mock→`.env` 位置/拼写；`21001`→飞书租户策略（换租户/企业认证，本地改 mock）；`60020`→企微可信 IP 加 doctor 打印的出口 IP；`IMAP 登录失败`→授权码不是登录密码/未开 IMAP；`STARTTLS 失败`→端口与加密方式不匹配（465 vs 587）；`邮件收不到`→45s 轮询 + Junk 目录 + 重启漏信。

### 4.3 产品侧首启引导建议

1. **空态即教程**（P1）：收件箱 0 条时不要写"没有匹配的消息 / 清空筛选"，改为「当前还没有消息」+ 3 个可复制动作：① `curl` 灌一条演示消息（带完整命令）② 去平台账号页看扫码接入状态 ③ "接入真实账号"文档入口。
2. **全 Mock 提示条**（P1）：四平台 `modes` 全为 mock 时，页面顶部黄色 banner 常驻：「当前为全 Mock 演示，不会发送到真实平台；点此接入真实账号」——评审一眼就知道这不是"没做完"。
3. **连接状态诚实化**（P2）：左下角"真实后端 · 已接入"改为按 `connection + health` 判断；`offline` 时给「重新连接」按钮而不是只亮红点。
4. **失败卡片给下一步**（P1）：回复失败时详情页显示 `reason`（来自闭环日志）+ 对应 doctor 建议 + 常见 errcode 表链接，而不是只有"回写失败，已写入死信队列"。
5. **doctor 从"体检报告"升级为"自助修复向导"**：结论段除下一步外，增加「疑似拼错的变量名」「找到但未被加载的 .env」「API_TOKEN 仍是 dev-token / 前后端 token 不一致」「当前为全 Mock，原因是…」四条定向提示。
6. **命令可复制**：文档命令统一独立代码块、避免中文引号/全角符号；e2e 端口用参数形式（`pnpm e2e -Port 3102`）。

### 4.4 成功信号清单（建议写进 README/QUICKSTART）

| 层次 | 成功信号 | 失败时用户先看什么 |
|---|---|---|
| 页面 | 右上角「实时连接」绿点；左下角「Mock 数据 / 真实后端」；收件箱有消息 | 顶部错误 Alert 文案 |
| 接口 | `GET /api/health` → `ok:true`、`modes` 各平台对比预期；`GET /api/accounts` 的 `mode/policy` | `doctor` / `mode` 与 `.env` 是否一致 |
| 日志 | `[unimsg] server listening on :3001` + `运行模式: 飞书=… 钉钉=…` | 是否有 `EADDRINUSE` / `verify failed` / `IMAP 登录失败` |

---

## 5. 风险台账（P0 → P3）

> 字段统一：**场景/触发 · 用户看到 · 现状（证据）· 根因 · 建议（类型/工作量）· 状态**。类型：〔代码〕〔文档〕〔接受〕。

### P0（7 条：会直接卡住、数据错误或凭据泄露）

#### R-01 [P0][D/F] 交付包内包含真实凭据、隐私与旧产物
- **触发**：把工作目录直接 zip / 拷 U 盘 / 发给评审；`unimsg-connector/.env`（含真实飞书/钉钉/企微 Secret 与 163/QQ 授权码；条目已确认非空，本文不转述值）、`.env.bak-2026-11-03`（另一份完整旧凭据）、`scripts/e2e-server.log`、`packages/web/.env`、`test.photos/`、`node_modules/` 全在目录里。
- **用户看到**：压缩包 171.8MB / 23,681 个文件（node_modules 实测）；更严重的是凭据与手机号邮箱（脱敏：`1******@163.com`、`3******@qq.com`）随包泄露，无法撤回。
- **现状**：`unimsg-connector/.gitignore:3` 与根 `.gitignore:70` 只保护 git，**不保护 zip**；`git ls-files` 124 个跟踪文件里没有凭据（这点做对了）；交付物定义/打包脚本缺失。
- **根因**：安全边界只建在 git 层；"交付包"没有被当作产物定义。
- **建议**：〔文档+操作，S〕新增「打包前 checklist」+ 用 `git archive` 或白名单复制交付；`.env` 只保留 `.env.example`；删除 `.env.bak`、日志、旧截图（或移出交付）、不打包 `node_modules`。
- **状态**：🧪 已落代码（写作时快照）：新增 `unimsg-connector/scripts/deliver.mjs`——`git archive` 生成交付 zip + 要求工作区干净 + 跟踪文件黑名单校验（`.env`/日志/状态文件/node_modules）；README 已加「交付/打包」入口与 `docs/delivery-checklist.md` 链接。待验收：确认打包命令在干净提交后跑通、zip 内不含凭据。（**本轮必须做**）

#### R-02 [P0][A/E] 「纯前端 Mock」最短演示路径被 `packages/web/.env` 破坏，且"已接入"文案误导
- **触发**：评审按 README:228-232「纯前端 Mock：只起前端，内置数据」操作，但工作区存在 `unimsg-connector/packages/web/.env`（`VITE_API_BASE=http://127.0.0.1:3001`）。
- **用户看到**：页面顶部红条「数据加载异常 / 无法连接后端服务」、连接点「已离线」、左下角却仍写「真实后端 · 已接入 LinkHub Server」→ 评审会认为项目坏了。
- **现状**：`packages/web/src/store/index.ts:18-21`（配了 `VITE_API_BASE` 就切真实后端）、`packages/web/.env` 确实存在（被 gitignore，但工作区在）；`AppShell.tsx:133-138` 用 `demoMode`（数据源类型）而非连接状态渲染页脚。
- **根因**：两种演示模式互斥，但交付目录同时带有两种模式的配置；页脚状态没有反映真实连通性。
- **建议**：〔操作+代码，S〕交付前删除/改名 `packages/web/.env`（让 Mock 模式成为默认）；前端页脚改用 `connection`/`health` 判断，断线时显示「后端未连接」；README 写清"两模式互斥，切换要重启 Vite"。
- **状态**：⏳ 建议 Lead 补派前端/打包（**本轮必须做**）。

#### R-03 [P0][A/F] 设计文档承诺无法按文档验收（部署/AI/三平台真实收发）
- **触发**：评审/老师拿两份 docx 对照验收（执行文档 §5.1–5.3 部署、§6.3 三平台、§6.1 AI、§1.4 初步验证证据）。
- **用户看到**：找不到 Dockerfile/compose、没有 PG/Redis、LLM/OCR 是规则 Mock、演示脚本第②步飞书发消息就失败（21001）/企微 60020。
- **现状**：见 §2 表 G1–G10；README「已知限制」已如实写了大部分（README:412-426），但**设计文档本身未同步**，且 README 没有一张"文档承诺 vs 实现"的对照表。
- **根因**：文档按"目标态"写、实现按"可交付态"做，两者没有版本对齐机制。
- **建议**：〔文档，M〕README 增加「承诺-实现对照表」（可直接用 §2）；`DEMO.md` 演示脚本 v2 默认全 Mock 兜底 + 钉钉/邮箱真实可选；是否补 compose 骨架（L）由 Lead 决策。
- **状态**：📄 Lead 文档（**本轮必须做兜底**）。

#### R-04 [P0][C] 邮箱带附件/嵌套 multipart 邮件正文丢失（数据错误）
- **触发**：用真实邮箱收一封"正文 + 附件"的邮件（Outlook/163 常见 `multipart/mixed` 包 `multipart/alternative` + `attachment`）。
- **用户看到**：收件箱里该邮件正文只剩 `[附件] 文件名`，正文整段消失；基于空正文回复，用户在邮箱里收到答非所问的回信。
- **现状**：`connectors/mail/mime.ts:108-125` 只找**一层** `text/plain`/`text/html`；找不到时直接返回附件占位，不递归进入子 multipart。
- **根因**：MIME 解析只实现了单层 multipart，未处理嵌套。
- **建议**：〔代码，S〕递归解析嵌套 multipart（优先 text/plain，回落 text/html，并保留附件名）；补一条 `multipart/mixed(alternative+attachment)` 单测。
- **状态**：🧪 已落代码（写作时快照）：`mime.ts` 已改为递归遍历 MIME 树（`extractMail`/`walkPart`/深度上限/附件名收集，跳过 `Content-Disposition: attachment`），待验收（含新单测）。

#### R-05 [P0][B] 端口被占用时启动直接崩溃、无中文指引
- **触发**：上次演示的 3001 进程没关 / 同时开两个服务 / 别的软件占用 3001。
- **用户看到**：一屏 Node 英文栈 `Error: listen EADDRINUSE: address already in use :::3001`，进程退出，不知道下一步。
- **现状**：`index.ts:57-62` 只有 `server.listen(port, callback)`，无 `server.on('error')`；README 只写了 `e2e` 的端口冲突（README:253），没写 `pnpm start`。
- **根因**：启动失败路径未做用户态错误处理。
- **建议**：〔代码，S〕监听 `error`：`EADDRINUSE → 中文提示 + 建议 SERVER_PORT=<其它端口> 或结束占用进程`；README 增加一行。
- **状态**：🧪 已落代码（写作时快照）：`app.ts` 新增 `formatListenError`（EADDRINUSE/EACCES/EADDRNOTAVAIL 中文可操作指引），`index.ts` 改为 `server.on('error')` 后退出，并新增 `SERVER_HOST`；待验收。

#### R-06 [P0][C/D] 空/畸形 webhook 被接收并污染幂等键
- **触发**：评审用 `curl -X POST /api/webhook/feishu -d '{}'` 试探；或平台推送了缺 ID 的事件；Mock 模式下无签名也会通过。
- **用户看到**：收件箱出现一条**空消息**；此后所有缺 ID 的事件都被判为"重复"静默丢弃（`duplicate=true`），用户以为消息丢了。
- **现状**：`routes/webhook.ts:32-36` 无签名时 `querySignature` 默认返回 `'mock'`，Mock 模式下任意空 body 通过验签；`connectors/feishu.ts:45`、`dingtalk.ts:35`、`wecom.ts:132` 缺 ID 时 `externalId='unknown'`，全部共用同一个幂等键。README:423 已把它列为"已知限制"但未修。
- **根因**：入口缺少最小的 body/字段校验，幂等键允许退化值。
- **建议**：〔代码，S〕入口校验：空 body、非对象、缺 `externalId`/`message_id`/`msgId`、`externalId==='unknown'` → 400 且不入库、不写幂等表；返回 JSON 错误说明。
- **状态**：🧪 已落代码（写作时快照）：`services/message.ts` 新增 `isEmptyPlatformEvent`/`InvalidPlatformEvent`（空对象/空数组/空白字符串/缺 externalId 均拒绝），`routes/webhook.ts` 在入库前拦截并返回 400；`app.ts` 同时把畸形 JSON 从 Express HTML 报错页改成 JSON；待验收（含非消息事件过滤，见 R-23）。

#### R-07 [P0][C] 邮箱漏信三连：单轮 20 封截断跳水位 / 水位仅内存（重启漏信）/ 非 ASCII 目录 SELECT 失败
- **触发**：① 45s 间隔内新到 >20 封（测试/群发/邮件列表）；② 服务重启或停机期间来新信；③ `MAIL_<KEY>_FOLDERS=垃圾邮件/已发送` 等中文目录。
- **用户看到**：① 第 21 封起**永久丢失**（水位直接跳到最大 UID）；② 重启后的第一轮"立基线"，停机期间邮件全部跳过；③ 每轮日志刷 `IMAP 选择目录 … 失败`，该目录永远收不到。
- **现状**：`connectors/mail/imapClient.ts:289`（`slice(0, limit)`，`limit` 默认 20）、`:297`（`maxUid` 取全邮箱最大 UID）、`stream/mailPoller.ts:38/67`（`watermarks` 是内存 Map，直接 `set(maxUid)`）；`imapClient.ts:247-253` 目录名只做引号转义，未做 IMAP modified UTF-7 编码。README:418 已声明重启漏信。
- **根因**：水位推进不等价于"已处理"；目录名按 UTF-8 直传不合 IMAP 协议；水位未持久化。
- **建议**：〔代码，M〕① 水位取"已成功入库的最大 UID"而不是邮箱最大 UID，本轮取不完下一轮继续；② 水位落盘（如 `unimsg-connector/.mail-watermarks.json`，gitignore）或启动时提示"本次为基线轮，停机期间邮件不会导入"；③ 实现 modified UTF-7 编码（`&`→`&-`，非 ASCII → UTF-16BE base64）或先文档声明"仅支持 ASCII 目录名"。
- **状态**：🧪 已落代码（写作时快照）：`imapClient.ts` 增加 RFC 3501 modified UTF-7 目录编码；`mailPoller.ts` 增加水位状态文件（`MAIL_STATE_FILE`，默认 `.mail-watermarks.json`）原子落盘/续传；**UIDVALIDITY 仍未处理（R-24）**；待验收。

### P1（14 条：容易踩、体验差、要查文档才能继续）

#### R-08 [P1][B/E] 改了 `API_TOKEN` 后 `pnpm e2e`/smoke 必挂 + 前后端 token 双写不一致
- **触发**：同学按 README「生产务必修改 API_TOKEN」把后端 token 改掉；或只改前端 `VITE_API_TOKEN`。
- **用户看到**：`pnpm e2e` 20 项冒烟里鉴权相关断言 FAIL；页面「未授权：API Token 无效」；WS 1008 直接 offline 不重连。
- **现状**：`scripts/smoke.py:20` 硬编码 `TOKEN="dev-token"`；`scripts/e2e.ps1:34-41` 只强制四个平台 mock / 关邮箱，**没有强制 API_TOKEN**（e2e 宣称"不受本机真实 .env 影响"，此说不成立）；前端 token 在 `packages/web/.env`，与后端 `unimsg-connector/.env` 是两个文件（`store/index.ts:19`）。
- **根因**：e2e 的"隔离真实 .env"只覆盖了平台凭据，没覆盖入口 token；两个 .env 的联动关系只写在前面 README 的联调小节。
- **建议**：〔代码+文档，S〕e2e 里设置 `$env:API_TOKEN="dev-token"`（sh 同理）；README/QUICKSTART 用醒目一句写"改后端 API_TOKEN 必须同步改 `packages/web/.env` 的 `VITE_API_TOKEN` 并重启 Vite"。
- **状态**：🧪 已落代码（写作时快照）：`e2e.ps1`/`e2e.sh` 已固定 `API_TOKEN=dev-token`，`smoke.py` 支持显式参数/`LINKHUB_API_TOKEN` 环境变量；前端 token 同步问题仍需文档说明，待验收。

#### R-09 [P1][B] `.env` 放错位置 / 变量拼错 / 编码异常 → 静默回退 Mock，doctor 不点名
- **触发**：把 `.env` 放在仓库根 `LinkHub-test/.env`；把 `FEISHU_APP_ID` 写成 `FEISHU_APPID`/`FEISHU_APP_IDD`；用记事本"Unicode(UTF-16)"保存；多个 `MAIL_*` 段拼错。
- **用户看到**：启动日志显示全部 `mock`，账号页「未配置 / 回退本地模拟」；除 README:423 那句"缺凭据自动 Mock"外没有任何"你的配置可能拼错了"的提示，用户只能逐字对照 `.env.example`。
- **现状**：`config.ts:15-16/34-36` 只加载 cwd、`packages/server`、`unimsg-connector` 三处附近路径，**仓库根 `.env` 不会加载**；`runtime.ts:247-354/555-585` 只认已知变量名；`doctor.ts:109-141` 只列候选路径与"未找到"，不扫描未知/近似变量名，也不检测 UTF-16。经实测 dotenv 16.6.1 已能处理 BOM/CRLF/行内注释（所以主要坑在"位置/拼写/编码"）。
- **根因**：配置校验是"白名单读取"，没有"输入侧诊断"。
- **建议**：〔代码+文档，S〕doctor 增加三条检查：疑似拼写错误变量（与 `.env.example` 做编辑距离/前缀匹配）、"找到但未被加载的 .env"（仓库根/其它）告警、`.env` 非 UTF-8 编码告警；README:259 改为唯一路径表述。
- **状态**：🧪 已落代码（写作时快照）：新增 `doctor/env-check.ts`（已知变量白名单 + 可疑变量名/建议名，含 `MAIL_<KEY>_*` 动态变量），`doctor.ts`/`report.ts` 接入；"找到但未加载的 .env"与编码检测尚未全部覆盖，待验收。

#### R-10 [P1][D] 默认 `dev-token` + CORS `*` + 监听所有网卡 + **`API_TOKEN=` 留空直接关闭鉴权**
- **触发**：演示/评审在同一 Wi-Fi；或同学为了"改掉默认 token"把行改成 `API_TOKEN=`（空值）。
- **用户看到**：同网段任何人可无凭证读全部消息、回复、标记完成（`auth` 只靠一个共享 token）；另一种是"以为改安全了"，实际 `apiAuth` 直接放行。
- **现状**：`config.ts:85` `apiToken = process.env.API_TOKEN ?? 'dev-token'`（**空字符串不是 null**，dotenv 解析 `API_TOKEN=` 得到 `''`，已实测）；`middlewares/auth.ts:9-10` `if (!token) return next()` → 鉴权全关；`ws.ts:21` 同理；`app.ts:14` `cors()` 无白名单；`index.ts:57` 未指定 host，绑定所有接口；`store/index.ts:19` 前端 bundle 内置 token；`ws.ts:19-24` token 走 query（会被反代日志记录）。
- **根因**：演示便利默认值没有"环境边界"提示；空值语义与"未配置"混淆。
- **建议**：〔代码+文档，S〕① 空 `API_TOKEN` 按"未配置"处理并打印醒目警告（或拒绝启动）；② 启动日志在检测到 `dev-token`/CORS `*`/0.0.0.0 时打印「仅本机演示，勿在公共网络使用」；③ README 演示边界写清；CORS 白名单可作为增强项。
- **状态**：🧪 部分已落代码（写作时快照）：新增 `CORS_ORIGINS` 白名单（不填保持 `*` 兼容本地）、`dev-token` 启动醒目告警、`NODE_ENV=production` 且默认 token 时拒绝启动、`SERVER_HOST` 可收紧监听；**`API_TOKEN=` 空值仍会关闭鉴权（鉴权代码仍 `if (!token) return next()`）**，建议一并修；待验收。

#### R-11 [P1][C] "状态回流"是本地乐观推进、可被倒退，真实平台事件没有回流通道
- **触发**：任何一次 Mock/真实发送成功；或调用自定义 status webhook 传 `status=received`。
- **用户看到**：状态自动变绿 `已同步`，即使对方实际没收到（邮件退信/企微 60020 之外的成功返回也不代表送达）；发的回流事件若乱序，已 `synced` 的消息会**倒退**成 `received`，UI 状态跳回。
- **现状**：`services/message.ts:157-164` 在真实发送返回后立刻 `SENT→SYNCED` 并写日志"平台状态回流"；`message.ts:185-193` `syncStatus` 接受任意 `MsgStatus`（含 `received`）且未知值默认 `synced`；`services/sync.ts:9-18` 只识别顶层 `event==='status'|'sync'|'message.status'` 的自造报文，飞书/企微真实事件格式不会命中。
- **根因**："接口 ack"与"平台送达/已读"没有区分；状态迁移缺少单向性守卫。
- **建议**：〔代码+文档，S/M〕① `syncStatus` 做单向状态守卫（只允许前进或显式 `failed`），非法回退忽略并记日志；② 文案把 `synced` 解释为"平台接口已确认"（或新增独立 `delivered` 字段）；③ 文档说明真实回流未对接，演示回流用自造事件。
- **状态**：🧪 部分已落代码（写作时快照）：`message.ts` 新增 `STATUS_RANK` 状态秩与防倒退校验（倒退/重复请求忽略并记 `sync_ignored`，保留原状态）；`sent→synced` 的乐观语义与真实平台事件回流仍未变，需产品/文档决策；待验收。

#### R-12 [P1][C/E] 重复回复无幂等、无二次确认
- **触发**：用户双击「发送回复」、第一次超时后重试、或对已 `synced` 的消息点「再次回复」。
- **用户看到**：对方收到两条相同回复；回放里出现两段 processing/replied/sent 记录；邮件场景会真的发出两封。
- **现状**：`services/message.ts:115-130` `reply` 不校验当前状态、不判重，直接推进并 `void this.processSend(id)`；`ReplyComposer.tsx` 只在请求期间 `sending` 禁用；`DetailPanel.tsx:33-42` 明确提供「再次回复」。
- **根因**：发送动作没有幂等键，也没有"已回复"状态守卫。
- **建议**：〔代码，S〕后端 `reply` 对 `replied/sent/synced` 状态要求显式 `confirm: true` 或直接 409；前端二次确认 + 请求中防抖；文档说明"再次回复"是有意功能。
- **状态**：⏳ 待排期（本轮可不修，但建议至少加二次确认）。

#### R-13 [P1][E] 后端未启动/断线后前端无恢复入口，且会误报"已接入"
- **触发**：先开前端后开后端；演示中后端崩溃/重启；笔记本休眠恢复。
- **用户看到**：红条「无法连接后端服务，请确认服务已启动」只能关闭；WS 约 45s 后进入「已离线」且不再重连；左下角仍写「真实后端 · 已接入」；必须手动刷新页面才能恢复。
- **现状**：`wsRealtime.ts:119-131` 最多 8 次重连后 `offline`；`AppShell.tsx:142-152` 错误 Alert 只有关闭按钮；`AppShell.tsx:133-138` 页脚按 `demoMode` 渲染；无轮询兜底。
- **根因**：错误态只做"告知"，没做"恢复"。
- **建议**：〔代码，S〕offline 时提供「重新连接」按钮（重连 + 重拉列表/健康）；错误 Alert 增加"重新加载"；页脚显示真实连接状态。
- **状态**：⏳ 待排期（与已派"Web 首启引导"可同批）。

#### R-14 [P1][C/E] 长消息超平台限制无校验，失败原因泛化
- **触发**：粘贴 1500+ 中文字符或大段 emoji 回复；或回复内容超过企微 2048 字节。
- **用户看到**：状态变「发送失败」，详情只写"回写失败，已写入死信队列"；真实原因（平台 limit errcode）在 trace 页/控制台，用户不知道是"太长"。
- **现状**：`ReplyComposer.tsx:31` 只限 2000 **字符**；`routes/messages.ts:36-40` 只 trim；各 `convert()`（`wecom.ts:144-152`、`dingtalk.ts:48-53`、`feishu.ts:58-64`）不做长度/字节校验。
- **根因**：统一消息模型没有"平台侧限制"这一层。
- **建议**：〔代码，S〕按平台做字节/字符上限校验并在前端提示（企微约 2048 字节、钉钉/飞书按各自限制）；超限错误映射成中文"内容过长，请精简到 N 字内"。
- **状态**：⏳ 待排期。

#### R-15 [P1][B] 运行时版本与安装门槛：Node/pnpm/Python（项目无 Java 运行时）
- **触发**：同学机器 Node 18/16、没装 pnpm、没装 Python；或在仓库根目录跑命令。
- **用户看到**：`pnpm: command not found`；Node 版本不符时服务仍能启动但真实发送/测试行为异常；`pnpm e2e` 才报"未找到 Python"；根目录没有 package.json → 习惯性 `pnpm install` 直接失败。项目是 Node/TS 技术栈，**不需要 Java**，但赛题文档没写清"环境只有 Node"。
- **现状**：`package.json:17-19` 只有 `engines: node>=20`（pnpm 默认只警告不阻断）；启动时无版本校验；README:174/215 写了要求但埋在文档中；`scripts/e2e.sh:13-19` 才检查 Python。
- **根因**：环境门槛靠文档自觉，没有启动期/首启期的可执行检查。
- **建议**：〔代码+文档，S〕服务启动时打印/校验 Node 主版本（<20 给中文指引）；README 环境一节 + QUICKSTART 首行写"Node ≥20、pnpm ≥9，Python 3 仅 e2e 需要"；e2e 失败文案给出安装指引。
- **状态**：⏳ 待排期（文档优先）。

#### R-16 [P1][B/F] 交付/演示路径：仓库在中文目录、历史实测在 `C:\LinkHub`、node_modules 进包
- **触发**：当前仓库路径为 `C:\Users\<用户>\Desktop\新建文件夹\LinkHub-test`；而 `test.photos/` 里所有实测截图路径都是 `C:\LinkHub\unimsg-connector`；若整目录打 zip，会带上 171.8MB 的 node_modules。
- **用户看到**：交付包体积过大/解压慢；含中文/空格/OneDrive 同步目录时，个别工具链（tsx/pnpm/python 子进程、路径引用）可能出编码问题；历史截图与当前环境不一致，评审追问时难解释。
- **现状**：仓库根无 package.json；`node_modules` 实测 171.8MB/23,681 文件；`test.photos` 为 2026-11-02 旧版截图（旧日志格式、无 `modes/sentMock`）；README:362 实测环境为 Windows 11。
- **根因**：开发路径与交付路径不同；交付物没有白名单。
- **建议**：〔文档+操作，S〕README 写"建议解压到 ASCII 短路径（如 `C:\LinkHub`），不要放 OneDrive 同步目录"；交付用 `git archive`/白名单；如需保留截图，注明"2026-11-02 历史截图"。
- **状态**：📄 文档（与 R-01 同批）。

#### R-17 [P1][E] 真实发送失败原因不可见，用户不知道下一步
- **触发**：飞书 21001、企微 60020/缺权限、SMTP 535、钉钉机器人未发布等真实失败。
- **用户看到**：详情页红条「回写失败，已写入死信队列」+ 建议"可修改内容后再次发送"；真实原因只在闭环日志（需切到回放页）或控制台。
- **现状**：`services/message.ts:167-174` 把 reason 写进 loop log 与 DLQ；`DetailPanel.tsx:133-141` 只展示通用文案；`listDlq()` 没有 REST 接口，健康页只有计数。
- **根因**：失败信息的展示层没有消费日志层的原因。
- **建议**：〔代码，S/M〕详情页展示最近一条 `failed` 日志的 `detail` + 按平台映射"下一步"（doctor 建议）；或加 `GET /api/dlq` 只读接口（见 R-29）。
- **状态**：⏳ 待排期。

#### R-18 [P1][F] 内存存储 + 无优雅退出：重启即丢消息/日志/待办/回放
- **触发**：演示中 Ctrl+C 重启、`pnpm dev` 热重载、机器休眠后进程被杀。
- **用户看到**：刷新后收件箱/待办/全链路回放全空；评审会以为是数据 bug 或功能缺失。
- **现状**：`db/repository.ts:30-83` 唯一实现在内存；`index.ts` 无 SIGINT/SIGTERM 处理；`mailPoller` 用 `setInterval` 常驻。README:425 已声明。
- **根因**：持久化未实装（设计取舍），但没有"用户态提示"。
- **建议**：〔文档+小代码，S〕启动日志打印「存储：内存（重启即清空，演示前请勿重启）」；README/QUICKSTART 显著标注；优雅退出可后置。
- **状态**：📄 文档优先。

#### R-19 [P1][D] 日志泄露敏感信息（邮箱明文、正文、trace 明细）
- **触发**：启动日志、mock-send 日志、评审截图、把服务日志发给别人排查。
- **用户看到**：`[unimsg] 邮箱账号: QQ邮箱<3******@qq.com>` 这类行实际打印的是**完整邮箱地址**（`index.ts:52` 用 `a.address`，仓库里已有 `maskAddress` 却未用）；`[mock-send]` 会把回复正文 JSON 全量打印（`connectors/base.ts:29`）；`/trace` 页面展示完整正文与 sender.id。
- **现状**：`services/account.ts:51-57` 有 `maskAddress`，doctor/report 已用它脱敏（`doctor/report.ts:145-149`），但启动日志与 mock 日志没用。
- **根因**：脱敏规则只在 doctor 报告层实现，没做成日志公共层。
- **建议**：〔代码，S〕启动日志改用 `maskAddress(a.address)`；mock-send 只打印平台/长度/摘要；README 安全说明补"日志/截图脱敏"。
- **状态**：⏳ 待排期（很小，建议本轮顺手修）。

#### R-20 [P1][A] 半可用平台的「真实」歧义：`auto` 只要收/发任一能力就判 real
- **触发**：只填部分凭据（飞书只有 Verify Token、企微只有 CorpId/Secret/AgentId、钉钉开了 Stream 没配 robotCode 等）。
- **用户看到**：账号页显示「真实接口」，但实际"只能收不能发"或"只能发不能收"；回复时抛错/收不到消息时误以为是 bug。
- **现状**：`config/runtime.ts:561-568` 的 `mode` 判定；warnings 已存在（`runtime.ts:481-516`）但展示在卡片尾部，普通用户容易忽略；README:110-127 行为矩阵很长但准确。
- **根因**：一个 `mode` 字段承载了收和发两种能力，语义被压缩。
- **建议**：〔产品+文档，S〕账号卡把「收信 ✔/✘ · 发信 ✔/✘」做成醒目双徽标（后端字段已有），并在"仅收/仅发"时给一行下一步；README 保留矩阵。
- **状态**：⏳ 待排期（文档 + 前端小改）。

#### R-21 [P1][A] 初步验证证据与设计文档要求不匹配（旧截图、缺三平台连通/意图抽样）
- **触发**：初赛/决赛按执行文档 §1.4 提交证据；评审核对截图与当前代码。
- **用户看到**：仓库只有两张 2026-11-02 的 smoke 截图（路径 `C:\LinkHub`、旧日志格式）；没有"三平台 API 连通性截图""意图识别抽样 ≥30 条/≥85%""Mock 全链路录屏"。
- **现状**：`test.photos/` 两个 tracked PNG；README:385-410 有文字实测记录但非截图证据；docx §1.4 明确要求四类证据。
- **根因**：实现迭代快于证据更新，证据没有纳入交付清单。
- **建议**：〔文档，S/M〕更新/补充证据或明确降级说明（如"LLM 未实装，不提交意图抽样"）；截图注明版本与日期；证据放入交付清单。
- **状态**：📄 文档（Lead 决策）。

### P2（8 条：边缘场景或有替代路径）

#### R-22 [P2][C] 同一邮箱重复配置 / 目录大小写差异 → 同一封邮件重复入库
- 触发：同一地址配成两个 key（如 `MAIL_QQ_*` 与 `MAIL_WORK_*` 同地址）；`MAIL_X_FOLDERS=INBOX,inbox`。
- 用户看到：相同邮件在收件箱出现 2 条，回复/统计翻倍。
- 现状：`externalId = <key>:<folder>:<uid>`（`connectors/mail/mail.ts:55`、README:325），key/folder 任一不同即不同键；`config/runtime.ts:247-354` 不检测重复地址；目录未归一化大小写。
- 根因：幂等键包含"配置键"，而不是纯邮件身份。
- 建议：〔代码，S〕启动时检测重复 address 告警；目录做 `INBOX` 归一化；文档提示"同一地址只配一次"。
- 状态：⏳。

#### R-23 [P2][C] 真实平台非消息事件会入库成空消息
- 触发：企微回调的进入应用/菜单事件（`<MsgType>event</MsgType>`）、飞书订阅了非 `im.message.receive_v1` 的事件；真实模式下验签通过。
- 用户看到：收件箱多出一条空正文消息；第二条因 `externalId='unknown'` 被判重复。
- 现状：`connectors/wecom.ts:119-141` 不区分 `MsgType=event`；`feishu.ts:28-56` 只按 `event.message` 解析、缺字段退化；`services/sync.ts:9-18` 不会把它们识别成状态事件。
- 根因：事件分流只支持自造格式，未按真实平台事件 schema 过滤。
- 建议：〔代码，S〕非消息类事件直接 200 ack 但不入库（记录 debug 日志）；与 R-06 的入口校验同批。
- 状态：⏳（建议并入 R-06 派工）。

#### R-24 [P2][C] IMAP `UIDVALIDITY` 未校验：邮箱重建/迁移后可能永久不再导入
- 触发：服务商侧重建邮箱、文件夹迁移、IMAP 账号切换后 UID 重置。
- 用户看到：轮询日志正常，但新邮件再也不出现（水位比新 UID 体系的最大值大）。
- 现状：`connectors/mail/imapClient.ts:281-299` 只做 `UID SEARCH ALL`，未取 `UIDVALIDITY`；`mailPoller.ts:67` `Math.max(maxUid, last)` 使水位只增不减。
- 根因：UID 水位缺少"命名空间/有效性"前缀。
- 建议：〔代码，M〕SELECT 时读 `UIDVALIDITY` 随水位一起持久化，变化则重新立基线并告警；若水位已持久化，一并覆盖此场景。
- 状态：🔧 写作时 UIDVALIDITY 尚未见改动；与已派"水位持久化"相邻，建议提醒开发一并处理（若水位文件已带 UIDVALIDITY 字段则本条关闭）。

#### R-25 [P2][B] 双 `.env`/多路径加载优先级不透明
- 触发：团队里有人在 `packages/server/.env` 或仓库根放了一份 `.env`。
- 用户看到：改了"最显眼"的那份 `.env` 却不生效；`pnpm --filter` 运行时 cwd 是 `packages/server`，`import 'dotenv/config'` 会先加载 cwd 的 `.env` 并**不被后续覆盖**（`config.ts:15-16`），可能压过 `unimsg-connector/.env`。
- 现状：`config.ts:15-16/34-36` 加载顺序注释在代码里，README 未写；`doctor.ts:109-141` 只列出两个候选、不提示"两份都存在且谁生效"。
- 根因：配置加载优先级未暴露给用户。
- 建议：〔代码，S〕启动日志打印"实际加载的 .env 文件 + 每份的键覆盖数"；doctor 报告两份都存在时红字告警；README 写明"只有 unimsg-connector/.env 生效"。
- 状态：⏳（与 R-09 同批）。

#### R-26 [P2][B] 代理 / SSL 拦截 / 时钟偏差：真实模式整体不可用且提示有限
- 触发：公司/校园网强制代理、杀毒软件 HTTPS 中间人、系统时间偏差 >1h。
- 用户看到：fetch/IMAP/SMTP 全部 `certificate`/`ECONNREFUSED`/`verify failed`；doctor 有代理与网络文案，但服务本身不读 `HTTP(S)_PROXY`；回调验签 401 只有 `verify failed`。
- 现状：`connectors/real.ts:18-53` 用内置 fetch；`imapClient.ts/smtpClient.ts` 用 `node:tls`（默认校验证书）；`dingtalk.ts:76`、`wecom.ts:27/115` 时间窗；README 未写"不读代理"。
- 根因：Node 内置 fetch/tls 不自动继承系统代理配置；时间窗错误未给出具体原因。
- 建议：〔文档，S〕README/QUICKSTART 写"本服务不读取 HTTP(S)_PROXY，代理环境请设置系统级透明代理或直连"；验签失败日志补充"检查本机时间"。
- 状态：📄 文档兜底（接受）。

#### R-27 [P2][C] 邮件正文 2000 字截断、长中文主题不折行、退信不可见
- 触发：长邮件；超长中文主题；发信后对方退信/进垃圾箱。
- 用户看到：正文显示到 2000 字突然断；部分客户端主题乱码；状态 `synced` 但对方没收到。
- 现状：`connectors/mail/mail.ts:50` `.slice(0, 2000)` 无省略提示；`mime.ts:204-207` encoded-word 不按 RFC 2047 折行（>75 字符）；SMTP 只看 `250 queued`（`smtpClient.ts:413-415`）。
- 根因：长度/编码/送达语义没有面向用户的说明。
- 建议：〔代码+文档，S〕截断处加「（正文过长已截断，完整内容见邮箱）」；长主题折行；文档说明"synced=已交给 SMTP，不代表送达"。
- 状态：⏳/📄。

#### R-28 [P2][E] 空态与首启引导缺失（无"下一步"）
- 触发：新后端 0 条消息；`/todos` 空；`/trace` 空。
- 用户看到：收件箱「没有匹配的消息 / 换一个平台或状态，或者清空搜索条件」+「清空筛选」——明明没有任何消息，却只让"清空筛选"；不知道如何灌一条演示消息。
- 现状：`features/inbox/InboxPage.tsx:93-108`、`components/EmptyState.tsx:5-13`、`features/todos/TodosPage.tsx:34-35`；"灌消息"方法只在 README:245 提到 `scripts/smoke.py`。
- 根因：空态按"筛选无结果"设计，没有按"全新环境"设计。
- 建议：〔代码，S〕区分"无消息"与"筛选无结果"两种空态；无消息时给 3 个动作（复制 curl 命令 / 去账号页 / 接入文档）。
- 状态：🧪 已落代码（写作时快照）：新增 `packages/web/src/components/FirstRunGuide.tsx`（真实后端 + 空收件箱时给 3 步上手 + 可复制命令 + 「知道了」记忆）及配套单测；写作时尚未见 `InboxPage`/`AppShell` 接线，待前端同学接入验收。

#### R-29 [P2][F] DLQ 只有计数、没有查看接口
- 触发：真实发送失败后想查死信内容/原因。
- 用户看到：账号页「死信队列 1」但点不开；只能看 trace 或控制台。
- 现状：`services/message.ts:221-223` 有 `listDlq()`，`routes/health.ts:14` 只暴露计数，没有 REST 路由；README:141 宣称"DLQ 完成"。
- 根因：运维可用性未闭环。
- 建议：〔代码，S〕`GET /api/dlq`（Bearer）只读返回最近 N 条（脱敏）；或文档注明"当前仅计数"。
- 状态：⏳。

### P3（2 条：可接受/仅体验瑕疵）

#### R-30 [P3][C/E] 体验小项合集：发送方显示 ID、"重新生成"无效果、待办页文案写"三平台"
- 现状：飞书/企微的 `sender.name` 直接用 ID（`feishu.ts:46`、`wecom.ts:133`），详情页显示一串 open_id/userid；「AI 建议 → 重新生成」在真实后端模式也只弹"Mock 模式下由关键词规则生成"（`AiSuggestion.tsx:49-52`），点了没变化；待办页文案写"从三平台消息中识别"（`TodosPage.tsx:30`），实际是四类数据源。
- 根因：小文案/展示未随四平台扩展开关更新。
- 建议：〔代码+文档，S〕飞书取 `sender.name` 兜底 ID；按钮文案改"Mock 规则（不可重新生成）"或隐藏；待办页改"四类数据源"。
- 状态：⏳（低优先）。

#### R-31 [P3][F] 多实例/多标签/时区：接受并说明
- 现状：内存存储、token 缓存、限流桶均进程内，多实例/多浏览器标签不共享（README:421 已声明）；时间戳统一用 ISO/本地时区展示，无跨时区问题。
- 建议：〔接受〕演示/单机场景不修；README 保留说明即可（已覆盖）。
- 状态：✅ 接受。

---

## 6. Top 10 修复建议（按「降低新用户学习成本 / 避免上手卡死」排序）

| # | 建议（要解决的风险） | 类型 | 预估位置 | 工作量 | 状态 |
|---|---|---|---|---|---|
| 1 | **交付包白名单**：只交付 `git archive`/白名单文件，删除 `.env`/`.env.bak`/日志/旧截图，不打包 `node_modules`；附「打包前 checklist」 | 📄 文档+操作（R-01/R-16） | `scripts/deliver.mjs` + 打包流程 | S | 🧪 `deliver.mjs` 已落（待验收） |
| 2 | **修通最短演示路径**：交付前删除/改名 `packages/web/.env`，保证「只起前端=Mock 演示」；页脚按连接状态显示 | 操作+前端小改（R-02） | `packages/web/.env`、`AppShell.tsx:133-138` | S | 本轮必须（建议补派前端） |
| 3 | **README 顶部「3 分钟零账号跑起来 + 成功信号 + 停止/端口」**，把当前 213 行后的快速开始前移；补 `QUICKSTART.md`、`DEMO.md`、错误表 | 📄 文档（R-28/R-03） | `README.md` 前 60 行、新增 docs | M | 🧪 README 顶部已加「从这里开始」+ 承诺对照表；quickstart/demo/delivery 文档待验收 |
| 4 | **首启引导与空态**：全 Mock banner；空收件箱给"3 步灌一条消息"可复制命令；offline 显示「重新连接」按钮 | 产品（R-28/R-13） | `InboxPage.tsx`、`AppShell.tsx`、`wsRealtime.ts` | S/M | 🧪 `FirstRunGuide` 已落（待接线）；重连按钮建议补 |
| 5 | **端口占用/启动失败中文提示** + README 一行 | 产品（R-05） | `index.ts:57-62`（HEAD） | S | 🧪 已落代码（`formatListenError`，待验收） |
| 6 | **webhook 空/畸形校验 + 非消息事件过滤**（400 不入幂等、过滤 `MsgType=event`） | 产品（R-06/R-23） | `routes/webhook.ts:58-96`（HEAD）、`receive()` | S | 🧪 空/畸形已落代码；事件过滤建议补 |
| 7 | **状态回流防倒退 + 文案诚实化**（`syncStatus` 单向守卫；`synced` 解释为接口确认） | 产品（R-11） | `services/message.ts:185-193`（HEAD）、`DetailPanel.tsx` | S | 🧪 防倒退已落代码；文案待决策 |
| 8 | **邮箱数据可信**：嵌套 multipart 正文递归、IMAP 水位取"已入库最大 UID"+持久化+UIDVALIDITY、中文目录 modified UTF-7 | 产品（R-04/R-07/R-24） | `mime.ts:108-125`、`imapClient.ts:247-299`、`mailPoller.ts:38-67`（HEAD） | M | 🧪 正文/水位/目录已落代码；UIDVALIDITY 建议补 |
| 9 | **换账号自助诊断**：doctor 增加「疑似拼错变量」「找到但未加载的 .env」「API_TOKEN 默认/空/两处不一致」；启动日志打印实际 .env 与加载顺序 | 产品+文档（R-09/R-08/R-25） | `doctor.ts:109-141`、`config.ts:34-36`（HEAD） | S | 🧪 `env-check.ts` 已落；加载顺序/空 token 待补 |
| 10 | **数据易失/安全边界告知**：启动日志「内存存储，重启清空」、邮箱地址脱敏、mock 日志脱敏、dev-token 演示边界说明 | 文档+小代码（R-18/R-19/R-10） | `index.ts:52/60`、`base.ts:29`、README | S | 🧪 部分（token 告警+CORS 已落）；日志脱敏建议顺手修 |

---

## 7. 本轮最小必改集合（我的坚持）与验收方式

### 7.1 必须本轮完成（不做就会在"第一次打开项目"时翻车）

1. **交付包清理/白名单**（R-01，含 `.env*`、日志、旧截图、node_modules）——安全红线；`deliver.mjs` 已提供，验收时先 `git commit` 再跑打包。
2. **纯前端 Mock 最短路径可用**（R-02：处理 `packages/web/.env` + 页脚状态）——评审 5 分钟演示的关键。
3. **README 顶部 3 分钟 Quickstart + 成功信号**（R-03/R-28 文档侧）。
4. **端口占用中文提示**（R-05，🧪 已落代码）与 **webhook 空/畸形校验**（R-06，🧪 已落代码）。
5. **邮箱嵌套 multipart 正文**（R-04，🧪 已落代码）——真实可用链路上的数据错误。

**可以本轮只补文档/接受**：Docker/PG/Redis/LLM/OCR（§2 G1–G5）、多实例、代理环境、旧证
据；飞书 21001 与企微 60020 属平台/网络侧，代码无解，必须写成"现实说明 + 替代演示路径"。

### 7.2 验收方式（不需要跑全量 e2e/doctor）

| 验收项 | 只读命令/动作 | 期望 |
|---|---|---|
| 交付包干净 | `git ls-files` + 检查交付 zip 清单 | 无 `.env*`、无 `*.log`、无 `node_modules`、无真实凭据 |
| Mock 演示可用 | 删除 `packages/web/.env` → `pnpm --filter @unimsg/web dev` | 首屏 3 条种子消息、左下角「Mock 数据」、无红色错误条 |
| 端口提示 | 先占用 3001 再 `pnpm --filter @unimsg/server start` | 中文提示 + 建议改 `SERVER_PORT`，无英文栈 |
| webhook 校验 | `curl -X POST :3001/api/webhook/feishu -H 'Content-Type: application/json' -d '{}'` | 返回 4xx + 错误说明；`/api/messages` 不新增空消息 |
| 状态防倒退 | Mock 回复一条到 `synced`，再 `POST /api/webhook/feishu -d '{"event":"status","status":"received",...}'` | 状态保持 `synced`（或返回拒绝），不倒退 |
| 邮箱附件正文 | 用 QQ/163 发一封"正文 + 附件"的邮件到被监听账号 | 收件箱正文包含原文（不只 `[附件]`） |
| 上岸体验 | 让 1 位没看过项目的人按 README 前 60 行操作并计时 | ≤5 分钟看到 Mock 闭环；不需要看 213 行以后 |

### 7.3 并行修复快照（写作期间工作区已见改动，均未验收）

> 用途：Lead 收尾时对照"哪些风险已经有代码在修、验收要看哪里"。工作区 `git status` 显示以下未提交改动；**只做静态抽查，不代表已通过测试**。

| 已改动文件（工作区） | 对应风险 | 修复要点（从 diff 观察） | 验收建议 |
|---|---|---|---|
| `unimsg-connector/scripts/deliver.mjs`（新增） | R-01/R-16 | `git archive` 交付；要求工作区干净；跟踪文件黑名单（`.env`/日志/状态文件/node_modules） | 干净提交后跑一次 `pnpm run deliver`，解开 zip 检查 |
| `packages/server/src/app.ts`（+98） | R-05/R-10/G6 | `formatListenError` 中文启动错误；`CORS_ORIGINS` 白名单；`bodyErrorHandler` 把畸形 JSON/413 改成 JSON | 端口占用演示 + `curl -d '{}'` |
| `packages/server/src/middlewares/auth.ts`（+24） | R-10 | `DEFAULT_DEV_TOKEN`、`devTokenWarning`、`productionTokenBlocker`（生产环境默认 token 拒绝启动）；**空 `API_TOKEN` 仍会关鉴权，未覆盖** | 启动日志看告警；`API_TOKEN=` 空值单独验 |
| `packages/server/src/index.ts`（+44） | R-05/R-10 | `server.on('error')` + `SERVER_HOST` + CORS 白名单日志 + dev-token 告警 | 同 R-05/R-10 |
| `packages/server/src/routes/webhook.ts`（+19） | R-06 | 验签后、入库前拦截空事件体 → 400（不写 trace/幂等表） | `curl -d '{}'` 后查 `/api/messages` 无空消息 |
| `packages/server/src/services/message.ts`（+114） | R-06/R-11 | `isEmptyPlatformEvent`/`InvalidPlatformEvent`；`STATUS_RANK` 状态防倒退、`sync_ignored` | 空事件 400；synced 后推 received 状态不回退 |
| `packages/server/src/connectors/mail/mime.ts`（+162） | R-04 | MIME 树递归（`extractMail`/`walkPart`/深度上限/附件跳过） | 发一封"正文+附件"实测 |
| `packages/server/src/connectors/mail/imapClient.ts`（+74） | R-07 | modified UTF-7 目录编码；**未见 UIDVALIDITY（R-24 仍开）** | 配中文目录实测轮询 |
| `packages/server/src/stream/mailPoller.ts`（+236） | R-07 | 水位状态文件（`MAIL_STATE_FILE`，默认 `.mail-watermarks.json`）落盘/续传 | 重启后确认水位续传 |
| `packages/server/src/doctor/env-check.ts`（新增）+ `doctor.ts`/`report.ts` | R-09 | 已知变量白名单 + 可疑拼写变量与建议名 | 在 `.env` 里写错一个变量试 doctor |
| `packages/web/src/components/FirstRunGuide.tsx`（新增，未接线） | R-28 | 真实后端 + 空收件箱时 3 步上手 + 可复制命令 | 接进 `InboxPage` 后空库打开验证 |
| `scripts/e2e.ps1`/`e2e.sh`/`smoke.py`（+3/+5/+8） | R-08 | e2e 固定 `API_TOKEN=dev-token`；smoke 支持参数/`LINKHUB_API_TOKEN` | 把 `.env` 的 token 改掉再跑 `pnpm e2e` |
| `README.md`（+30） | 文档主线 | 顶部「从这里开始（30 秒选路径）」+「设计文档承诺 vs 当前实现」+ 新文档链接 | 按新路径让新人走一遍计时 |
| `.gitignore`（+3） | R-01/R-07 | 增加邮箱水位状态文件等忽略规则 | 确认状态文件不会进 git/交付包 |

---

## 附录 A：风险覆盖矩阵（任务 A–F 六类角度）

| 角度 | 覆盖风险 |
|---|---|
| A 用户旅程（演示/换号/部分配置/真实收发/可信 IP/交付/重启换网/多账号/中文附件） | R-01、R-02、R-03、R-18、R-20、R-21、R-26、R-31 |
| B 环境与安装（Node/pnpm、corepack、中文路径、端口、.env/BOM/CRLF/双文件/代理、时钟、IPv6、只读盘） | R-05、R-09、R-15、R-16、R-25、R-26 |
| C 数据与协议（空 webhook、幂等、重复推送、IMAP 水位/目录/MIME、SMTP、长消息、会话形态、token/限流、WS、时区） | R-04、R-06、R-07、R-11、R-12、R-14、R-22、R-23、R-24、R-27、R-30 |
| D 安全与合规（dev-token、验签 strict、日志/报告/截图、`.env` 误提交、CORS、WS token、health 暴露） | R-01、R-06、R-10、R-19 |
| E 前端体验（后端未启动/401/超时/WS 断裂、空态、误操作、模拟发送标识） | R-02、R-12、R-13、R-17、R-28、R-30 |
| F 运维/交付（内存存储、无优雅退出、限流只发送路径、DLQ、CI 真实平台覆盖、多实例） | R-01、R-03、R-16、R-18、R-21、R-29、R-31 |

## 附录 B：本文引用的关键代码/文档位置索引

- 启动与装配：`packages/server/src/index.ts:57-74`（listen / Stream / MailPoller）、`app.ts:12-21`（CORS、body limit、路由顺序）
- 配置解析：`config.ts:15-16/34-36/85`、`config/runtime.ts:88-118/247-354/555-585`
- 接入：`routes/webhook.ts:32-96`、`connectors/{feishu,dingtalk,wecom}.ts`、`connectors/mail/{mail,mime,imapClient,smtpClient}.ts`、`stream/{mailPoller,dingtalkStream}.ts`
- 中枢：`services/message.ts:43-103/115-193`、`services/sync.ts:9-18`、`services/rateLimiter.ts:24-39`、`core/idempotency.ts`
- 存储：`db/repository.ts:30-83`、`db/migrations/001_init.sql`
- 鉴权/实时：`middlewares/auth.ts:8-21`、`ws.ts:16-36`
- 前端：`store/index.ts:18-21`、`store/appStore.ts:98-121`、`services/{httpApi,wsRealtime}.ts`、`app/AppShell.tsx:133-152`、`features/inbox/{InboxPage,DetailPanel,ReplyComposer}.tsx`
- 文档：`README.md`（快速开始 213-255、配置 257-342、测试 360-410、已知限制 412-426）、`docs/swap-accounts.md`（换号 3 步 / FAQ / 错误表）、`unimsg-connector/.env.example`、`packages/web/README.md`
- 交付/证据：`unimsg-connector/.gitignore`、根 `.gitignore`、`test.photos/`、`scripts/{e2e.ps1,e2e.sh,smoke.py}`

---

> 下一步建议：Lead 按 §7.1 的 5 项收口，并按 §7.3 逐条验收已落代码；README 顶部引用本文的「§2 承诺-实现对照表」与「§4.2 五分钟结构」；开发同学只需按 §6 Top10 中标注 🧪/🔧 的项补齐缺口（重点：web/.env、空 `API_TOKEN`、UIDVALIDITY、日志脱敏、断线重连按钮），不需要再扩大代码改动面。
