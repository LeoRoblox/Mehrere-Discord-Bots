import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../src/core/rate-limiter.js';

describe('Rate Limiter & Retry Utility', () => {
  it('returns result immediately on successful execution', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await withRetry(fn, { maxRetries: 3, initialDelayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and resolves when subsequent attempt succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient failure 1'))
      .mockRejectedValueOnce(new Error('transient failure 2'))
      .mockResolvedValue('eventual success');

    const result = await withRetry(fn, {
      maxRetries: 3,
      initialDelayMs: 5,
      factor: 1.5
    });

    expect(result).toBe('eventual success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws when maxRetries is exceeded', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent error'));

    await expect(
      withRetry(fn, {
        maxRetries: 2,
        initialDelayMs: 5
      })
    ).rejects.toThrow('persistent error');

    expect(fn).toHaveBeenCalledTimes(2);
  });
});
