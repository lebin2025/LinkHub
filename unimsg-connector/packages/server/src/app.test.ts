/**
 * 应用装配层单测（离线，只走 127.0.0.1 回环）：
 *  - CORS_ORIGINS 白名单：不填保持 `*`；填了只放行名单 Origin；无 Origin 的 curl 放行；
 *  - 启动错误人话提示（EADDRINUSE / EACCES）；
 *  - 默认 dev-token 告警与 production 拒绝启动闸门。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, formatListenError, parseCorsOrigins } from './app';
import { config } from './config';
import {
  DEFAULT_DEV_TOKEN, apiTokenWarning, devTokenWarning, productionTokenBlocker, resolveApiToken,
} from './middlewares/auth';
import { maskAddress } from './services/account';
import { InMemoryRepository } from './db/repository';
import { connectors } from './connectors/registry';
import { LlmService } from './services/llm';
import { OcrService } from './services/ocr';
import { RateLimiter } from './services/rateLimiter';
import { MessageService } from './services/message';

function makeSvc(): MessageService {
  return new MessageService(
    new InMemoryRepository(), connectors, new LlmService(), new OcrService(), new RateLimiter(3, 5), () => {},
  );
}

async function withApp(
  corsOrigins: string[] | null,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(createApp(makeSvc(), { corsOrigins }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await fn(base);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

interface Res {
  status: number;
  headers: Headers;
  text: string;
}

async function req(base: string, path: string, init: RequestInit = {}): Promise<Res> {
  const res = await fetch(`${base}${path}`, init);
  return { status: res.status, headers: res.headers, text: await res.text() };
}

// ---------- CORS ----------

test('parseCorsOrigins：不填/空白 → null（保持 *）；逗号分隔去空格', () => {
  assert.equal(parseCorsOrigins(undefined), null);
  assert.equal(parseCorsOrigins(''), null);
  assert.equal(parseCorsOrigins('   ,  , '), null);
  assert.deepEqual(parseCorsOrigins('http://localhost:5173, https://demo.example.com'),
    ['http://localhost:5173', 'https://demo.example.com']);
});

test('CORS 未配置：保持 Access-Control-Allow-Origin: *（本地演示零改动）', async () => {
  await withApp(null, async (base) => {
    const res = await req(base, '/api/health', { headers: { origin: 'http://any.example.com' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });
});

test('CORS 白名单：名单内 Origin 放行并回显该 Origin', async () => {
  await withApp(['http://localhost:5173'], async (base) => {
    const res = await req(base, '/api/health', { headers: { origin: 'http://localhost:5173' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    // 预检也必须放行，否则浏览器压根发不出带 Authorization 的请求
    assert.match(res.headers.get('vary') ?? '', /Origin/i);
  });
});

test('CORS 白名单：名单外 Origin → 403 JSON（提示改 CORS_ORIGINS）', async () => {
  await withApp(['http://localhost:5173'], async (base) => {
    const res = await req(base, '/api/health', { headers: { origin: 'http://evil.example.com' } });
    assert.equal(res.status, 403);
    assert.ok(res.text.includes('CORS_ORIGINS'), '错误信息要告诉用户怎么放行');
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});

test('CORS 白名单：无 Origin 的 curl / 服务端请求照常放行', async () => {
  await withApp(['http://localhost:5173'], async (base) => {
    const res = await req(base, '/api/health');
    assert.equal(res.status, 200);
  });
});

test('CORS 白名单：预检 OPTIONS 返回 204 且带允许头', async () => {
  await withApp(['http://localhost:5173'], async (base) => {
    const res = await req(base, '/api/messages', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  });
});

// ---------- 启动错误提示 ----------

test('formatListenError：EADDRINUSE 给出中文可操作提示（端口/换端口命令/结束进程命令）', () => {
  const msg = formatListenError(Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }), 3001);
  assert.match(msg, /端口 3001 已被占用/);
  assert.match(msg, /SERVER_PORT/);
  assert.match(msg, /netstat -ano \| findstr :3001/);
  assert.match(msg, /taskkill \/PID/);
  assert.match(msg, /lsof -i :3001/);
});

test('formatListenError：EACCES 提示权限；其它错误也可读', () => {
  const denied = formatListenError(Object.assign(new Error('permission denied'), { code: 'EACCES' }), 80);
  assert.match(denied, /权限/);
  assert.match(denied, /SERVER_PORT/);

  const unknown = formatListenError(Object.assign(new Error('boom'), { code: 'ESOMETHING' }), 3001);
  assert.match(unknown, /ESOMETHING/);
  assert.match(unknown, /boom/);
});

// ---------- 默认令牌安全 ----------

test('默认 dev-token：启动告警包含「默认 dev-token」与「必须改」，自定义令牌不告警', () => {
  assert.equal(DEFAULT_DEV_TOKEN, 'dev-token');
  const warning = devTokenWarning('dev-token');
  assert.ok(warning);
  assert.match(warning!, /正在使用默认 dev-token，演示可以、对外暴露前必须改/);
  assert.equal(devTokenWarning('s3cr3t-token'), null);
});

test('production 闸门：默认 dev-token 拒绝启动；非 production 或自定义令牌放行', () => {
  const blocked = productionTokenBlocker('dev-token', 'production');
  assert.ok(blocked);
  assert.match(blocked!, /拒绝启动/);
  assert.equal(productionTokenBlocker('dev-token', undefined), null);
  assert.equal(productionTokenBlocker('dev-token', 'development'), null);
  assert.equal(productionTokenBlocker('s3cr3t-token', 'production'), null);
});

test('空 API_TOKEN：视同未配置回退 dev-token（不关闭鉴权），production 直接拒绝启动', () => {
  assert.equal(resolveApiToken(''), DEFAULT_DEV_TOKEN);
  assert.equal(resolveApiToken('   '), DEFAULT_DEV_TOKEN);
  assert.equal(resolveApiToken(undefined), DEFAULT_DEV_TOKEN);
  assert.equal(resolveApiToken('s3cr3t-token'), 's3cr3t-token');

  const warning = apiTokenWarning('');
  assert.ok(warning);
  assert.match(warning!, /API_TOKEN 为空/);
  assert.match(warning!, /dev-token/);
  assert.equal(apiTokenWarning('s3cr3t-token'), null);

  const blocked = productionTokenBlocker('', 'production');
  assert.ok(blocked);
  assert.match(blocked!, /拒绝启动/);
  assert.match(blocked!, /API_TOKEN 为空/);
});

test('空 API_TOKEN 时 HTTP 鉴权仍然生效：无 token 401，带 dev-token 200', async () => {
  const saved = config.apiToken;
  config.apiToken = ''; // 模拟用户 .env 写成 API_TOKEN=
  try {
    await withApp(null, async (base) => {
      const noAuth = await req(base, '/api/messages');
      assert.equal(noAuth.status, 401, '空 token 绝不能关闭鉴权');

      const withFallbackToken = await req(base, '/api/messages', {
        headers: { authorization: `Bearer ${DEFAULT_DEV_TOKEN}` },
      });
      assert.equal(withFallbackToken.status, 200, '回退 dev-token 后应可用（本地演示不受影响）');
    });
  } finally {
    config.apiToken = saved;
  }
});

test('maskAddress：启动日志里的邮箱地址必须脱敏（不出现完整本地部分）', () => {
  const masked = maskAddress('demo.user@qq.com');
  assert.match(masked, /@qq\.com$/);
  assert.ok(!masked.includes('demo.user'), `不能泄露完整邮箱：${masked}`);
  assert.equal(masked[0], 'd');
  // 非法地址原样返回，不崩
  assert.equal(maskAddress('not-an-email'), 'not-an-email');
});
