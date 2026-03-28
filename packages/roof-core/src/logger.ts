// Simple logger for the roof-core package.
// In standalone mode, logs to console. CRM templates can override with their own logger.

const logger = {
  info: (message: string, meta?: any) => console.log(`[roof-core] ${message}`, meta || ''),
  warn: (message: string, meta?: any) => console.warn(`[roof-core] ${message}`, meta || ''),
  error: (message: string, meta?: any) => console.error(`[roof-core] ${message}`, meta || ''),
}

export default logger
