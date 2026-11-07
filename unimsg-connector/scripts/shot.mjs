import { writeFileSync } from 'node:fs';

const PORT = 9222;

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }

  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function connect() {
  const targets = await listTargets();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  return new Cdp(ws);
}

async function main() {
  const cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const shots = [
    { name: 'lg-light', width: 1440, height: 900, theme: 'light', mobile: false },
    { name: 'lg-dark', width: 1440, height: 900, theme: 'dark', mobile: false },
    { name: 'sm-light', width: 375, height: 812, theme: 'light', mobile: true },
    { name: 'sm-dark', width: 375, height: 812, theme: 'dark', mobile: true },
  ];

  for (const shot of shots) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: shot.width,
      height: shot.height,
      deviceScaleFactor: 2,
      mobile: shot.mobile,
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: shot.mobile,
      maxTouchPoints: shot.mobile ? 5 : 1,
    });
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: shot.theme }],
    });

    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5173/inbox' });
    await sleep(2200);
    // 主题靠 localStorage，导航后写入再刷新
    await cdp.send('Runtime.evaluate', {
      expression: `localStorage.setItem('linkhub-theme', '${shot.theme}');`,
    });
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5173/inbox' });
    await sleep(2000);

    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`C:/LinkHub/unimsg-connector/.shots/lh-${shot.name}.png`, Buffer.from(data, 'base64'));

    const report = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const pick = (sel, props) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const cs = getComputedStyle(el);
          const out = {};
          for (const p of props) out[p] = cs.getPropertyValue(p);
          const rect = el.getBoundingClientRect();
          out.box = [Math.round(rect.width), Math.round(rect.height)];
          return out;
        };
        return JSON.stringify({
          theme: document.documentElement.dataset.theme,
          hoverNone: matchMedia('(hover: none)').matches,
          coarse: matchMedia('(pointer: coarse)').matches,
          tag: pick('.platform-tag', ['color', 'background-color', 'font-size']),
          action: pick('.msg-action', ['color', 'width', 'height']),
          actions: pick('.msg-card__actions', ['opacity', 'pointer-events']),
          glow: pick('.rail__glow', ['transform', 'height', 'top']),
          body: pick('body', ['font-size']),
          scrollW: document.documentElement.scrollWidth,
        }, null, 1);
      })()`,
      returnByValue: true,
    });
    console.log(`\n=== ${shot.name} ===`);
    console.log(report.result.value);
  }

  // 切换一次页面，验证高光位移走的是 transform
  await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector('a[href="/todos"]')?.click()`,
  });
  await sleep(900);
  const glow = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector('.rail__glow');
      if (!el) return 'no glow';
      const cs = getComputedStyle(el);
      return JSON.stringify({ transform: cs.transform, top: cs.top, height: cs.height });
    })()`,
    returnByValue: true,
  });
  console.log('\n=== glow after nav ===');
  console.log(glow.result.value);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
