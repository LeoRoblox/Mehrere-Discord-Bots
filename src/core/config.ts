import dotenv from 'dotenv';
import { z } from 'zod';
import { logger } from './logger.js';

// Lädt .env Datei für die lokale Entwicklung
dotenv.config();

const SNOWFLAKE_REGEX = /^\d{17,20}$/;

/**
 * Die beiden getrennten Discord-Bots, die dieser Runner betreibt.
 * Jeder Bot ist eine EIGENE Discord-Anwendung mit eigenem Token und eigener Client-ID.
 */
export const BOT_ENV_DEFINITIONS = [
  {
    id: 'verify-bot',
    label: 'Verify-Bot',
    tokenEnvVar: 'VERIFY_BOT_TOKEN',
    clientIdEnvVar: 'VERIFY_BOT_CLIENT_ID'
  },
  {
    id: 'system-bot',
    label: 'System-Bot (Adminpanel)',
    tokenEnvVar: 'SYSTEM_BOT_TOKEN',
    clientIdEnvVar: 'SYSTEM_BOT_CLIENT_ID'
  }
] as const;

/** Alle Bot-Umgebungsvariablen, die zwingend gesetzt sein müssen (für Fehlermeldungen). */
export const REQUIRED_BOT_ENV_VARS: readonly string[] = BOT_ENV_DEFINITIONS.flatMap((bot) => [
  bot.tokenEnvVar,
  bot.clientIdEnvVar
]);

/** Zod-Schema für ein Discord-Bot-Token mit verständlicher, bot-spezifischer Fehlermeldung. */
function botTokenSchema(envVar: string, botLabel: string) {
  return z
    .string({
      required_error: `${envVar} fehlt – bitte das Discord-Bot-Token des ${botLabel} eintragen (Developer Portal -> Bot -> Token)`,
      invalid_type_error: `${envVar} muss ein Text sein`
    })
    .trim()
    .min(
      20,
      `${envVar} fehlt oder ist ungültig – bitte ein gültiges Discord-Bot-Token des ${botLabel} eintragen (Developer Portal -> Bot -> Token)`
    );
}

/** Zod-Schema für eine Discord Application-/Client-ID mit verständlicher, bot-spezifischer Fehlermeldung. */
function botClientIdSchema(envVar: string, botLabel: string) {
  return z
    .string({
      required_error: `${envVar} fehlt – bitte die Application-ID (Client-ID) des ${botLabel} eintragen (Developer Portal -> General Information)`,
      invalid_type_error: `${envVar} muss ein Text sein`
    })
    .trim()
    .min(
      1,
      `${envVar} fehlt – bitte die Application-ID (Client-ID) des ${botLabel} eintragen (Developer Portal -> General Information)`
    )
    .regex(
      SNOWFLAKE_REGEX,
      `${envVar} muss eine gültige 17- bis 20-stellige Discord-Snowflake-ID (Application-ID des ${botLabel}) sein`
    );
}

