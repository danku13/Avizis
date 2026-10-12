// TACG — WebSocket-клиент к движку агента (socket.io)
'use client'

import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null

/**
 * URL подключения к движку — три режима (ADR-018):
 *  1. Десктоп (Tauri): оболочка инъектирует window.__TACG_ENGINE_PORT__ до загрузки
 *     страницы (initialization script) — движок работает sidecar'ом на 127.0.0.1:port.
 *  2. Десктоп-контракт в браузере (E2E/отладка): index.html?port=<N>.
 *  3. Веб (dev/preview): относительный URL через Caddy-шлюз — порт только через
 *     XTransformPort, путь строго '/'.
 */
function engineTarget(): { url: string; opts: Record<string, unknown> } | null {
  if (typeof window === 'undefined') return null
  // 1) порт, инъекцированный Tauri-оболочкой до загрузки страницы
  const injected = (window as { __TACG_ENGINE_PORT__?: unknown }).__TACG_ENGINE_PORT__
  const injectedPort = Number(injected)
  // 2) query-параметр (браузерная проверка десктоп-контракта)
  const qp = new URLSearchParams(window.location.search).get('port')
  const qpPort = Number(qp)
  const direct = injected && Number.isInteger(injectedPort) && injectedPort > 0 && injectedPort < 65536
    ? injectedPort
    : qp && Number.isInteger(qpPort) && qpPort > 0 && qpPort < 65536
      ? qpPort
      : null
  if (direct) return { url: `http://127.0.0.1:${direct}`, opts: { path: '/' } }
  return null
}

export function getSocket(): Socket {
  if (!socket) {
    const direct = engineTarget()
    socket = io(direct ? direct.url : '/', {
      ...(direct ? direct.opts : { query: { XTransformPort: 3003 } }),
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
      timeout: 10000,
    })
  }
  return socket
}
