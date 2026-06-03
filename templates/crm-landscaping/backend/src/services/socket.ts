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
      ;(socket as any).user = decoded
      socket.join(`company:${decoded.companyId}`)
      next()
    } catch {
      next(new Error('Authentication error'))
    }
  })

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${(socket as any).user?.userId}`)

    socket.on('join:project', (projectId: string) => {
      socket.join(`project:${projectId}`)
    })

    socket.on('leave:project', (projectId: string) => {
      socket.leave(`project:${projectId}`)
    })

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${(socket as any).user?.userId}`)
    })
  })

  return io
}

export const EVENTS = {
  CONTACT_CREATED: 'contact:created',
  CONTACT_UPDATED: 'contact:updated',
  CONTACT_DELETED: 'contact:deleted',
  JOB_CREATED: 'job:created',
  JOB_UPDATED: 'job:updated',
  JOB_DELETED: 'job:deleted',
  JOB_STATUS_CHANGED: 'job:statusChanged',
  QUOTE_CREATED: 'quote:created',
  QUOTE_UPDATED: 'quote:updated',
  QUOTE_SENT: 'quote:sent',
  QUOTE_APPROVED: 'quote:approved',
  INVOICE_CREATED: 'invoice:created',
  INVOICE_UPDATED: 'invoice:updated',
  INVOICE_SENT: 'invoice:sent',
  INVOICE_PAID: 'invoice:paid',
  PAYMENT_RECEIVED: 'payment:received',
} as const

export const emitToCompany = (companyId: string, event: string, data: any) => {
  if (io) io.to(`company:${companyId}`).emit(event, data)
}

export const emitToProject = (projectId: string, event: string, data: any) => {
  if (io) io.to(`project:${projectId}`).emit(event, data)
}

export { io }
