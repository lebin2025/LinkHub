# LinkHub 换账号指南（swap-accounts）

> 目标：评审 / 同学拿到仓库后，**只改 `unimsg-connector/.env`，不改一行代码**，就能用自己的飞书、钉钉、企业微信、邮箱账号把真实收发跑起来。
>
> 本文所有凭据一律用占位符表示（`xxxxxxxx` / `you@example.com` 形式），请勿把真实密钥、授权码、邮箱地址提交进 git 或发到群里。

本文覆盖：

- 换账号的 3 步快速路径与模式判定（为什么填了凭据还是 Mock）
- 四个平台各自的 checklist：**后台点什么 → 填哪些 env → 验证命令 → 常见报错**
- errcode 排错总表（21001 / 10014 / 60020 / 40013 / 535 / 550 / Unsafe Login / ENOTFOUND / ETIMEDOUT …）
- 邮箱 provider 预设表、端口与加密方式表、多账号写法
- 「企业可信 IP」与飞书企业认证的现实说明
- 安全与回滚

---

## 0. 先读：四条约定

1. **只改 `.env`**：平台凭据、邮箱账号、运行模式全部走环境变量，代码不需要动。改完**重启后端**（`config.ts` 只在启动时读取 `.env`）。
2. **换完账号先跑 `doctor`**：`pnpm run doctor` 会检查 Node、`.env`、平台模式、逐平台探针与出口公网 IP，并给出中文修复建议；有 FAIL 时退出码为 1。
3. **Mock 是合法状态，但一定标注**：没配凭据或配得不全时，`auto` 会自动回退本地模拟；回写消息里会写 `delivery.mode=mock`，闭环日志与前端都显示「模拟发送」，**不会假装真实平台已收到**。
4. **命令写法**：在 `unimsg-connector/` 目录下用 `pnpm run doctor`；**不要写 `pnpm doctor`**——pnpm 9 自带同名内置命令（诊断 pnpm 自身），会抢走本项目命令。在脚本 / CI 里推荐全路径：`pnpm --filter @unimsg/server run doctor`。

> 更多架构、API、测试说明见根目录 [README.md](../README.md)。

---

## 1. 换账号 3 步

```bash
cd unimsg-connector

# 1) 复制模板
cp .env.example .env              # Windows PowerShell：Copy-Item .env.example .env

# 2) 只填“目标平台”那一段，其他平台留空即可（留空 = auto 回退 Mock）
#    飞书 / 钉钉 / 企业微信 / 邮箱的变量见下面各平台 checklist

# 3) 自检（只读，不发任何业务消息），通过后再启动
pnpm run doctor
pnpm --filter @unimsg/server start
```

按目标平台选择自检命令：

```bash
pnpm run doctor -- --platform=feishu      # 只查飞书
pnpm run doctor -- --platform=dingtalk    # 只查钉钉
pnpm run doctor -- --platform=wecom       # 只查企业微信
pnpm run doctor -- --platform=mail        # 只查邮箱
pnpm run doctor -- --platform=feishu,mail # 多个平台用逗号
```

机器可读 JSON（stdout 严格只有 JSON，便于 CI / 脚本消费）：

```bash
pnpm --filter @unimsg/server run --silent doctor -- --json
```

> `--json` 场景必须加 `--silent` 且用**全路径**：`pnpm run doctor -- --json` 会把 pnpm 启动横幅写进 stdout，破坏 JSON。

「换账号」可以只换一个平台，例如只把钉钉换成自己的应用：改 `DINGTALK_*` 四个变量 → `pnpm run doctor -- --platform=dingtalk` → 重启后端。飞书 / 企微 / 邮箱的配置不受影响。

---

## 2. 先搞懂模式，避免误判

| `*_MODE` | 行为 | 凭据不全时 |
|---|---|---|
| `auto`（默认） | 具备真实收或真实发能力 → 真实接口；否则本地 Mock | 自动回退 Mock，`/api/accounts` 的 `reason` 说明原因 |
| `real` | 强制真实接口 | 发送时显式报错并列出缺失变量，**绝不静默假成功** |
| `mock` | 强制本地模拟（填了凭据也不外呼） | 不适用，适合离线演示 |

- 变量名：`FEISHU_MODE` / `DINGTALK_MODE` / `WECOM_MODE` / `MAIL_MODE`。
- 旧全局 `MOCK` 已废弃：只在没写 `*_MODE` 时作为默认策略（`true→mock`、`false→real`），启动日志和 doctor 都会警告；请删除它。
- `auto` 下邮箱有特例：`MAIL_ENABLED=false`（关轮询）时按 Mock 处理；需要「只发不收」请显式 `MAIL_MODE=real`。
- 每个平台解析出的 `policy / mode / configured / canSend / canReceive / missing / warnings / reason` 在三处一致：`/api/accounts`、启动日志、`doctor`。
- 想确认「现在到底走没走真实接口」：

```bash
curl http://127.0.0.1:3001/api/health
# 看 modes：{"feishu":"real","dingtalk":"mock","wecom":"mock","mail":"mock"}
curl -H "Authorization: Bearer dev-token" http://127.0.0.1:3001/api/accounts
# 看每个平台的 mode / policy / missing / reason；邮箱另有 accounts[] 明细（地址脱敏）
```

