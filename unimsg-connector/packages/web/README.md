# @unimsg/web · LinkHub 统一消息中心（前端）

赛题 A 的展示层与处理层：把飞书 / 钉钉 / 企业微信的消息收敛到一个收件箱，支持筛选、AI 建议、回复回写、待办完成与全链路回放。

当前版本为 **Mock 数据版**：不依赖后端即可完整演示闭环，接口形状已与 `documents/` 里的 API 契约对齐，后续切换真实后端不需要改页面。

## 启动

在 monorepo 根目录（`unimsg-connector/`）执行：

```bash
pnpm install
pnpm --filter @unimsg/web dev     # http://127.0.0.1:5173
```

其他命令：

| 命令 | 说明 |
|---|---|
| `pnpm --filter @unimsg/web build` | 生产构建 |
| `pnpm --filter @unimsg/web typecheck` | TypeScript 检查 |
| `pnpm --filter @unimsg/web test` | Vitest 单元测试 |

## 页面

| 路由 | 页面 | 说明 |
|---|---|---|
| `/inbox`、`/inbox/:traceId` | 统一收件箱 | 三栏布局：导航 + 消息列表 + 详情（AI 建议、状态流转、回复） |
| `/todos` | 待办 | `type=todo` 的消息，可直接标记完成 |
| `/trace`、`/trace/:traceId` | 全链路回放 | 按 traceId 展示接收 → AI → 处理 → 回写 → 回流的每一步 |
| `/accounts` | 平台账号 | 三平台配置状态与运行指标（只展示布尔值，不接触密钥） |

## 目录

```
src/
├── app/            AppShell、路由、AntD 主题
├── features/
│   ├── inbox/      InboxPage / MessageCard / DetailPanel / AiSuggestion / ReplyComposer / StatusFlow
│   ├── todos/      TodosPage
│   ├── trace/      TracePage
│   └── accounts/   AccountsPage
├── components/     PlatformTag / StatusBadge / IntentTag / AvatarBadge / EmptyState
├── services/
│   ├── api.ts          MessageApi 契约（含 DemoApi 扩展）
│   ├── realtime.ts     实时推送抽象（EmitterRealtime 为 Mock 实现）
│   └── mock/           fixtures 种子数据 + mockApi 内存实现
├── store/          appStore（可订阅状态）+ 单例装配
├── hooks/          useAppState
├── utils/          时间/平台/状态格式化
└── styles/         app.css（设计令牌 + 全部样式）
```

## Mock 与真实后端切换

只有一个装配点：`src/store/index.ts`。

```ts
// 现在
const realtime = new EmitterRealtime();
const api = new MockApi(realtime);

// 接后端后
const realtime = new WsRealtime('ws://127.0.0.1:3001/ws?token=dev-token');
const api = new HttpApi('http://127.0.0.1:3001', token);
```

页面只依赖 `MessageApi` 与 `RealtimeClient` 两个接口，因此切换时不需要改组件。Mock 的返回形状与后端一致：

- 列表：`{ ok: true, data: UnifiedMessage[] }`
- 回复：`202 { ok: true, message, taskId }`，随后通过 `message.updated` 推送 `sent` / `synced`
- 全链路：`{ ok: true, data, log: TraceEntry[] }`
- 实时事件：`message.received` / `message.updated` / `message.failed`

## Mock 演示

顶栏「演示」菜单（仅 Mock 模式显示）：

- 模拟平台推送一条新消息（会走接收 → AI 富化 → 列表高亮）
- 让下一次回复失败（演示 `failed` + 死信队列提示）
- 重置筛选条件

种子数据覆盖 3 平台、6 种状态、4 种消息类型，以及 OCR 低置信、意图回退「未分类」、发送失败等边界分支。

## 与后端联调前待办

1. 实现 `HttpApi`（`services/api.ts` 接口）与 `WsRealtime`（原生 WebSocket，token 走 query）。
2. 回复接口返回 `202` 后，把本地状态先置 `replied`，其余状态等待 WS 推送（当前 Mock 行为一致）。
3. 错误码映射：`400 text required` / `401 unauthorized` / `404 not found`。
4. 真实后端就绪后，删除 Mock 演示入口或按 `demoMode` 隐藏。