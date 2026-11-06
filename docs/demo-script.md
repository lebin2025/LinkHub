# LinkHub 现场演示脚本（5–8 分钟）

> 原则：**只演示当前真实可用的能力**（钉钉 Stream 收 + 机器人回写；邮箱 IMAP 收 + SMTP 发）；飞书/企微用 Mock 通道演示，并在界面和口头上都明确「这是模拟发送，没有调用真实平台」。做不到的不现场承诺。
> 操作人标记：**演示人**（讲 + 操作 UI/手机）/ **助手**（终端、起服务、灌消息）。
> 相关文档：[quickstart.md](quickstart.md) · [swap-accounts.md](swap-accounts.md) · [risk-register.md](risk-register.md) · [README.md](../README.md)

## 演示前 10 分钟检查清单

- [ ] `cd unimsg-connector && pnpm run doctor -- --platform=dingtalk,mail` → 全 PASS（看到 `✔ 自检通过`、退出码 0）
- [ ] `pnpm e2e` 跑一遍 → 20 条 PASS + `SMOKE OK`（离线全 Mock，证明环境没坏；约 10–20 秒）
- [ ] 起后端（在 `unimsg-connector/` 下，混合演示形态：飞书/企微 Mock，钉钉/邮箱真实）：
  - PowerShell：`$env:FEISHU_MODE="mock"; $env:WECOM_MODE="mock"` 后执行 `pnpm --filter @unimsg/server start`
  - bash：`FEISHU_MODE=mock WECOM_MODE=mock pnpm --filter @unimsg/server start`
  - 成功信号：`运行模式: 飞书=mock(mock) ... 钉钉=real(auto) ... 邮箱=real(auto)`、`[stream] 钉钉 Stream 已连接`、`[mail] ... 已连接，基线 UID=…`
- [ ] 前端：`packages/web/.env` 两行指向 `http://127.0.0.1:3001` / `dev-token` → `pnpm --filter @unimsg/web dev` → 打开 `http://127.0.0.1:5173`，左下角「已接入 LinkHub Server」，账号页 4 张卡正常
- [ ] 手机钉钉已登录且能找到机器人；另一个邮箱已登录可发信（怕等轮询可提前 5 分钟发一封）
- [ ] 群聊演示必须在群里 **@机器人**：钉钉/企微只推被 @ 的群消息，普通群消息平台根本不推送（别承诺"群里所有消息都能聚合"）；群里加的必须是**企业内部应用机器人**，自定义 Webhook 机器人只能发不能收
- [ ] 端口 3001 / 5173 空闲，关闭多余终端、录屏/会议软件；浏览器用无痕窗口
- [ ] **不要投屏** `.env`、doctor 全文；终端只显示清屏后的日志尾部（启动日志里的邮箱已脱敏，但仍不建议整屏投影）
- [ ] 如需现场演示企微真实发送：先确认当前出口 IP 仍在「企业可信 IP」内（`doctor` 会打印出口 IP），否则本场不演示

## 分镜脚本（总时长约 6–7 分钟）

| 时间 | 画面 | 操作 | 成功信号 / 话术 |
|---|---|---|---|
| 0:00–0:30 | 首页 | 演示人：一句话痛点「消息散在飞书/钉钉/企微/邮箱四个入口」→ 依次点侧边栏「收件箱 / 待办 / 全链路回放 / 平台账号」 | 「统一消息模型 + 四类数据源，换账号只改配置」 |
| 0:30–2:00 | 收件箱↔手机 | 演示人：手机钉钉**单聊**给机器人发「周五前交周报」（要演示群聊就在群里 @机器人；平台只推 @ 消息）；助手看收件箱 | 2 秒内新消息出现（WebSocket 推送，无需刷新）；点开详情能看到会话（单聊 / 群聊「群名」）、发送人、意图=待办 |
| 2:00–2:45 | 详情→手机 | 演示人：在详情里回复「收到，周五前完成」 | 状态 `replied → sent → synced`；**手机钉钉收到回复**；「投递方式」显示「真实接口」 |
| 2:45–4:00 | 邮箱 | 演示人：另一个邮箱给被监听邮箱发中文邮件；等轮询（≤45s，或直接用提前发好的那封）→ 在 UI 回复 | 收件箱出现邮箱消息并带回信；发件邮箱收到 `Re:` 回信；话术「IMAP 收 + SMTP 发，同样不依赖公网回调」；若进垃圾箱如实说明 `FOLDERS=INBOX,Junk` |
| 4:00–5:00 | 收件箱 | 助手执行「Mock 消息注入」两条命令（见下），演示人讲解 | 飞书/企微消息进入收件箱；回复后「投递方式」为**模拟发送（未调用真实平台）**；话术「飞书卡租户策略 21001、企微卡可信 IP 60020，所以这两家今天用 Mock 通道；**Mock 一定标注，绝不假成功**，这是设计原则」 |
| 5:00–5:40 | 回放页 | 演示人：复制 traceId → 打开「全链路回放」 | 事件链 `received → intent → processing → replied → sent → synced`；Mock 的 sent/synced 写明「模拟发送/模拟状态回流」，真实钉钉那条写「真实接口」 |
| 5:40–6:20 | 账号页 | 演示人：指 4 张卡的 `mode` Tag、`policy`、缺失变量、warnings | 「钉钉/邮箱=真实接口，飞书/企微=Mock 模拟」；话术「换账号只改 `.env` + 一条 `pnpm run doctor` 自检，不改代码」 |
| 6:20–7:00 | 收尾 | 演示人：如实说边界 | 飞书需企业认证/合规租户；企微需可信 IP + 回调 Token/AESKey + 公网；**钉钉/企微群聊只能收 @机器人 的消息**（平台限制，非 @ 消息无法聚合）；PG/Redis、LLM/OCR、Docker 未实现（规则 Mock/内存）。边界清单见 [risk-register.md](risk-register.md) |

