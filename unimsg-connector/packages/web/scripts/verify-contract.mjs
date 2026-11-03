/**
 * 前端 ↔ 后端契约自检（可复用）。
 *
 * 目的：把 HttpApi / WsRealtime 对后端形状的所有假设变成可执行断言，
 * 防止后端改动后前端「静默错位」。不管理后端进程，需先启动 server。
 *
 * 覆盖：health 计数字段 + 四平台实际通道 modes、accounts 的
 * mode/policy/missing/canReceive/canSend 与邮箱多账号、reply 后的
 * delivery.mode 投递方式、trace 闭环日志、WS 握手。
 *
 * 用法：
 *   pnpm --filter @unimsg/server start            # 另开终端
 *   node scripts/verify-contract.mjs [baseUrl] [token]
 *
 * 默认 baseUrl=http://127.0.0.1:3001，token=dev-token（与后端 API_TOKEN 一致）
 */
const base = (process.argv[2] ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');
const token = process.argv[3] ?? 'dev-token';

let passed = 0;
let failed = 0;

function check(name, cond, extra = '') {
  const ok = Boolean(cond);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` | ${extra}` : ''}`);
  if (ok) passed += 1;
  else failed += 1;
}

async function req(method, path, { body, auth = true, headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(auth ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }
  return { status: res.status, data };
}

async function waitReady(timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch {
      // 服务尚未起来
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`后端未在 ${timeoutMs / 1000}s 内就绪：${base}`);
}

async function checkWebSocket() {
  if (typeof WebSocket === 'undefined') {
    console.log('SKIP  WebSocket（当前 Node 未提供全局 WebSocket，请在浏览器联调时验证）');
    return;
  }
  await new Promise((resolve) => {
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`);
    let done = false;
    const finish = (ok, msg) => {
      if (done) return;
      done = true;
      check('WS /ws 握手收到 connected', ok, msg);
      try {
        ws.close();
      } catch {
        // 已关闭
      }
      resolve();
    };
    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.data));
        if (parsed.type === 'connected') finish(true, 'connected');
      } catch {
        // 忽略非 JSON 帧
      }
    };
    ws.onerror = () => finish(false, '连接错误');
    ws.onclose = (ev) => finish(false, `关闭码 ${ev.code}`);
    setTimeout(() => finish(false, '3s 超时'), 3_000);
  });
}

