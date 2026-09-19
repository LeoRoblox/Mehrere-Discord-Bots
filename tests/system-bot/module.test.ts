import { describe, it, expect } from 'vitest';
import {
  ApplicationCommandOptionType,
  GatewayIntentBits,
  InteractionContextType
} from 'discord.js';
import { systemBotModule } from '../../src/bots/system-bot/index.js';
import { verifyBotModule } from '../../src/bots/verify-bot/index.js';
import { CUSTOM_ID_PATTERNS } from '../../src/bots/system-bot/ui.js';

describe('Zwei getrennte Bot-Module', () => {
  it('System-Bot verwendet SYSTEM_BOT_TOKEN / SYSTEM_BOT_CLIENT_ID und mindestens den Guilds-Intent', () => {
    expect(systemBotModule.id).toBe('system-bot');
    expect(systemBotModule.tokenEnvVar).toBe('SYSTEM_BOT_TOKEN');
    expect(systemBotModule.clientIdEnvVar).toBe('SYSTEM_BOT_CLIENT_ID');
    expect(systemBotModule.requiredIntents).toContain(GatewayIntentBits.Guilds);
  });

  it('Verify-Bot verwendet weiterhin VERIFY_BOT_TOKEN / VERIFY_BOT_CLIENT_ID', () => {
    expect(verifyBotModule.id).toBe('verify-bot');
    expect(verifyBotModule.tokenEnvVar).toBe('VERIFY_BOT_TOKEN');
    expect(verifyBotModule.clientIdEnvVar).toBe('VERIFY_BOT_CLIENT_ID');
    expect(verifyBotModule.requiredIntents).toEqual([GatewayIntentBits.Guilds]);
  });

  it('System-Bot registriert AUSSCHLIESSLICH /adminpanel – niemals /verifysystem', () => {
    const names = systemBotModule.commands.map((cmd) => cmd.data.name);
    expect(names).toEqual(['adminpanel']);
    expect(names).not.toContain('verifysystem');
  });

  it('Verify-Bot registriert AUSSCHLIESSLICH /verifysystem – niemals /adminpanel', () => {
    const names = verifyBotModule.commands.map((cmd) => cmd.data.name);
    expect(names).toEqual(['verifysystem']);
    expect(names).not.toContain('adminpanel');
  });

  it('Verify-Bot besitzt keine Adminpanel-Handler (Buttons, Select-Menüs, Modals)', () => {
    expect(verifyBotModule.buttons?.map((b) => String(b.customId))).toEqual([
      'verify_rules_accept_button'
    ]);
    expect(verifyBotModule.selectMenus ?? []).toHaveLength(0);
    expect(verifyBotModule.modals ?? []).toHaveLength(0);

    const verifyButtonIds = (verifyBotModule.buttons ?? []).map((b) => b.customId);
    for (const pattern of Object.values(CUSTOM_ID_PATTERNS)) {
      expect(verifyButtonIds).not.toContainEqual(pattern);
    }
  });

  it('Verify-Bot-Migrationen sind die ursprünglichen (nur 001_create_verify_tables)', () => {
    expect(verifyBotModule.migrations?.map((m) => m.id)).toEqual(['001_create_verify_tables']);
  });

  it('System-Bot besitzt eigene Migrationen und Handler für alle Interaktionstypen', () => {
    expect(systemBotModule.migrations?.map((m) => m.id)).toEqual([
      '001_create_system_warnings',
      '002_import_legacy_admin_warnings'
    ]);
    expect(systemBotModule.buttons).toHaveLength(2);
    expect(systemBotModule.selectMenus).toHaveLength(2);
    expect(systemBotModule.modals).toHaveLength(1);
  });

  it('Handler-Custom-IDs beider Bots überschneiden sich nicht', () => {
    const verifyIds = (verifyBotModule.buttons ?? []).map((b) => b.customId);
    const systemPatterns = [
      ...(systemBotModule.buttons ?? []),
      ...(systemBotModule.selectMenus ?? []),
      ...(systemBotModule.modals ?? [])
    ].map((h) => h.customId);

    for (const verifyId of verifyIds) {
      if (typeof verifyId !== 'string') continue;
      for (const pattern of systemPatterns) {
        const matches = typeof pattern === 'string' ? pattern === verifyId : pattern.test(verifyId);
        expect(matches).toBe(false);
      }
    }
  });
});

describe('/adminpanel Command-Definition', () => {
  it('hat eine Pflichtoption "user" vom Typ Discord-User und ist nur in Servern verfügbar', () => {
    const json = systemBotModule.commands[0].data.toJSON();
    expect(json.name).toBe('adminpanel');
    expect(json.options).toHaveLength(1);

    const option = json.options![0];
    expect(option.name).toBe('user');
    expect(option.type).toBe(ApplicationCommandOptionType.User);
    expect(option.required).toBe(true);

    expect(json.contexts).toEqual([InteractionContextType.Guild]);
  });
});
