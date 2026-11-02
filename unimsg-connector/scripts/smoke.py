# -*- coding: utf-8 -*-
"""端到端冒烟：三平台接入 → 幂等 → 鉴权 → 回复回写 → 状态 synced → trace 回放。
用法：先启动服务，再 python scripts/smoke.py [baseUrl]
"""
import json
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3001"
TOKEN = "dev-token"


def req(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    if body is not None:
        r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(r) as resp:
            ct = resp.headers.get("content-type", "")
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if "json" in ct else raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f" | {extra}" if extra else ""))
    if not cond:
        sys.exit(1)


s, h = req("GET", "/api/health")
check("health ok", s == 200 and h.get("ok"), h)

feishu = {"schema": "2.0", "event": {"message": {
    "message_id": "om_smoke_1", "message_type": "text",
    "content": json.dumps({"text": "周五前交周报"}),
    "sender": {"sender_id": {"user_id": "u_smoke"}}}}}
s, h = req("POST", "/api/webhook/feishu", feishu)
check("webhook feishu 200", s == 200 and h.get("ok"), h)

s, h = req("POST", "/api/webhook/feishu", feishu)
check("webhook duplicate -> 幂等", h.get("duplicate") is True, h)

dingtalk = {"msgtype": "text", "text": {"content": "周五前交周报"},
            "msgId": "msg_smoke_1", "senderId": "u_dt", "senderNick": "钉钉小王"}
s, h = req("POST", "/api/webhook/dingtalk", dingtalk)
check("webhook dingtalk 200", s == 200, h)

wecom = {"MsgType": "text", "Content": "周五前交周报", "MsgId": "wx_smoke_1", "FromUserName": "u_wx"}
s, h = req("POST", "/api/webhook/wecom", wecom)
check("webhook wecom success", s == 200 and h == "success", h)

s, h = req("GET", "/api/messages")
check("messages 需鉴权(401)", s == 401, s)

s, h = req("GET", "/api/messages", token=TOKEN)
check("list 3 条消息", s == 200 and len(h["data"]) == 3, len(h.get("data", [])))
fid = [m for m in h["data"] if m["platform"] == "feishu"][0]["traceId"]

s, h = req("POST", f"/api/messages/{fid}/reply", {"text": "收到，周五前交周报"}, token=TOKEN)
check("reply 202 且入队 processing→replied", s == 202 and h["message"]["status"] == "replied", h["message"]["status"])

time.sleep(0.3)
s, h = req("GET", f"/api/messages/{fid}", token=TOKEN)
check("回写后状态 synced", h["data"]["status"] == "synced", h["data"]["status"])

s, h = req("GET", f"/api/messages/trace/{fid}", token=TOKEN)
events = [e["event"] for e in h["log"]]
for ev in ["received", "processing", "replied", "sent", "synced"]:
    check(f"trace 含 {ev}", ev in events, events)

s, h = req("GET", "/api/health")
check("健康计数 received>=3 & sent>=1", h.get("received", 0) >= 3 and h.get("sent", 0) >= 1, h)

print("SMOKE OK")
