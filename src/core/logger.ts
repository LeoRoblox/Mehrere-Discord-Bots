import type { BotLogger } from './types.js';

/**
 * Filtert sensible Daten wie Discord-Tokens oder Turso-Auth-Schlüssel aus Log-Ausgaben heraus.
 */
export function sanitizeLogMessage(message: string): string {
  if (typeof message !== 'string') return message;

  // Discord Bot Token Muster (MTAy... / Bot-Tokens bestehen typischerweise aus 3 Base64-Teilen)
  let sanitized = message.replace(
    /[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}/g,
    '[REDACTED_DISCORD_TOKEN]'
  );

  // Turso JWT / Auth Token Muster
  sanitized = sanitized.replace(
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    '[REDACTED_JWT_TOKEN]'
  );

  // Turso Datenbank URLs mit Inline-Auth
  sanitized = sanitized.replace(/(libsql:\/\/[^:]+:)([^@]+)(@)/g, '$1[REDACTED_PASSWORD]$3');

  return sanitized;
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) {
    return `${arg.name}: ${sanitizeLogMessage(arg.message)}${arg.stack ? `\n${sanitizeLogMessage(arg.stack)}` : ''}`;
  }
  if (typeof arg === 'object' && arg !== null) {
    try {
      return sanitizeLogMessage(JSON.stringify(arg));
    } catch {
      return '[Unserializable Object]';
    }
  }
  return sanitizeLogMessage(String(arg));
}

export class AppLogger implements BotLogger {
  private readonly context: string;

  constructor(context: string = 'Core') {
    this.context = context;
  }

  public forContext(newContext: string): AppLogger {
    return new AppLogger(newContext);
  }

  private formatPrefix(level: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] [${this.context}]`;
  }

  public info(message: string, ...args: unknown[]): void {
    const formatted =
      args.length > 0
        ? `${sanitizeLogMessage(message)} ${args.map(formatArg).join(' ')}`
        : sanitizeLogMessage(message);
    console.log(`${this.formatPrefix('INFO')} ${formatted}`);
  }

  public warn(message: string, ...args: unknown[]): void {
    const formatted =
      args.length > 0
        ? `${sanitizeLogMessage(message)} ${args.map(formatArg).join(' ')}`
        : sanitizeLogMessage(message);
    console.warn(`${this.formatPrefix('WARN')} ${formatted}`);
  }

  public error(message: string, error?: unknown): void {
    const errText = error !== undefined ? ` | ${formatArg(error)}` : '';
    console.error(`${this.formatPrefix('ERROR')} ${sanitizeLogMessage(message)}${errText}`);
  }

  public debug(message: string, ...args: unknown[]): void {
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      const formatted =
        args.length > 0
          ? `${sanitizeLogMessage(message)} ${args.map(formatArg).join(' ')}`
          : sanitizeLogMessage(message);
      console.debug(`${this.formatPrefix('DEBUG')} ${formatted}`);
    }
  }
}

export const logger = new AppLogger('App');
