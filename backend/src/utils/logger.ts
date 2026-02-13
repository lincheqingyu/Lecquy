/**
 * 日志工具
 * 简单的分级日志，后续可替换为 pino 等专业库
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

/** 当前日志级别，从环境变量读取 */
function getCurrentLevel(): number {
  const level = (process.env.LOG_LEVEL ?? 'info') as LogLevel
  return LOG_LEVELS[level] ?? LOG_LEVELS.info
}

function formatTimestamp(): string {
  return new Date().toISOString()
}

function log(level: LogLevel, message: string, ...args: unknown[]): void {
  if (LOG_LEVELS[level] < getCurrentLevel()) return

  const prefix = `[${formatTimestamp()}] [${level.toUpperCase()}]`

  switch (level) {
    case 'debug':
      // eslint-disable-next-line no-console
      console.debug(prefix, message, ...args)
      break
    case 'info':
      // eslint-disable-next-line no-console
      console.info(prefix, message, ...args)
      break
    case 'warn':
      console.warn(prefix, message, ...args)
      break
    case 'error':
      console.error(prefix, message, ...args)
      break
  }
}

export const logger = {
  debug: (message: string, ...args: unknown[]) => log('debug', message, ...args),
  info: (message: string, ...args: unknown[]) => log('info', message, ...args),
  warn: (message: string, ...args: unknown[]) => log('warn', message, ...args),
  error: (message: string, ...args: unknown[]) => log('error', message, ...args),
}