**为什么填了凭据还是 mock？** 按顺序排查：

1. 是不是显式写了 `*_MODE=mock`？
2. 该平台是否缺关键变量（看 `/api/accounts` 的 `missing`，例如飞书缺 `FEISHU_VERIFY_TOKEN` 只影响收，不影响 `mode=real`，但收不到消息）？
3. 邮箱是不是被 `MAIL_ENABLED=false` 关了轮询（`auto` 下按 Mock 处理）？
4. 改了 `.env` 但没重启后端（启动时读取）？

**为什么 doctor 里全是 SKIP？** SKIP 表示该平台当前未启用真实通道（`mode=mock` 且 `policy≠real`），doctor 按约定不发起真实探针；不是失败。填好凭据后 `auto` 会自动变 `real`，或临时加 `*_MODE=real` 强制自检。

---

## 3. 飞书 checklist

### 3.1 后台点什么

在 [飞书开放平台](https://open.feishu.cn/) 开发者后台：

1. **创建应用**：创建企业自建应用，填写名称与描述。
2. **凭证与基础信息**：复制 **App ID**、**App Secret**。注意 App Secret 别复制成 App ID。
3. **添加应用能力 → 机器人**（要收发机器人消息时需要）。
4. **权限管理**：开通
   - `im:message:send_as_bot`（以应用身份发送消息）——**发送必需**；
   - `im:message`（获取与发送单聊、群组消息）——接收 / 查询消息需要；未开通时可能收不到消息。
5. **事件与回调 → 事件配置**：
   - 订阅方式选「将事件发送至开发者服务器」，请求地址填 `https://<公网域名>/api/webhook/feishu`；
   - 添加事件 `im.message.receive_v1`（接收消息 v2.0）。
6. **事件与回调 → 加密策略**：复制 **Verification Token**（必填）、**Encrypt Key**（建议配置；配了就必须同步到 `.env`，否则解密失败）。
7. **版本管理与发布**：创建版本并发布（可用范围可先设「仅我可见」自测）。**不发布版本，事件订阅可能不生效。**
8. 配置回调 URL 时飞书会发 `url_verification` 挑战，本服务会自动回 `challenge`；这一步**不用**手动处理。

> 飞书没有 Stream 长连接模式，真实收消息需要公网可访问的回调地址（内网穿透 / 云服务器 / 反向代理均可）。只想本地演示时用 `FEISHU_MODE=mock`。

### 3.2 填哪些 env

```dotenv
FEISHU_MODE=auto
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FEISHU_VERIFY_TOKEN=xxxxxxxxxxxxxxxx
FEISHU_ENCRYPT_KEY=xxxxxxxxxxxxxxxx          # 后台没开加密策略可留空；开了必须填
# FEISHU_BASE_URL=https://open.feishu.cn       # 国际版 Lark / 代理网关才需要改
```

### 3.3 验证命令

```bash
pnpm run doctor -- --platform=feishu
```

期望输出形态（示意）：

```
[PASS] 飞书 tenant_access_token（应用凭据校验）
       结果：tenant_access_token 获取成功（有效期 7200s；只换取 token，未发送任何消息）。
  ✔ 自检通过：PASS 1 / FAIL 0 / SKIP 0。
  退出码：0
```

然后启动后端，用真实飞书账号给应用机器人发一条消息，再确认入库：

```bash
curl -H "Authorization: Bearer dev-token" http://127.0.0.1:3001/api/messages
curl -H "Authorization: Bearer dev-token" http://127.0.0.1:3001/api/accounts
```

### 3.4 常见报错

| 现象 | 原因 | 处理 |
|---|---|---|
| `21001 Access denied due to platform policy` | 租户级策略 / 合规限制，常见于未完成企业认证的租户 | 代码、Secret、IP 白名单、应用发布都救不了；见「现实说明」 |
| `10014` | App Secret 错误 | 回后台重新复制 App Secret（别复制成 App ID），更新后重跑 doctor |
| `10003` 或 `app_id not found` | App ID 不存在 / 应用被删除 | 核对 `FEISHU_APP_ID`，确认应用仍存在 |
| `99991663` | tenant_access_token 无效 | 重置 Secret 后旧 token 失效；重跑 doctor；核对 `FEISHU_BASE_URL` 与数据中心一致 |
| 配置回调 URL 时提示「请求地址不正确」 | 公网不可达，或域名/路径写错 | 确认 `https://<域名>/api/webhook/feishu` 可从公网访问；先 `curl -I` 验证 |
| 收到事件但返回 401 `verify failed` | `FEISHU_VERIFY_TOKEN` 与后台不一致 | 复制后台 Verification Token（不是 Encrypt Key） |
| 收到加密事件但报「未配置 FEISHU_ENCRYPT_KEY」 | 后台开了加密策略但 `.env` 没填 Encrypt Key | 填上 Encrypt Key 并重启 |
| 解密失败 / JSON 解析失败 | Encrypt Key 错误，或后台关闭加密但 `.env` 仍按加密处理 | 两处保持一致；改完重启 |
| 能发不能收 | 缺 `FEISHU_VERIFY_TOKEN`、事件未订阅、权限未开通或版本未发布 | 看 `/api/accounts` 的 `missing` / `warnings`，逐项补齐 |

### 3.5 现实说明：飞书 21001 与企业认证

飞书 `21001` 是**租户级平台策略**，不是配置错误。已实测排除的方向：错误 Secret（会报 `10014`）、IP 白名单（未开启）、应用未发布（已发布且启用）、测试企业通道（建测试企业并关联后仍 `21001`）。

常见解决路径：

1. 让应用挂在**已完成企业认证**的租户下（个人版 / 未认证租户常被拒）；
2. 开发者后台核对「安全设置 / 租户策略」是否禁止自建应用获取 token、「可用成员 / 部门范围」是否为空；
3. 换一个合规租户重新创建自建应用——**只需要改 `.env` 的 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`**，代码与其余配置不动；
4. 仍不通时按 doctor 建议走飞书客服 / 工单确认租户策略。

> 所以：飞书适配器、验签、加解密、发送、事件订阅代码均已就绪，`21001` 属于「换租户 / 走认证」才能解决的外部约束。

---

## 4. 钉钉 checklist

### 4.1 后台点什么

在 [钉钉开放平台](https://open-dev.dingtalk.com/) 开发者后台：

1. **创建应用**：企业内部应用。
2. **凭证与基础信息**：复制 **Client ID**、**Client Secret**（旧版后台叫 AppKey / AppSecret，本服务两种都兼容）。
3. **应用能力 → 机器人**：添加机器人，填名称 / 简介 / 消息预览图；**消息接收模式选「Stream 模式」**（推荐，本机免公网）或「HTTP 回调」。
4. 在机器人配置里获取 **RobotCode**（企业内部应用通常与 Client ID 相同，留空会自动回退 Client ID）。
5. **权限管理**：开通机器人发消息 / 消息相关权限。
6. **版本管理与发布**：发布版本，机器人配置才对外生效（可用范围可先「仅我可见」）。

### 4.2 填哪些 env（Stream 模式，推荐）

```dotenv
DINGTALK_MODE=auto
DINGTALK_CLIENT_ID=dingxxxxxxxxxxxxxxxx
DINGTALK_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
DINGTALK_ROBOT_CODE=dingxxxxxxxxxxxxxxxx      # 企业内部应用通常等于 Client ID
DINGTALK_STREAM=true                          # 本机长连接收消息，无需公网
```

HTTP 回调替代方案（有公网域名时）：

```dotenv
# DINGTALK_STREAM=false
DINGTALK_AES_TOKEN=xxxxxxxxxxxxxxxx           # 事件订阅的 Token
DINGTALK_AES_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  # 加密密钥
```

后台「事件订阅 → 推送方式」选 HTTP 推送，地址填 `https://<公网域名>/api/webhook/dingtalk`。

### 4.3 验证命令

```bash
pnpm run doctor -- --platform=dingtalk
```

期望输出形态（Stream 模式）：三条 PASS——accessToken 校验、机器人编码、收消息通道；且 Stream 模式下不再把 AES Token/Key 误报为缺失。

```
[PASS] 钉钉 accessToken（应用凭据校验）
[PASS] 钉钉机器人编码（DINGTALK_ROBOT_CODE）
[PASS] 钉钉收消息通道（Stream 长连接 / HTTP 回调）
  ✔ 自检通过：PASS 3 / FAIL 0 / SKIP 0。
```

启动后端后，日志应出现 `[stream] 钉钉 Stream 已连接，机器人消息将实时入库`；在钉钉里给机器人发消息即入库，再调 `POST /api/messages/:traceId/reply` 会真实发回。

### 4.4 常见报错

| 现象 | 原因 | 处理 |
|---|---|---|
| `40089` / `InvalidAuthentication` | Client ID / Secret 错误 | 回后台复制，更新 `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET`（旧名 AppKey/AppSecret 也兼容） |
| `40001` / `40014` | accessToken 无效 / 环境不对 | 核对 `DINGTALK_BASE_URL`，确认应用已发布 |
| 提示无权限 / forbidden | 机器人 / 消息权限未开通，或未发布版本 | 权限管理开通后重新发布版本 |
| 启动后收不到消息 | 后台机器人消息接收模式不是 Stream，或应用版本未发布，或 `DINGTALK_STREAM` 未开 | 改后台模式 → 发版本 → `.env` 设 `DINGTALK_STREAM=true` → 重启后端 |
| HTTP 回调 401 | AES Token / Key 不一致，或时间戳超出容忍窗口 | 后台 Token / AES Key 与 `.env` 对齐；确认服务器时间正确 |
| 发送群消息报缺 `conversation.id` | 收到的消息没有会话信息 | 确认走的是机器人消息事件（Stream / 事件订阅），不是纯文本 webhook 自造数据 |

> 钉钉实测记录（2026-11-03）：Stream 模式在本机无公网条件下完成「手机发消息 → 入库 → 调接口回写 → 机器人消息回到钉钉会话」全流程；`accessToken` 用真实 Client ID/Secret 换取成功，未认证企业也可用。

---

## 5. 企业微信 checklist

### 5.1 后台点什么

在 [企业微信管理后台](https://work.weixin.qq.com/)：

1. **我的企业 → 企业信息**：复制 **企业ID** → `WECOM_CORP_ID`。
2. **应用管理 → 自建 → 创建应用**：填名称 / logo / 可见范围。
3. **应用详情页**：复制 **AgentId** → `WECOM_AGENT_ID`；点 **Secret 的「眼睛」图标**复制 Secret → `WECOM_SECRET`（**不要点重置**，重置后旧 Secret 立即失效）。
4. 该应用 → **接收消息 → 设置 API 接收**：
   - URL：`https://<公网域名>/api/webhook/wecom`
   - 随机生成 **Token** → `WECOM_TOKEN`
   - 随机生成 **EncodingAESKey**（43 位）→ `WECOM_AES_KEY`
5. **应用详情 → 企业可信 IP**：把**发信出口公网 IP** 加进去。不知道出口 IP 时：
   - 先跑 `pnpm run doctor -- --platform=wecom`，若返回 60020，doctor 会直接打印当前出口 IP；
   - 或访问 `https://ifconfig.me/ip` 查看。
6. 确认应用「可见范围」包含需要收发的成员。

> 企业微信回调 URL 必须公网可达，且 GET 握手要通过：服务会校验 SHA1 签名并解密 `echostr` 后回明文。**配置 Token / AES Key 之前，URL 验证不会通过。**

### 5.2 填哪些 env

```dotenv
WECOM_MODE=auto
WECOM_CORP_ID=wwxxxxxxxxxxxxxxxx
WECOM_AGENT_ID=1000002
WECOM_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
WECOM_TOKEN=xxxxxxxxxxxxxxxx
WECOM_AES_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx   # 43 位
# WECOM_BASE_URL=https://qyapi.weixin.qq.com                  # 一般不用改
```

### 5.3 验证命令

```bash
pnpm run doctor -- --platform=wecom
```

期望：`[PASS] 企业微信 access_token（应用凭据校验）`，退出码 0。若返回 **60020**，doctor 会打印当前出口公网 IP 与「加入企业可信 IP」的操作步骤。

启动后端后，日志会提示当前能力：

```
[unimsg] 运行模式: … | 企业微信=real(auto) 收✓ 发✓
```

拿到真实消息后再验证回写：

```bash
curl -X POST -H "Authorization: Bearer dev-token" -H "Content-Type: application/json" \
  -d '{"text":"收到"}' http://127.0.0.1:3001/api/messages/<traceId>/reply
curl -H "Authorization: Bearer dev-token" http://127.0.0.1:3001/api/messages/<traceId>
# 看 delivery.mode 是否为 real、status 是否到 synced
```

### 5.4 常见报错

| 现象 | 原因 | 处理 |
|---|---|---|
| `60020 not allow to access from your ip` | 发信出口 IP 不在「企业可信 IP」 | 把 doctor 显示的出口 IP 加入应用「企业可信 IP」，保存后等约 1 分钟再重跑；换网络 / 换机器后出口 IP 会变，需要重新加 |
| `40013 invalid corpid` | `WECOM_CORP_ID` 错误 | 用「我的企业 → 企业信息」里的企业ID，别和 AppID / AgentId 搞混 |
| `40001 invalid credential` | `WECOM_SECRET` 错误或已重置 | 应用详情页「眼睛」重新复制 Secret，别点重置 |
| `40014` / `41001` | access_token 无效 / 缺失 | 核对 `WECOM_BASE_URL` 与代理设置；doctor 每次都会换新 token，正常不应出现 |
| `60011` | 应用无权限 / 不在可见范围 | 把成员 / 部门加入应用可见范围 |
| 设置 API 接收时提示「URL 验证失败」 | 公网不可达 / Token / AESKey 不一致 | 确认 URL 公网可访问、Token 与 EncodingAESKey 完整复制（43 位）并重启 |
| 收到回调但 401 | 签名校验失败 | 后台 Token / EncodingAESKey 与 `.env` 对齐；确认服务器时间正确 |
| 能发不能收 | 缺 `WECOM_TOKEN` / `WECOM_AES_KEY` | 看 `/api/accounts` 的 `missing` / `warnings`，补齐后重启 |

### 5.5 现实说明：企业可信 IP

`60020` 的本质是**出口 IP 白名单**，与账号密码无关：

- 企业微信要求的不是「服务器内网 IP」，而是请求发到腾讯时看到的**公网出口 IP**；
- 家用宽带 / 动态 IP 会变化，今天加白明天可能又 60020；
- 正式部署建议用云服务器弹性公网 IP / 固定专线出口，把该 IP 固定加入可信 IP；
- 走公司代理 / VPN 时，出口 IP 是代理的，需要加代理的 IP；
- 保存可信 IP 后通常需要约 1 分钟生效，重跑 doctor 确认变 PASS。

> 当前项目状态：企微适配器（SHA1 验签、AES 加解密、XML 解析、GET 握手、`gettoken` → `message/send`）与 19 条单测已完成，`gettoken` 已实测 PASS；真实发送**卡在可信 IP** 这一步。这属于外部部署约束，不需要改代码。

---

## 6. 邮箱 checklist（任意数量 / 任意服务商）

邮箱是第 4 类数据源，**不需要公网地址**：IMAP 本机收、SMTP 本机发。账号数量与服务商都不限，只要该服务商开放 IMAP/SMTP 且允许授权码（或应用专用密码）登录。

### 6.1 先开通 IMAP/SMTP 并拿授权码

> 授权码 **不是**网页登录密码，且通常只显示一次，当场复制。

| 服务商 | 网页端操作 |
|---|---|
| QQ 邮箱 | 设置 → 账号与安全 → 安全设置 → `POP3/IMAP/SMTP… 服务` → 开启服务（需先通过密保，通常要短信验证）→ 生成授权码 |
| 163 / 126 / yeah | 设置 → POP3/SMTP/IMAP → 开启服务（短信验证）→ 新增授权密码（只显示一次） |
| Gmail | 先开启两步验证 → 生成「应用专用密码」；企业 / 学校 Workspace 可能被管理员关闭 IMAP 或基础认证，需管理员放行 |
| Outlook / Microsoft 365 | 可能需要应用专用密码；部分租户关闭 SMTP AUTH / 基础认证，只能用 OAuth（本服务暂未实现 OAuth） |
| iCloud | Apple ID → 安全 → App 专用密码；确认已开启 IMAP |
| 自建 / 企业邮局（custom） | 找管理员确认 IMAP/SMTP host、端口、加密方式，并确认允许「授权码 / 客户端密码」登录 |

### 6.2 两种写法

**写法 A：自动发现（推荐，账号增删无需改顺序）**——只要填 `MAIL_<KEY>_ADDRESS` / `MAIL_<KEY>_AUTH_CODE` 就会被识别：

```dotenv
MAIL_MODE=auto
MAIL_QQ_ADDRESS=you@qq.com
MAIL_QQ_AUTH_CODE=your-qq-auth-code
MAIL_163_ADDRESS=you@163.com
MAIL_163_AUTH_CODE=your-163-auth-code
```

**写法 B：`MAIL_ACCOUNTS` 显式声明要启用的账号**（只加载列出的 key，顺序按你写的来）：

```dotenv
MAIL_ACCOUNTS=qq,163,work
```

- `KEY` 可随意取（`qq` / `163` / `work` / `school2` …），会被大写后拼成环境变量名（`work` → `MAIL_WORK_*`）；`externalId` 里的账号前缀也用它。
- 写了 `MAIL_ACCOUNTS` 后，**只有列出的 key 会被加载**；未列出的即使填了 `MAIL_<KEY>_ADDRESS` 也不会启用（想用自动发现就别写 `MAIL_ACCOUNTS`）。
- 在 `MAIL_ACCOUNTS` 里列了但没有填地址 / 授权码的 key 会给出警告并跳过，不会静默生效。
- 同一服务商可以挂多个账号（`MAIL_QQ_ADDRESS` 与 `MAIL_QQ2_ADDRESS` 等，key 不重复即可）。
- **不建议**把同一个邮箱地址配成两个 key：会产生两条轮询会话，语义混乱。

### 6.3 provider 预设表

不写 `MAIL_<KEY>_PROVIDER` 时按邮箱域名自动推断；写错 / 未知服务商请用 `custom` 并显式填 host。

| provider | 服务商 | IMAP 默认 | SMTP 默认 | 说明 |
|---|---|---|---|---|
| `qq` | QQ 邮箱 | `imap.qq.com:993` 隐式 TLS | `smtp.qq.com:465` 隐式 TLS | 域名 `qq.com` |
| `foxmail` | Foxmail | `imap.qq.com:993` | `smtp.qq.com:465` | 域名 `foxmail.com`（推断为 qq） |
| `163` | 网易 163 | `imap.163.com:993` | `smtp.163.com:465` | 反垃圾可能进 Junk |
| `126` | 网易 126 | `imap.126.com:993` | `smtp.126.com:465` | — |
| `yeah` | 网易 Yeah | `imap.yeah.net:993` | `smtp.yeah.net:465` | — |
| `gmail` | Gmail | `imap.gmail.com:993` | `smtp.gmail.com:465` | 需应用专用密码 |
| `outlook` | Outlook / Microsoft 365 | `outlook.office365.com:993` | `smtp.office365.com:587` STARTTLS | 部分租户关闭 SMTP AUTH |
| `icloud` | iCloud | `imap.mail.me.com:993` | `smtp.mail.me.com:587` STARTTLS | 用 App 专用密码 |
| `custom` | 自定义邮箱 | 无默认，必须填 | 无默认，必须填 | 企业邮局 / 自建域名 |

按域名推断的别名：`qq.com` / `foxmail.com → qq`，`163.com → 163`，`126.com → 126`，`yeah.net → yeah`，`gmail.com` / `googlemail.com → gmail`，`outlook.com` / `hotmail.com` / `live.com` / `msn.com` / `office365.com → outlook`，`icloud.com` / `me.com` / `mac.com → icloud`；其他域名 → `custom`（必须显式填 host）。

### 6.4 端口与加密方式

| 用途 | 端口 | 加密方式 | 说明 |
|---|---|---|---|
| IMAP | `993` | 隐式 TLS（默认） | 连接即 TLS，最常用 |
| IMAP | `143` | STARTTLS | 先明文 greeting → `STARTTLS` 升级 → 再登录 |
| SMTP | `465` | 隐式 TLS（默认） | 连接即 TLS，最常用 |
| SMTP | `587` | STARTTLS | EHLO → `STARTTLS` → 重新 EHLO → 认证 |
| SMTP | `25` | STARTTLS | 很多云厂商封 25 端口，不建议 |
| 任意 | `*_IMAP_SECURE` / `*_SMTP_SECURE` | `true`=隐式 TLS，`false`=STARTTLS | 不写时按端口自动推断（993/465→true，143/587/25→false） |

安全约束：明文链路上如果服务端不声明 `STARTTLS`，客户端会**直接报错，绝不降级成明文认证**。

### 6.5 监听目录

- 默认只监听 `INBOX`；反垃圾 / 规则把回信扔进垃圾箱时用 `MAIL_<KEY>_FOLDERS=INBOX,Junk` 一起监听。
- 多个目录用逗号（或分号 / 空格）分隔；目录名区分大小写、不要加引号。
- `externalId` 形如 `<key>:<目录>:<UID>`（如 `qq:Junk:7`），多账号、多目录不会互相吞消息。
- 首轮轮询只记录每个账号每个目录的最大 UID 作为**基线**，不会把历史邮件灌进中枢；之后只导入水位之后的新信。

### 6.6 验证命令

```bash
pnpm run doctor -- --platform=mail
```

期望：每个账号两条 PASS（IMAP 登录基线 + SMTP 登录自检；2 个账号即 PASS 4），地址自动脱敏：

```
[PASS] 邮箱 IMAP 登录基线（1******@163.com）
       结果：登录 imap.163.com:993 成功并 SELECT INBOX，当前 UID 基线 …（只做 UID SEARCH，未读取正文、未标记已读）。
[PASS] 邮箱 SMTP 登录自检（1******@163.com）
       结果：登录 smtp.163.com:465 认证成功（PLAIN 机制，链路已加密）；只登录 + QUIT，未发送任何邮件。
  ✔ 自检通过：PASS 4 / FAIL 0 / SKIP 0。
```

2026-11-04 实测：两个真实邮箱账号（163 + QQ）`--platform=mail` → **PASS 4 / FAIL 0**。启动后端后日志应出现：

```
[mail] 轮询已启动，间隔 45s，账号：QQ邮箱[INBOX,Junk]@imap.qq.com / 网易163邮箱[INBOX]@imap.163.com
[mail] QQ邮箱/INBOX 已连接，基线 UID=…，历史邮件不入库
```

给该邮箱发一封新邮件，约一个轮询周期后应能在 `/api/messages` 看到 `platform=mail`；回复它会经 SMTP 真实发出。

### 6.7 多账号完整示例（含自定义服务商）

```dotenv
# ---- 邮箱：任意数量、任意服务商 ----
MAIL_MODE=auto
MAIL_POLL_SECONDS=45
MAIL_ACCOUNTS=qq,163,work

# 账号一：QQ（内置预设）
MAIL_QQ_ADDRESS=you@qq.com
MAIL_QQ_AUTH_CODE=your-qq-auth-code
MAIL_QQ_FOLDERS=INBOX,Junk

# 账号二：163（内置预设）
MAIL_163_ADDRESS=you@163.com
MAIL_163_AUTH_CODE=your-163-auth-code

# 账号三：公司邮箱（无内置预设，必须显式 host；587 自动 STARTTLS）
MAIL_WORK_ADDRESS=you@company.com
MAIL_WORK_AUTH_CODE=your-corp-auth-code
MAIL_WORK_PROVIDER=custom
MAIL_WORK_LABEL=公司邮箱
MAIL_WORK_IMAP_HOST=imap.company.com
MAIL_WORK_SMTP_HOST=smtp.company.com
MAIL_WORK_IMAP_PORT=993
MAIL_WORK_SMTP_PORT=587
MAIL_WORK_FOLDERS=INBOX,Junk
```

### 6.8 常见报错

| 现象 / 关键词 | 原因 | 处理 |
|---|---|---|
| `Unsafe Login` | 网易 / QQ 风控：不报客户端身份的连接被拒，或用了登录密码而非授权码 | 检查授权码；本项目 IMAP 客户端已自动发送 ID 命令，仍报错通常是服务商风控，换网络重试或联系服务商 |
| `IMAP 登录失败` / `authenticationfailed` | 授权码错误、未开启 IMAP、或用了网页密码 | 回网页端重新开启 IMAP/SMTP 并生成授权码（16 位左右，别带空格） |
| SMTP `535` / `534` / `530` | 认证失败：授权码错 / 未开 SMTP / 服务商关闭基础认证 | 重新生成授权码；Gmail 用应用专用密码；企业邮箱找管理员确认 |
| SMTP `550` / `553` | 发信被拒：发信地址与登录账号不一致，或收件人被限制 | 用账号本人地址发信（本项目已固定）；核对收件人；企业邮箱确认外发权限 |
| SMTP `421` / `450` / `451` / `452` | 临时限流 / 反垃圾 | 降低频率、稍后重试；自测频繁可换账号 |
| SMTP `554` | 被判垃圾邮件 / 未开通发信 | 先用网页端正常收发几封；确认已开通 SMTP；必要时联系服务商 |
| `STARTTLS` 不可用 / 未声明 STARTTLS | 端口与加密方式不匹配，或服务端不支持 STARTTLS | 优先改 `465` 隐式 TLS；`587` 才用 STARTTLS；检查 `*_SMTP_SECURE` 与端口 |
| `ENOTFOUND` / `EAI_AGAIN` | 域名解析失败，host 写错 / DNS 异常 | 核对 `MAIL_<KEY>_IMAP_HOST` / `_SMTP_HOST`（不要带端口、协议前缀、空格）；`nslookup imap.qq.com` 验证 |
| `ETIMEDOUT` / 连接超时 | 网络不通 / 端口被公司网络或防火墙拦截 | 换网络（手机热点）验证；公司网络常封 25/465/587；检查代理 / VPN |
| `ECONNREFUSED` | 端口未开放或中间设备拒绝 | 核对端口与加密方式；关闭代理后重试 |
| `SELECT <目录> 失败` | `MAIL_<KEY>_FOLDERS` 目录名不对 | 收件箱用 `INBOX`、垃圾箱用 `Junk`（区分大小写，不要引号） |

### 6.9 邮箱行为说明

- 邮箱**没有平台回调**：真实模式下 `POST /api/webhook/mail` 一律验签失败，邮件只能由本机 IMAP 轮询 ingest（防伪造的有意设计）；Mock 模式仍可用演示签名走通闭环。
- 轮询默认 45s 一轮（`MAIL_POLL_SECONDS`，最小 5），不是实时推送。
- IMAP 的 UID 水位存在内存里：重启会重新立基线，**重启间隙到达的邮件会被跳过**。
- 入库正文为「主题 + 正文」，合计截断到约 2000 字符（中枢与 LLM 只需要要点）。
- 回写走 SMTP：主题自动加 `Re:`、带 `In-Reply-To` 串联会话；发信地址固定为登录账号（否则 QQ / 网易会判冒用）。
- 取正文用 `BODY.PEEK[]`，不会改动你邮箱里的已读状态。

---

## 7. errcode / 报错总表

> 下表中的建议与 `pnpm run doctor` 输出的中文修复建议一致；换账号时优先照 doctor 的建议做。

| 平台 | 错误码 / 关键词 | 含义 | 处理 |
|---|---|---|---|
| 飞书 | `21001` | 租户策略 / 合规限制，无法换 tenant_access_token | 企业认证或换合规租户；改 Secret / IP / 代码无效 |
| 飞书 | `10014` | App Secret 错误 | 回后台重新复制 Secret |
| 飞书 | `10003` | App ID 不存在 / 应用被删除 | 核对 `FEISHU_APP_ID` |
| 飞书 | `99991663` | tenant_access_token 无效 | 重置 Secret 后旧 token 失效；重跑 doctor；核对 base URL |
| 飞书 | `401 verify failed` | Verification Token 不一致 | 对齐 `FEISHU_VERIFY_TOKEN` |
| 钉钉 | `40089` / `InvalidAuthentication` | Client ID / Secret 错误 | 重新复制 `DINGTALK_CLIENT_ID` / `_CLIENT_SECRET` |
| 钉钉 | `40001` / `40014` | accessToken 相关错误 | 核对 `DINGTALK_BASE_URL`；确认应用已发布 |
| 钉钉 | 机器人无权限 / 收不到消息 | 机器人能力未开、未发布、接收模式不是 Stream | 后台改接收模式 → 发布版本 → `DINGTALK_STREAM=true` → 重启 |
| 企微 | `60020` | 出口 IP 不在「企业可信 IP」 | 把 doctor 显示的出口 IP 加白；用稳定公网出口 |
| 企微 | `40013` | 企业ID 错误 | 用「我的企业 → 企业信息」的企业ID |
| 企微 | `40001` | Secret 错误 / 已重置 | 应用详情「眼睛」重新复制 |
| 企微 | `40014` / `41001` | access_token 无效 / 缺失 | 核对 `WECOM_BASE_URL` 与代理 |
| 企微 | `60011` | 应用无权限 / 不在可见范围 | 调整应用可见范围 |
| 企微 | URL 验证失败 | 公网不可达，或 Token / EncodingAESKey 不一致 | 核对 URL 公网可达、`WECOM_TOKEN` / `WECOM_AES_KEY` 完整 |
| 邮箱 | `Unsafe Login` | 服务商风控 | 用授权码；客户端已发 ID；仍失败换网络 / 联系服务商 |
| 邮箱 | IMAP 登录失败 / auth failed | 授权码 / IMAP 开关问题 | 重新生成授权码，确认已开启 IMAP |
| 邮箱 | SMTP `535` / `534` / `530` | 认证失败 | 授权码 / 应用专用密码 / 服务商基础认证限制 |
| 邮箱 | SMTP `550` / `553` | 发信被拒 | 发信地址=登录账号；核对收件人 / 外发权限 |
| 邮箱 | `421` / `450` / `451` / `452` / `554` | 限流 / 反垃圾 | 降频、稍后重试、换账号 / 联系服务商 |
| 邮箱 | `STARTTLS` 相关 | 端口与加密方式不匹配 | 465 隐式 TLS 优先；587/143 才用 STARTTLS |
| 邮箱 | `ENOTFOUND` / `EAI_AGAIN` | DNS / host 写错 | 核对 host（不带端口/协议前缀），`nslookup` 验证 |
| 邮箱 | `ETIMEDOUT` / `ECONNREFUSED` | 网络 / 端口被拦 | 换网络；检查代理 / VPN / 防火墙 |
| 通用 | `401`（业务接口） | API_TOKEN 不一致 | 前端 `VITE_API_TOKEN` 与后端 `API_TOKEN` 一致 |
| 通用 | `1008 unauthorized`（WS） | WS token 错误 | 同上，`/ws?token=<API_TOKEN>` |

---

## 8. 安全与回滚

- **凭据只放 `.env`**：`unimsg-connector/.env` 已被 `.gitignore` 忽略；仓库只保留 `.env.example`（全占位符）。不要 `git add -f .env`，不要把授权码贴进 issue / 截图 / 聊天记录。
- **`VITE_` 红线**：任何 `*SECRET` / `*KEY` / `*TOKEN` 都不能加 `VITE_` 前缀，否则会被打进前端构建产物。前端只拿业务入口 token（`VITE_API_TOKEN`）。
- **doctor 是只读的**：只做换取 token / IMAP SEARCH 立基线 / SMTP 登录 + QUIT，不发送任何业务消息；报告中的邮箱地址自动脱敏，但把报告贴出去前仍建议人工再看一眼。
- **换错账号 / 想回滚**：
  - 临时离线演示：把对应平台改成 `*_MODE=mock`（或四个都改），重启即可，不需要删凭据；
  - 恢复旧配置：用你的 `.env` 备份覆盖后重启；
  - 凭据泄露：立刻在平台后台重置 Secret / 重新生成授权码，更新 `.env` 后重启；旧值会立即失效。
- **改完 `.env` 必须重启**：后端只在启动时读取；前端 Vite 也只在 dev server 启动时读取 `packages/web/.env`。

---

## 9. FAQ

**Q：我填了真实凭据，但 `/api/health` 的 `modes` 还是 mock？**
A：按顺序查：① 是否显式 `*_MODE=mock`；② `/api/accounts` 的 `missing` / `reason` 是否说明凭据不足；③ 邮箱是否 `MAIL_ENABLED=false`；④ 是否改完没重启后端。

**Q：doctor 显示 SKIP，是失败吗？**
A：不是。SKIP 表示该平台当前未启用真实通道（`mode=mock` 且不是强制 `real`），doctor 按约定不发起真实探针。退出码只看 FAIL 与 Node 版本：全 PASS / SKIP → 0，有 FAIL → 1。

**Q：Mock 模式下的「发送成功」是真的发出去了吗？**
A：不是真实平台发送。消息里 `delivery.mode=mock`、闭环日志写「模拟发送（本地 Mock，未调用真实平台接口）」、`/api/health.sentMock` 单独计数、前端标「模拟发送」。这正是「绝不假成功」的约定。

**Q：换账号后旧消息还在吗？**
A：不在。消息、闭环日志、DLQ 都在内存里，重启即清空；邮箱首轮也只立 UID 基线，不会把历史邮件灌进来。

**Q：邮箱换账号后要重新开 IMAP 吗？**
A：新的邮箱账号都要在网页端开启 IMAP/SMTP 并生成授权码；同一账号只换密码 / 重新生成授权码时，更新 `.env` 后重跑 doctor 即可。

**Q：为什么邮箱回信会进垃圾箱？**
A：反垃圾行为不可预测（同一发件人不同轮次可能进 `Junk` 或 `INBOX`）。把 `MAIL_<KEY>_FOLDERS` 设为 `INBOX,Junk` 一起监听，`externalId` 会带目录名，不会和收件箱的 UID 撞车。

**Q：企业微信为什么会 60020，加白后还报？**
A：确认加的是**当前真实出口公网 IP**（公司代理 / VPN / 家庭宽带 / 云服务器各不相同），保存后等约 1 分钟；IP 变化后需要重新加。用 `pnpm run doctor -- --platform=wecom` 可看到当前出口 IP。

**Q：飞书 21001 能靠改配置解决吗？**
A：不能。21001 是租户级策略，已排除 Secret（10014）、IP 白名单、应用未发布、测试企业通道等因素；需要企业认证或换合规租户，换租户后只改 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 即可。

**Q：如何完全离线演示给评审？**
A：四个平台都设 `*_MODE=mock`（或什么都不填，`auto` 自动 Mock），启动后端 + 前端即可走通「收件箱 → 回复 → 回放」；或直接 `pnpm e2e`（强制四平台 mock，完全离线，20 项断言 + `SMOKE OK`）。

**Q：`pnpm doctor` 为什么输出的是 pnpm 自己的诊断？**
A：pnpm 9 自带同名内置命令。本项目命令必须写 `pnpm run doctor`（或全路径 `pnpm --filter @unimsg/server run doctor`）。