## Mock 消息注入（仅当后端以 `FEISHU_MODE=mock`、`WECOM_MODE=mock` 启动时）

```bash
node -e "const b={schema:'2.0',event:{message:{message_id:'om_demo_'+Date.now(),message_type:'text',content:JSON.stringify({text:'Demo: weekly report due Friday'}),sender:{sender_id:{user_id:'u_demo'}}}}};fetch('http://127.0.0.1:3001/api/webhook/feishu',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(r=>r.text().then(t=>console.log('feishu',r.status,t)))"
node -e "fetch('http://127.0.0.1:3001/api/webhook/wecom',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({MsgType:'text',Content:'Demo: weekly report due Friday',MsgId:'wx_demo_'+Date.now(),FromUserName:'u_demo'})}).then(r=>r.text().then(t=>console.log('wecom',r.status,t)))"
```

成功信号：`feishu 200 {"ok":true,...}`、`wecom 200 success`，收件箱各多一条。若返回 401，说明后端不是 Mock 模式（重启时漏了上面两个环境变量）。

## 如果评审要求「三平台真实收发」

- **先讲前提，不现场承诺**：飞书要求应用所在租户已完成企业认证/符合租户策略，否则 `21001`（改代码、改 Secret、加 IP 白名单都无效）；企微要求发信出口 IP 已加入「企业可信 IP」，并配齐回调 `Token` / `EncodingAESKey` + 公网回调地址，否则 `60020` / 收不到消息；钉钉 Stream 与邮箱不依赖公网，本机即可。
- **现场自证命令**（助手执行，演示人念结论）：

```bash
pnpm run doctor -- --platform=feishu        # 预期 FAIL 21001 +「企业认证/换合规租户」建议（外部限制，代码无解）
pnpm run doctor -- --platform=wecom         # gettoken 可能 PASS；若 60020，按建议把出口 IP 加入「企业可信 IP」
pnpm run doctor -- --platform=dingtalk,mail # 真实可用：全 PASS
```

- 话术：能力边界已如实写进 README「设计文档承诺 vs 当前实现」与 [risk-register.md](risk-register.md)，今天不演示未打通的通道，也不拿 Mock 冒充真实。

## 纯 Mock 兜底路线（断网 / 凭据失效 / Stream 连不上，约 2 分钟）

1. 停掉真实后端（`Ctrl+C`），以全 Mock 重启：
   - PowerShell：`$env:FEISHU_MODE="mock"; $env:DINGTALK_MODE="mock"; $env:WECOM_MODE="mock"; $env:MAIL_MODE="mock"; $env:DINGTALK_STREAM="false"; $env:MAIL_ENABLED="false"`
   - bash：`FEISHU_MODE=mock DINGTALK_MODE=mock WECOM_MODE=mock MAIL_MODE=mock DINGTALK_STREAM=false MAIL_ENABLED=false pnpm --filter @unimsg/server start`
2. 灌三平台演示消息：`python scripts/smoke.py http://127.0.0.1:3001`（20 项断言，自带 Mock 标注校验）
3. 刷新 UI → 收件箱出现消息；回复 → 「投递方式：模拟发送」
4. 打开任一条的回放 → 完整闭环 + 「模拟发送 / 模拟状态回流」日志
5. 账号页 4 张卡全部「Mock 模拟」→ 收尾话术：「同一套代码、同一套闭环，零账号也能演示；Mock 从不伪装成真实成功」

> 终端也可以直接跑 `pnpm e2e` 作为证据：输出里包含 `PASS Mock 回写如实标注 delivery.mode=mock` 与 `SMOKE OK`。
> 纯前端 Mock（不启后端）：先确认 `packages/web/.env` 不存在/已改名，再 `pnpm --filter @unimsg/web dev`，用顶栏「演示」菜单逐步演示。
