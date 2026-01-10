import TcpSocket from 'react-native-tcp-socket';
import { apiBase } from '../api/client';

type WorldEventName = 'world.tick' | 'world.start' | 'world.end';

type WorldEvent = {
  event: WorldEventName;
  data: any;
};

function parseHostPort(baseUrl: string): { host: string; port: number; pathPrefix: string } {
  // React Native's URL polyfill is incomplete on some runtimes (e.g. URL.hostname).
  // Use a small, dependency-free parser instead.
  const trimmed = String(baseUrl ?? '').trim();
  const m = /^(https?:\/\/)?([^\/:?#]+)(?::(\d+))?(\/[^?#]*)?/.exec(trimmed);
  const proto = (m?.[1] ?? 'http://').toLowerCase();
  const host = m?.[2] ?? 'localhost';
  const port = m?.[3] ? Number(m[3]) : proto === 'https://' ? 443 : 80;
  const pathname = m?.[4] ?? '';
  const pathPrefix = pathname && pathname !== '/' ? pathname.replace(/\/$/, '') : '';
  return { host, port, pathPrefix };
}

function parseSseFrames(buf: string): { events: WorldEvent[]; rest: string } {
  const events: WorldEvent[] = [];
  let rest = buf;
  for (;;) {
    const idx = rest.indexOf('\n\n');
    if (idx === -1) break;
    const raw = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const lines = raw.split('\n').map((l) => l.replace(/\r$/, ''));
    let ev: string | null = null;
    const dataLines: string[] = [];
    for (const l of lines) {
      if (l.startsWith('event:')) ev = l.slice('event:'.length).trim();
      else if (l.startsWith('data:')) dataLines.push(l.slice('data:'.length).trim());
    }
    if (!ev) continue;
    const dataRaw = dataLines.join('\n');
    try {
      const parsed = dataRaw ? JSON.parse(dataRaw) : null;
      if (ev === 'world.tick' || ev === 'world.start' || ev === 'world.end') {
        events.push({ event: ev as WorldEventName, data: parsed });
      }
    } catch {
      // ignore malformed frames
    }
  }
  return { events, rest };
}

export function startWorldStream(opts: {
  onEvent: (e: WorldEvent) => void;
  onStatus?: (s: { connected: boolean }) => void;
}) {
  let stopped = false;
  let socket: any = null;
  let buffer = '';
  let backoff = 500;
  let reconnectTimer: any = null;

  const connect = () => {
    if (stopped) return;
    opts.onStatus?.({ connected: false });
    const { host, port, pathPrefix } = parseHostPort(apiBase);
    const path = `${pathPrefix}/world/stream`;
    socket = TcpSocket.createConnection({ host, port }, () => {
      backoff = 500;
      opts.onStatus?.({ connected: true });
      const req =
        `GET ${path} HTTP/1.1\r\n` +
        `Host: ${host}\r\n` +
        `Accept: text/event-stream\r\n` +
        `Cache-Control: no-cache\r\n` +
        `Connection: keep-alive\r\n` +
        `\r\n`;
      socket.write(req);
    });

    socket.on('data', (data: Buffer) => {
      const chunk = data.toString('utf8');
      buffer += chunk;
      // Drop HTTP headers once.
      const hdrEnd = buffer.indexOf('\r\n\r\n');
      if (hdrEnd !== -1) {
        // Keep only body after headers; SSE frames use \n\n.
        buffer = buffer.slice(hdrEnd + 4);
      }
      const parsed = parseSseFrames(buffer);
      buffer = parsed.rest;
      for (const e of parsed.events) opts.onEvent(e);
    });

    const scheduleReconnect = () => {
      if (stopped) return;
      try {
        socket?.destroy?.();
      } catch {
        // ignore
      }
      opts.onStatus?.({ connected: false });
      const wait = Math.min(10_000, backoff);
      backoff = Math.min(10_000, Math.floor(backoff * 1.6));
      reconnectTimer = setTimeout(connect, wait);
    };

    socket.on('error', scheduleReconnect);
    socket.on('close', scheduleReconnect);
  };

  connect();

  return () => {
    stopped = true;
    try {
      socket?.destroy?.();
    } catch {
      // ignore
    }
    if (reconnectTimer) clearTimeout(reconnectTimer);
  };
}


