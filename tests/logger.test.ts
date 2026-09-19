import { describe, it, expect } from 'vitest';
import { sanitizeLogMessage } from '../src/core/logger.js';

describe('Logger Secret Sanitization', () => {
  it('redacts Discord bot tokens from log output', () => {
    const mockToken = ['MTAxMjM0NTY3ODkwMTIzNDU2Nw', 'GYXZ9a', 'AbCdEfGhIjKlMnOpQrStUvWxYz12345'].join('.');
    const rawMsg = `Connecting bot with token ${mockToken}`;
    const sanitized = sanitizeLogMessage(rawMsg);
    expect(sanitized).not.toContain('GYXZ9a');
    expect(sanitized).toContain('[REDACTED_DISCORD_TOKEN]');
  });

  it('redacts JWT tokens used in Turso authentication', () => {
    const rawJwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozqvPtqP2BStiq7';
    const sanitized = sanitizeLogMessage(rawJwt);
    expect(sanitized).not.toContain('dozqvPtqP2BStiq7');
    expect(sanitized).toContain('[REDACTED_JWT_TOKEN]');
  });

  it('redacts inline credentials in database connection strings', () => {
    const rawUrl = 'libsql://default:secretPassword123@my-db.turso.io';
    const sanitized = sanitizeLogMessage(rawUrl);
    expect(sanitized).not.toContain('secretPassword123');
    expect(sanitized).toContain('[REDACTED_PASSWORD]');
  });

  it('preserves regular non-sensitive log messages intact', () => {
    const regular = 'Bot initialisiert auf Port 10000.';
    expect(sanitizeLogMessage(regular)).toBe(regular);
  });
});