/**
 * Zod-Schema zur strikten Validierung aller erforderlichen Umgebungsvariablen beim Start
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
    PORT: z
      .string()
      .optional()
      .default('10000')
      .transform((val) => parseInt(val, 10))
      .refine((val) => !isNaN(val) && val > 0 && val < 65536, {
        message: 'PORT muss eine gültige Portnummer zwischen 1 und 65535 sein'
      }),
    BOT_OWNER_ID: z.string().regex(SNOWFLAKE_REGEX, {
      message: 'BOT_OWNER_ID muss eine gültige 17- bis 20-stellige Discord-Snowflake-ID sein'
    }),
    TURSO_DATABASE_URL: z.string().min(1, 'TURSO_DATABASE_URL darf nicht leer sein'),
    TURSO_AUTH_TOKEN: z.string().optional().default(''),

    // Bot 1: Verify-Bot (Verifizierungs-Bot) – eigene Discord-Anwendung
    VERIFY_BOT_TOKEN: botTokenSchema('VERIFY_BOT_TOKEN', 'Verify-Bots'),
    VERIFY_BOT_CLIENT_ID: botClientIdSchema('VERIFY_BOT_CLIENT_ID', 'Verify-Bots'),

    // Bot 2: System-Bot (Adminpanel) – eigene, vom Verify-Bot getrennte Discord-Anwendung
    SYSTEM_BOT_TOKEN: botTokenSchema('SYSTEM_BOT_TOKEN', 'System-Bots (Adminpanel)'),
    SYSTEM_BOT_CLIENT_ID: botClientIdSchema('SYSTEM_BOT_CLIENT_ID', 'System-Bots (Adminpanel)'),

    DISCORD_DEV_GUILD_ID: z.string().optional()
  })
  .superRefine((data, ctx) => {
    // Wenn es sich um eine remote Turso-URL handelt, ist TURSO_AUTH_TOKEN in Produktion erforderlich
    const isRemote =
      data.TURSO_DATABASE_URL.startsWith('libsql://') ||
      data.TURSO_DATABASE_URL.startsWith('https://');
    if (isRemote && data.NODE_ENV === 'production' && !data.TURSO_AUTH_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TURSO_AUTH_TOKEN'],
        message: 'TURSO_AUTH_TOKEN ist erforderlich, wenn eine Remote-Turso-URL verwendet wird'
      });
    }

    // Verify-Bot und System-Bot MÜSSEN zwei getrennte Discord-Anwendungen sein.
    // Identische Tokens würden dazu führen, dass beide Module denselben Discord-Account
    // verwenden und sich gegenseitig die Slash-Commands überschreiben.
    if (data.VERIFY_BOT_TOKEN === data.SYSTEM_BOT_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SYSTEM_BOT_TOKEN'],
        message:
          'SYSTEM_BOT_TOKEN darf nicht identisch mit VERIFY_BOT_TOKEN sein – Verify-Bot und System-Bot müssen zwei getrennte Discord-Anwendungen mit eigenem Token sein'
      });
    }

    if (data.VERIFY_BOT_CLIENT_ID === data.SYSTEM_BOT_CLIENT_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SYSTEM_BOT_CLIENT_ID'],
        message:
          'SYSTEM_BOT_CLIENT_ID darf nicht identisch mit VERIFY_BOT_CLIENT_ID sein – Verify-Bot und System-Bot müssen zwei getrennte Discord-Anwendungen mit eigener Client-ID sein'
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

let parsedConfig: AppConfig | null = null;

/**
 * Validiert die Umgebungsvariablen. Bricht den Start bei Fehlern transparent ab,
 * ohne sensible Daten preiszugeben.
 */
export function validateConfig(rawEnv: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(rawEnv);

  if (!result.success) {
    logger.error('❌ Ungültige Konfiguration / Fehlende Umgebungsvariablen:');
    for (const issue of result.error.issues) {
      logger.error(`   -> ${issue.path.join('.')}: ${issue.message}`);
    }

    const failedBotVars = result.error.issues
      .map((issue) => String(issue.path[0] ?? ''))
      .filter((key) => REQUIRED_BOT_ENV_VARS.includes(key));

    if (failedBotVars.length > 0) {
      logger.error(
        `ℹ️  Dieser Runner betreibt ZWEI getrennte Discord-Bots. Für jeden Bot werden ein eigenes Token und eine eigene Client-ID benötigt: ${REQUIRED_BOT_ENV_VARS.join(', ')} (Vorlage: .env.example).`
      );
    }

    const failedKeys = Array.from(
      new Set(result.error.issues.map((issue) => issue.path.join('.') || '(allgemein)'))
    );

    throw new Error(
      `Konfigurationsvalidierung fehlgeschlagen. Fehlerhafte oder fehlende Umgebungsvariablen: ${failedKeys.join(', ')}. Bitte prüfe die Umgebungsvariablen (Vorlage: .env.example).`
    );
  }

  parsedConfig = result.data;
  return parsedConfig;
}

/**
 * Gibt die validierte Konfiguration zurück. Initialisiert sie bei Bedarf.
 */
export function getConfig(): AppConfig {
  if (!parsedConfig) {
    return validateConfig();
  }
  return parsedConfig;
}