async function main() {
  await waitReady();

  // 1. health（公共接口，HttpApi 解包后取计数字段与平台通道）
  const health = await req('GET', '/api/health', { auth: false });
  check('GET /api/health → {ok} + 计数字段', health.status === 200 && health.data?.ok === true);
  for (const key of ['received', 'deduped', 'sent', 'failed', 'dlq', 'sentMock']) {
    check(`health 含 ${key}`, key in (health.data ?? {}));
  }
  // 本次实际通道必须公开可见：评审 curl 一下就知道哪些平台是真接口、哪些是 Mock
  const modes = health.data?.modes ?? {};
  check('health 含 modes（各平台实际通道）', Object.keys(modes).length > 0);
  for (const platform of ['feishu', 'dingtalk', 'wecom', 'mail']) {
    check(
      `health.modes.${platform} ∈ real|mock`,
      modes[platform] === 'real' || modes[platform] === 'mock',
      String(modes[platform]),
    );
  }

  // 2. 灌一条飞书消息（webhook 走平台签名，不用 Bearer）
  const payload = {
    schema: '2.0',
    event: {
      message: {
        message_id: `om_contract_${Date.now()}`,
        message_type: 'text',
        content: JSON.stringify({ text: '契约自检消息' }),
        sender: { sender_id: { user_id: 'u_contract' } },
      },
    },
  };
  const hook = await req('POST', '/api/webhook/feishu', {
    body: payload,
    auth: false,
    headers: { 'x-signature': 'mock' },
  });
  check('POST /api/webhook/feishu → {ok}', hook.status === 200 && hook.data?.ok === true);

  // 3. 鉴权：无 token 必须 401
  const noAuth = await req('GET', '/api/messages', { auth: false });
  check('GET /api/messages 无 token → 401', noAuth.status === 401);

  // 4. list 信封
  const list = await req('GET', '/api/messages');
  const messages = list.data?.data ?? [];
  check('GET /api/messages → {ok, data: []}', list.status === 200 && Array.isArray(messages));
  check('list 至少 1 条消息', messages.length >= 1, `count=${messages.length}`);
  const id = messages[0]?.traceId;
  check('消息含 traceId', Boolean(id));

  // 5. accounts 信封 + 契约形状（HttpApi.accounts / 账号页逐项依赖）
  const accounts = await req('GET', '/api/accounts');
  const accountList = accounts.data?.data ?? [];
  check(
    'GET /api/accounts → {ok, data: [...]}',
    accounts.status === 200 &&
      accounts.data?.ok === true &&
      Array.isArray(accountList) &&
      accountList.length > 0,
    `count=${accountList.length}`,
  );
  // 每项都必须带「本次实际通道 / 策略 / 缺失变量 / 收发能力」——账号页据此打 Tag 与告警
  for (const field of ['mode', 'policy', 'missing', 'canReceive', 'canSend']) {
    check(
      `accounts 每项含 ${field}`,
      accountList.length > 0 && accountList.every((a) => field in a),
    );
  }
  check('accounts 每项 mode ∈ real|mock', accountList.every((a) => a.mode === 'real' || a.mode === 'mock'));
  check(
    'accounts 每项 policy ∈ auto|real|mock',
    accountList.every((a) => ['auto', 'real', 'mock'].includes(a.policy)),
  );
  check('accounts 每项 missing 为数组', accountList.every((a) => Array.isArray(a.missing)));
  check(
    'accounts 四平台齐全',
    ['feishu', 'dingtalk', 'wecom', 'mail'].every((p) => accountList.some((a) => a.platform === p)),
    accountList.map((a) => a.platform).join(','),
  );
  // 邮箱是多账号数据源：mail 项必须带 accounts 数组，前端账号页展示每个邮箱明细
  const mailAccount = accountList.find((a) => a.platform === 'mail');
  check('accounts 含 mail 且带 accounts 数组', Boolean(mailAccount) && Array.isArray(mailAccount?.accounts));
  if (Array.isArray(mailAccount?.accounts) && mailAccount.accounts.length > 0) {
    for (const field of ['key', 'address', 'imapHost', 'smtpHost', 'folders']) {
      check(`mail.accounts[] 每项含 ${field}`, mailAccount.accounts.every((m) => field in m));
    }
    check(
      'mail.accounts[] 每项 mode ∈ real|mock',
      mailAccount.accounts.every((m) => m.mode === 'real' || m.mode === 'mock'),
    );
  }

  if (!id) return;

  // 6. reply 202 回执（HttpApi.reply 依赖 message + taskId）
  const reply = await req('POST', `/api/messages/${encodeURIComponent(id)}/reply`, {
    body: { text: '契约自检回复' },
  });
  check('POST reply → 202 {ok, message, taskId}', reply.status === 202 && Boolean(reply.data?.taskId));
  check('reply 回执状态为 replied', reply.data?.message?.status === 'replied');

  // 7. 异步回写推进到 synced（WS 场景的最终态），并核对 delivery 投递方式
  let status = '';
  let finalMessage;
  for (let i = 0; i < 20; i += 1) {
    const one = await req('GET', `/api/messages/${encodeURIComponent(id)}`);
    finalMessage = one.data?.data;
    status = finalMessage?.status ?? '';
    if (status === 'synced' || status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  check('回写后状态推进到 synced', status === 'synced', `status=${status}`);
  // Mock / 真实都必须如实写 delivery.mode，前端据此标注「模拟发送（未调用真实平台）」
  check(
    'reply 后消息含 delivery.mode ∈ real|mock',
    ['real', 'mock'].includes(finalMessage?.delivery?.mode),
    String(finalMessage?.delivery?.mode),
  );
  check('reply 后消息含 delivery.at（ISO 时间）', typeof finalMessage?.delivery?.at === 'string');

  // 8. done 只回 {ok}（HttpApi.markDone 必须重取，验证前提）
  const done = await req('POST', `/api/messages/${encodeURIComponent(id)}/done`, { body: {} });
  check('POST done → {ok} 且无消息体', done.status === 200 && done.data?.ok === true && !('data' in (done.data ?? {})));

  // 9. trace 信封（HttpApi.trace 依赖 data + log）
  const trace = await req('GET', `/api/messages/trace/${encodeURIComponent(id)}`);
  const events = (trace.data?.log ?? []).map((e) => e.event);
  check('GET trace → {ok, data, log}', trace.status === 200 && Array.isArray(trace.data?.log));
  for (const ev of ['received', 'replied', 'sent', 'synced']) {
    check(`trace 含 ${ev}`, events.includes(ev), events.join(','));
  }

  // 10. WS 握手
  await checkWebSocket();
}

main()
  .catch((e) => {
    console.error(`FAIL  契约自检异常：${e instanceof Error ? e.message : String(e)}`);
    failed += 1;
  })
  .finally(() => {
    console.log(`\n契约自检：${passed} PASS / ${failed} FAIL`);
    // 不用 process.exit()：Windows + Node 24 下若 fetch/WebSocket 句柄还在关闭中，
    // 强制退出会触发 libuv 断言（0xC0000409，退出码 -1073740791），让 CI/脚本误判。
    // 设置 exitCode 让进程自然收尾；10s 兜底防挂死。
    const code = failed > 0 ? 1 : 0;
    process.exitCode = code;
    const watchdog = setTimeout(() => process.exit(code), 10_000);
    watchdog.unref?.();
  });
