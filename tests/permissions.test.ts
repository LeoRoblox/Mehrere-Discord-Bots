import { describe, it, expect } from 'vitest';
import { canExecuteVerifySystem } from '../src/bots/verify-bot/commands/verifysystem.js';

describe('Verify Bot Permission Logic', () => {
  const OWNER_ID = '999999999999999999';
  const ROLE_1 = '1548429120948670616';
  const ROLE_2 = '1548458441566330970';
  const RANDOM_ROLE = '111111111111111111';
  const NORMAL_USER_ID = '123456789012345678';

  it('allows the global BOT_OWNER_ID regardless of roles', () => {
    const isAllowed = canExecuteVerifySystem(OWNER_ID, [], OWNER_ID);
    expect(isAllowed).toBe(true);
  });

  it('allows members with the first authorized role ID (1548429120948670616)', () => {
    const isAllowed = canExecuteVerifySystem(NORMAL_USER_ID, [ROLE_1], OWNER_ID);
    expect(isAllowed).toBe(true);
  });

  it('allows members with the second authorized role ID (1548458441566330970)', () => {
    const isAllowed = canExecuteVerifySystem(NORMAL_USER_ID, [ROLE_2], OWNER_ID);
    expect(isAllowed).toBe(true);
  });

  it('allows members with multiple roles including at least one authorized role', () => {
    const isAllowed = canExecuteVerifySystem(NORMAL_USER_ID, [RANDOM_ROLE, ROLE_2], OWNER_ID);
    expect(isAllowed).toBe(true);
  });

  it('denies execution to normal members without authorized roles', () => {
    const isAllowed = canExecuteVerifySystem(NORMAL_USER_ID, [RANDOM_ROLE], OWNER_ID);
    expect(isAllowed).toBe(false);
  });

  it('denies execution to members with empty roles list who are not the owner', () => {
    const isAllowed = canExecuteVerifySystem(NORMAL_USER_ID, [], OWNER_ID);
    expect(isAllowed).toBe(false);
  });
});
