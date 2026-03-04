import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import logger from './logger.js';

let io = null;

export function initializeSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      credentials: true,
    },
  });

  // Auth middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      socket.join(`company:${decoded.companyId}`);
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    logger.info('Socket connected', { userId: socket.user?.userId, socketId: socket.id });

    // Join specific rooms
    socket.on('join:project', (projectId) => {
      socket.join(`project:${projectId}`);
    });

    socket.on('leave:project', (projectId) => {
      socket.leave(`project:${projectId}`);
    });

    socket.on('disconnect', () => {
      logger.info('Socket disconnected', { userId: socket.user?.userId, socketId: socket.id });
    });
  });

  return io;
}

// Emit to company
export function emitToCompany(companyId, event, data) {
  if (io) {
    io.to(`company:${companyId}`).emit(event, data);
  }
}

// Emit to project
export function emitToProject(projectId, event, data) {
  if (io) {
    io.to(`project:${projectId}`).emit(event, data);
  }
}

// Event types
export const EVENTS = {
  // Contacts
  CONTACT_CREATED: 'contact:created',
  CONTACT_UPDATED: 'contact:updated',
  CONTACT_DELETED: 'contact:deleted',
  
  // Projects
  PROJECT_CREATED: 'project:created',
  PROJECT_UPDATED: 'project:updated',
  PROJECT_DELETED: 'project:deleted',
  
  // Jobs
  JOB_CREATED: 'job:created',
  JOB_UPDATED: 'job:updated',
  JOB_DELETED: 'job:deleted',
  JOB_STATUS_CHANGED: 'job:status_changed',
  
  // Quotes
  QUOTE_CREATED: 'quote:created',
  QUOTE_UPDATED: 'quote:updated',
  QUOTE_SENT: 'quote:sent',
  QUOTE_APPROVED: 'quote:approved',
  
  // Invoices
  INVOICE_CREATED: 'invoice:created',
  INVOICE_UPDATED: 'invoice:updated',
  INVOICE_SENT: 'invoice:sent',
  INVOICE_PAID: 'invoice:paid',
  PAYMENT_RECEIVED: 'invoice:payment_received',
  
  // RFIs
  RFI_CREATED: 'rfi:created',
  RFI_RESPONDED: 'rfi:responded',
  
  // Change Orders
  CO_CREATED: 'change_order:created',
  CO_APPROVED: 'change_order:approved',
  
  // Notifications
  NOTIFICATION: 'notification',
};

export default { initializeSocket, emitToCompany, emitToProject, EVENTS };
