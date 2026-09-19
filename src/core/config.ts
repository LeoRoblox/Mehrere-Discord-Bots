import dotenv from 'dotenv';
import { z } from 'zod';
import { logger } from './logger.js';

// Lädt .env Datei für die lokale Entwicklung
dotenv.config();

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
    BOT_OWNER_ID: z.string().regex(/^\d{17,20}$/, {
      message: 'BOT_OWNER_ID muss eine gültige 17- bis 20-stellige Discord-Snowflake-ID sein'
    }),
    TURSO_DATABASE_URL: z.string().min(1, 'TURSO_DATABASE_URL darf nicht leer sein'),
    TURSO_AUTH_TOKEN: z.string().optional().default(''),
    // Bot 1 Token (Verifizierungsbot)
    VERIFY_BOT_TOKEN: z
      .string()
      .min(20, 'VERIFY_BOT_TOKEN muss ein gültiges Discord-Bot-Token sein'),
    VERIFY_BOT_CLIENT_ID: z
      .string()
      .regex(/^\d{17,20}$/, 'VERIFY_BOT_CLIENT_ID muss eine gültige Discord-Snowflake-ID sein')
      .optional(),
    DISCORD_DEV_GUILD_ID: z.string().optional()
  })
  .refine(
    (data) => {
      // Wenn es sich um eine remote Turso-URL handelt, ist TURSO_AUTH_TOKEN in Produktion erforderlich
      const isRemote =
        data.TURSO_DATABASE_URL.startsWith('libsql://') ||
        data.TURSO_DATABASE_URL.startsWith('https://');
      if (isRemote && data.NODE_ENV === 'production' && !data.TURSO_AUTH_TOKEN) {
        return false;
      }
      return true;
    },
    {
      message: 'TURSO_AUTH_TOKEN ist erforderlich, wenn eine Remote-Turso-URL verwendet wird',
      path: ['TURSO_AUTH_TOKEN']
    }
  );

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
    throw new Error(
      'Konfigurationsvalidierung fehlgeschlagen. Bitte prüfe die Umgebungsvariablen.'
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
