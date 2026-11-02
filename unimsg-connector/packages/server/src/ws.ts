/**
 * WebSocket 实时推送：新消息、状态变更即时下发前端。
 * 握手校验与 REST 同一个 API_TOKEN，避免“连上就能看所有消息”。
 */
import { WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import { config } from './config';

export interface WsEvent {
  type: string;
  data?: unknown;
}

let wss: WebSocketServer | null = null;

export function initWs(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const token = url.searchParams.get('token') ?? '';
    if (config.apiToken && token !== config.apiToken) {
      ws.close(1008, 'unauthorized');
      return;
    }
    ws.send(JSON.stringify({ type: 'connected', ts: new Date().toISOString() }));
  });
  return wss;
}

export function wsBroadcast(event: WsEvent): void {
  if (!wss) return;
  const payload = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}
