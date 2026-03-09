import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import logger from './logger.ts'

let io: Server

export const initializeSocket = (server: any) => {
  const allowedOrigins = (process.env.FRONTEND_URL || '').split(',').map(s => s.trim())
  io = new Server(server, {
    cors: {
      origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
        if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.onrender.com')) return callback(null, true)
        callback(null, false)
      },
      credentials: true,
    },
  })

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token
      if (!token) return next(new Error('No token'))
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any
      ;(socket as any).userId = decoded.userId
      ;(socket as any).role = decoded.role
      ;(socket as any).companyId = decoded.companyId
      next()
    } catch {
      next(new Error('Authentication error'))
    }
  })

  io.on('connection', (socket) => {
    socket.join(`user:${(socket as any).userId}`)
    if ((socket as any).companyId) socket.join(`company:${(socket as any).companyId}`)
    logger.info(`Socket connected: ${(socket as any).userId}`)

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${(socket as any).userId}`)
    })
  })

  return io
}

export const EVENTS = {
  REFRESH: 'refresh',
} as const

export const emitToUser = (userId: string, event: string, data: any) => {
  if (io) io.to(`user:${userId}`).emit(event, data)
}

export const emitToCompany = (companyId: string, event: string, data: any) => {
  if (io) io.to(`company:${companyId}`).emit(event, data)
}

export const emitToAll = (event: string, data: any) => {
  if (io) io.emit(event, data)
}

export { io }
