/**
 * 入口鉴权：保护 /api/*（除 health 与 webhook 外的业务接口）。
 * 前端登录后携带 Authorization: Bearer <API_TOKEN>；token 仅存服务端 env。
 */
import type { RequestHandler } from 'express';
import { config } from '../config';

/** 默认演示令牌：零配置能跑通本地演示，但对外暴露前必须替换 */
export const DEFAULT_DEV_TOKEN = 'dev-token';

/**
 * 有效入口令牌：空 API_TOKEN（漏填/写成空串）视同「未配置」→ 回退 dev-token，
 * 绝不因为空串而关闭鉴权（旧实现 `if (!token) next()` 会让空 token 变成人人可访问）。
 */
export function resolveApiToken(raw: string | undefined): string {
  const token = (raw ?? '').trim();
  return token || DEFAULT_DEV_TOKEN;
}

/**
 * 默认令牌告警文案。返回 null 表示令牌已自定义，无需提示。
 * 启动日志会把它打成醒目中文警告（演示可以、对外暴露前必须改）。
 */
export function devTokenWarning(token: string): string | null {
  if (token !== DEFAULT_DEV_TOKEN) return null;
  return '正在使用默认 dev-token，演示可以、对外暴露前必须改：'
    + '请在 .env 中设置 API_TOKEN=<足够随机的字符串> 并重启服务。';
}

/** 启动时令牌告警：空串与默认令牌都要醒目提示（自定义令牌返回 null） */
export function apiTokenWarning(raw: string | undefined): string | null {
  if (!(raw ?? '').trim()) {
    return 'API_TOKEN 为空（等于未配置），已回退默认 dev-token 并继续要求 Bearer 鉴权；'
      + '演示可以、对外暴露前必须改：请在 .env 设置强随机 API_TOKEN 后重启。';
  }
  return devTokenWarning(resolveApiToken(raw));
}

/**
 * 生产环境安全闸门：NODE_ENV=production 且令牌为空/仍是默认 dev-token 时拒绝启动。
 * 返回 null 表示可以启动；返回字符串 = 拒绝启动的原因。
 */
export function productionTokenBlocker(raw: string | undefined, nodeEnv: string | undefined): string | null {
  if (nodeEnv !== 'production') return null;
  if (resolveApiToken(raw) !== DEFAULT_DEV_TOKEN) return null;
  const why = (raw ?? '').trim() ? '，仍在使用默认 dev-token' : '，API_TOKEN 为空（等于未配置）';
  return `拒绝启动：NODE_ENV=production 时${why}。`
    + '请先在 .env 设置强随机 API_TOKEN，再重新启动，避免接口被任意人调用。';
}

export const apiAuth: RequestHandler = (req, res, next) => {
  // 永远鉴权：空串已在上方回退为 dev-token，不存在「未配置就放行」的分支
  const token = resolveApiToken(config.apiToken);

  const header = req.headers.authorization ?? '';
  const fromHeader = header.startsWith('Bearer ') ? header.slice(7) : '';
  const fromQuery = typeof req.query.token === 'string' ? req.query.token : '';
  const provided = fromHeader || fromQuery;

  if (provided !== token) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  next();
};
