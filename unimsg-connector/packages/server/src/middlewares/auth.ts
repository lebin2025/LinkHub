/**
 * 入口鉴权：保护 /api/*（除 health 与 webhook 外的业务接口）。
 * 前端登录后携带 Authorization: Bearer <API_TOKEN>；token 仅存服务端 env。
 */
import type { RequestHandler } from 'express';
import { config } from '../config';

export const apiAuth: RequestHandler = (req, res, next) => {
  const token = config.apiToken;
  if (!token) return next(); // 未配置则不拦截（仅本地开发）

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
