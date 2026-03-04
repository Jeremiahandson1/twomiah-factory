import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const consoleFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  let log = `${timestamp} [${level}]: ${message}`;
  if (Object.keys(meta).length > 0 && meta.constructor === Object) {
    const cleanMeta = { ...meta };
    delete cleanMeta.level;
    delete cleanMeta.message;
    delete cleanMeta.timestamp;
    if (Object.keys(cleanMeta).length > 0) {
      log += ` ${JSON.stringify(cleanMeta)}`;
    }
  }
  if (stack) log += `\n${stack}`;
  return log;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true })
  ),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), consoleFormat),
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: combine(json()),
      maxsize: 5242880,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: combine(json()),
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

// Request logging helper
logger.logRequest = (req, res, durationMs) => {
  const { method, originalUrl, ip } = req;
  const { statusCode } = res;
  const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
  
  logger[level]('HTTP Request', {
    method,
    url: originalUrl,
    status: statusCode,
    duration: `${durationMs}ms`,
    ip,
    userId: req.user?.userId,
    userAgent: req.get('user-agent'),
  });
};

// Error logging helper
logger.logError = (error, req = null, additionalData = {}) => {
  const errorData = {
    message: error.message,
    name: error.name,
    stack: error.stack,
    ...additionalData,
  };

  if (req) {
    errorData.request = {
      method: req.method,
      url: req.originalUrl,
      userId: req.user?.userId,
      ip: req.ip,
    };
  }

  logger.error('Application Error', errorData);
};

// Audit logging for important actions
logger.audit = (action, userId, companyId, details = {}) => {
  logger.info('Audit Log', {
    action,
    userId,
    companyId,
    ...details,
    timestamp: new Date().toISOString(),
  });
};

export default logger;
