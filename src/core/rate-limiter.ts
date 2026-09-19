import { logger } from './logger.js';

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  context?: string;
}

/**
 * Führt eine asynchrone Operation mit automatischem Exponential-Backoff aus.
 * Nützlich bei vorübergehenden Discord-Netzwerkfehlern oder Datenbank-Timeouts.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 500,
    maxDelayMs = 5000,
    factor = 2,
    context = 'Operation'
  } = options;

  let attempt = 0;
  let delay = initialDelayMs;

  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (error: unknown) {
      attempt++;
      if (attempt >= maxRetries) {
        logger.error(
          `[Retry] ${context} nach ${maxRetries} Versuchen endgültig fehlgeschlagen.`,
          error
        );
        throw error;
      }

      // Prüfe auf Discord Rate Limit (429)
      const errObj = error as { status?: number; retryAfter?: number };
      let waitTime = delay;
      if (errObj && (errObj.status === 429 || errObj.retryAfter)) {
        waitTime = (errObj.retryAfter ? errObj.retryAfter * 1000 : delay) + 100;
        logger.warn(`[Retry] Discord Rate Limit erkannt für ${context}. Warte ${waitTime}ms...`);
      } else {
        logger.warn(
          `[Retry] Versuch ${attempt} für ${context} fehlgeschlagen. Wiederhole in ${waitTime}ms...`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, waitTime));
      delay = Math.min(delay * factor, maxDelayMs);
    }
  }

  throw new Error(`[Retry] Unerwarteter Zustand in withRetry für ${context}`);
}
