// TACG — WebSocket-клиент к движку агента (socket.io через Caddy-шлюз)
'use client'

import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    // Порт указывается ТОЛЬКО через XTransformPort, путь — строго '/'
    socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
      timeout: 10000,
    })
  }
  return socket
}
