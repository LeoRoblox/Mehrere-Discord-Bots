# 🤖 Mehrere-Discord-Bots: Produktionsfähiger Multi-Bot Runner

Ein hochgradig ressourcenschonender, modularer Multi-Discord-Bot-Runner für **Node.js (TypeScript)** und **Turso (libSQL)**, maßgeschneidert für den Betrieb auf einem **Render Free Web Service** (ca. 0,1 CPU / 400–512 MB RAM).

---

## 📑 Inhaltsverzeichnis

1. [Architektur & Besonderheiten](#-architektur--besonderheiten)
2. [Aktive Bots im System](#-aktive-bots-im-system)
   - [Bot 1: Verifizierungs-Bot (Christlichernico)](#bot-1-verifizierungs-bot-christlichernico)
3. [Wichtige Plattform-Einschränkungen (Render, Discord, Turso, UptimeRobot)](#-wichtige-plattform-einschränkungen)
4. [Vollständige Schritt-für-Schritt-Einrichtung](#-vollständige-schritt-für-schritt-einrichtung)
   - [Schritt 1: Discord Developer Portal einrichten](#schritt-1-discord-developer-portal-einrichten)
   - [Schritt 2: Turso-Datenbank erstellen & verbinden](#schritt-2-turso-datenbank-erstellen--verbinden)
   - [Schritt 3: Slash-Commands registrieren](#schritt-3-slash-commands-registrieren)
   - [Schritt 4: Render Free Web Service deployen](#schritt-4-render-free-web-service-deployen)
   - [Schritt 5: UptimeRobot regelkonform konfigurieren](#schritt-5-uptimerobot-regelkonform-konfigurieren)
5. [Anleitung: Neuen Bot zum System hinzufügen](#-anleitung-neuen-bot-hinzufügen)
6. [Lokale Entwicklung & Tests](#-lokale-entwicklung--tests)
7. [Sicherheitshinweise](#-sicherheitshinweise)

---

## 🏛 Architektur & Besonderheiten

- **Single-Process Multi-Hosting:** Mehrere autonome Discord-Bots laufen in einer einzigen Node.js-Laufzeit. Das spart RAM und CPU-Zyklen.
- **Aggressives Speichermanagement:** Ungenutzte Discord-Caches (Nachrichten, Emojis, Reaktionen, Presences, etc.) sind vollständig deaktiviert (`Options.cacheWithLimits`). Der gesamte Speicherverbrauch beträgt nur ca. **100 MB RAM**, wodurch der Render Free-Tier (512 MB Limit) mühelos eingehalten wird.
- **Minimaler HTTP-Server:** Ein nativer `node:http`-Server (0 externe Webframework-Abhängigkeiten) bedient ausschließlich den Pfad `/health` mit `{"status":"ok"}`. Alle anderen Pfade liefern `404 Not Found`. Keine Dashboards, keine Frontends, keine Leaks interner Daten.
- **Zentrale libSQL / Turso Schicht:** Gemeinsame Datenbankverbindung mit automatischem Migrations-System (`_system_migrations`) und Namespace-Isolation je Bot.
- **Fehlerisolierung & Resilienz:** Sollte ein einzelnes Bot-Modul einen Fehler oder Verbindungsabbruch erleiden, laufen die übrigen Bots und der Health-Server unbeeinträchtigt weiter.
- **Log-Sanitizing:** Sensible Discord-Tokens, JWTs und Passwörter werden automatisch vor der Konsolenausgabe maskiert.
- **Graceful Shutdown:** Ordnungsgemäße Signalbehandlung (`SIGTERM`/`SIGINT`) für Render-Deployments ohne hängende Verbindungen.

---

## 🤖 Aktive Bots im System

### Bot 1: Verifizierungs-Bot (Christlichernico)

Vollständig implementierter, produktionsbereiter Bot für den **Christlichernico Community Server**.

- **Slash-Command:** `/verifysystem`
  - Richtet das Regelwerk und den Verifizierungs-Button im Kanal ein.
  - **Berechtigung:** Ausschließlich ausführbar von Benutzern mit einer der folgenden Rollen ODER dem `BOT_OWNER_ID`:
    - Rolle 1: `1548429120948670616`
    - Rolle 2: `1548458441566330970`
- **Container V2 & Embed-Fallback:**
  - Titel: `✝️ Christlichernico Community Server`
  - Vollständiges Regelwerk (12 Abschnitte: Respektvoller Umgang, Christlicher Umgang, Kein Spam, Werbung, Privatsphäre, Sicherheit, Gaming & Community, Voice-Channels, Unangemessene Inhalte, Team & Moderation, Bugs melden, Konsequenzen)
  - Grüner Erfolgs-Button: `[ ✅ Verifizieren ]`
- **Button-Interaktion (Verifizierung):**
  - Vergibt automatisch die Verifizierungs-Rolle: **`1550951446961332495`**
  - Antwortet mit einer **ephemeren Nachricht** (nur für den Klickenden sichtbar, Container V2):
    > _"Du hast bestätigt dass du die Regeln gelesen hast. **Unwissenheit schützt nicht vor Strafe!**"_
  - Speichert das Verifizierungsdatum in Turso in der Tabelle `verify_members` sowie ein Audit-Event in `verify_audit_log`.

---

## ⚖️ Wichtige Plattform-Einschränkungen

### 1. Render Free Tier

- **750 freie Instanzstunden pro Monat:** Ein Monat mit 31 Tagen hat 744 Stunden. Das Betreiben **aller Bots in diesem einen gemeinsamen Web Service** stellt sicher, dass das monatliche Freikontingent nicht überschritten wird.
- **15-Minuten Idle-Sleep:** Free Web Services auf Render fahren herunter, wenn für 15 Minuten kein eingehender HTTP-Traffic registriert wird.
- **Kaltstart:** Das Aufwachen nach dem Schlafzustand benötigt ca. 30–60 Sekunden.
- **Ressourcen:** 512 MB RAM und geteilte ca. 0,1 CPU.

### 2. Discord API & Gateway

- Discord-Bots benötigen eine dauerhafte WebSocket-Verbindung (Gateway).
- Wenn der Free-Tier-Service schläft, trennt sich der Gateway. Bei einem Aufweck-Request (z. B. durch UptimeRobot) verbindet sich der Runner automatisch neu und setzt die Session fort.
- **Intents:** Dieser Bot benötigt **keine** privilegierten Intents (kein `GuildMembers`-Intent erforderlich, da Interaktionen das `GuildMember`-Objekt direkt übermitteln).

### 3. Turso Free Tier

- 500 Millionen Row-Reads/Monat, 10 Millionen Row-Writes/Monat, 5 GB Speicherplatz und bis zu 100 Datenbanken kostenfrei. Ausreichend für hunderte Discord-Server.

---

## 🛠 Vollständige Schritt-für-Schritt-Einrichtung

### Schritt 1: Discord Developer Portal einrichten

1. Öffne das [Discord Developer Portal](https://discord.com/developers/applications).
2. Klicke auf **New Application** und gib einen Namen ein (z. B. `Christlichernico Bot`).
3. Kopiere unter **General Information** die **Application ID** (wird später als `VERIFY_BOT_CLIENT_ID` genutzt).
4. Gehe im linken Menü auf **Bot**:
   - Klicke auf **Reset Token** und kopiere das erzeugte Token (wird später als `VERIFY_BOT_TOKEN` in Render eingetragen).
   - **Privileged Gateway Intents:** Du musst **keine** privilegierten Intents (wie Presence oder Server Members) aktivieren! Das spart Berechtigungsprüfungen und massiv RAM.
5. **Rollen-Hierarchie auf deinem Discord-Server (WICHTIG):**
   - Gehe in Discord in die **Servereinstellungen -> Rollen**.
   - Ziehe die Rolle deines Bots in der Rollenliste **ÜBER** die Verifizierungs-Rolle (`1550951446961332495`). Ein Bot kann in Discord niemals Rollen vergeben, die gleichrangig oder höher als seine eigene höchste Rolle sind!
   - Gib der Bot-Rolle die Berechtigung **Rollen verwalten** (`Manage Roles`).
6. **Bot auf den Server einladen:**
   - Gehe im Developer Portal auf **OAuth2 -> URL Generator**.
   - Wähle unter **Scopes**: `bot` und `applications.commands`.
   - Wähle unter **Bot Permissions**:
     - `Manage Roles` (Rollen verwalten)
     - `Send Messages` (Nachrichten senden)
     - `Embed Links` (Links einbetten)
     - `Use Slash Commands` (Slash-Befehle verwenden)
   - Öffne die generierte URL im Browser und füge den Bot deinem Server hinzu.

---

### Schritt 2: Turso-Datenbank erstellen & verbinden

1. Falls noch nicht geschehen, erstelle ein kostenloses Konto auf [Turso.tech](https://turso.tech).
2. Installiere das Turso-CLI oder nutze das Web-Dashboard:
   ```bash
   turso db create discord-bots
   ```
3. Ermittle die Datenbank-URL:
   ```bash
   turso db show discord-bots --url
   # Beispiel: libsql://discord-bots-deinuser.turso.io
   ```
4. Erstelle ein sicheres Zugangs-Token:
   ```bash
   turso db tokens create discord-bots
   ```
5. Notiere dir die URL (`TURSO_DATABASE_URL`) und das Token (`TURSO_AUTH_TOKEN`).

---

### Schritt 3: Slash-Commands registrieren

**Gute Nachricht: Das erledigt der Bot jetzt automatisch bei jedem Start!** 🎉

Bei jedem Bot-Start (also auch nach jedem Render-Deployment oder Kaltstart) werden alle Slash-Commands automatisch bei Discord registriert:

1. **Global** – gilt für alle aktuellen und zukünftigen Server.
2. **Zusätzlich pro Server** – für jeden Server, auf dem der Bot aktuell Mitglied ist. Guild-Commands sind bei Discord **sofort aktiv** (keine Cache-Wartezeit von bis zu 60 Minuten wie bei globalen Commands). Es entstehen keine Duplikate: Ein Guild-Command mit demselben Namen überschreibt den globalen Command lokal.
3. **Beim Server-Beitritt** – tritt der Bot einem neuen Server bei, werden die Commands ebenfalls sofort registriert, ohne dass ein Neustart nötig ist.

> **Hinweis:** `DISCORD_DEV_GUILD_ID` schließt andere Server nicht mehr aus – sie wird nur zusätzlich bedient (praktisch für Tests).

Ein manuelles Registrieren ist damit nicht mehr nötig, aber weiterhin möglich (z. B. um Commands ohne Bot-Neustart zu aktualisieren):

1. Erstelle lokal eine `.env`-Datei (Vorlage: `.env.example`):
   ```bash
   cp .env.example .env
   ```
2. Trage dein `VERIFY_BOT_TOKEN`, `VERIFY_BOT_CLIENT_ID` und optional deine `DISCORD_DEV_GUILD_ID` ein.
3. Führe den Registrierungsbefehl aus (registriert jetzt ebenfalls global + auf allen Servern, auf denen der Bot ist):

   ```bash
   # Dry-Run (zeigt den Payload ohne Senden)
   npm run deploy-commands -- --dry-run

   # Echte Registrierung
   npm run deploy-commands
   ```

---

### Schritt 4: Render Free Web Service deployen

1. Logge dich auf [render.com](https://render.com) ein.
2. Klicke auf **New +** -> **Web Service**.
3. Verbinde dein GitHub-Repository `LeoRoblox/Mehrere-Discord-Bots` und wähle den Branch `arena/01a0bb2d-mehrere-discord-bots`.
4. Konfiguriere die Service-Details:
   - **Name:** `mehrere-discord-bots`
   - **Language:** `Node`
   - **Region:** `Frankfurt (EU Central)` (oder die dir am nächsten gelegene Region)
   - **Branch:** `arena/01a0bb2d-mehrere-discord-bots`
   - **Build Command:** `npm ci && npm run build`
   - **Start Command:** `npm run start`
   - **Instance Type:** `Free`
5. Öffne den Reiter **Advanced** -> **Health Check Path**:
   - Trage `/health` ein.
6. Trage im Bereich **Environment Variables** folgende Schlüssel ein:
   - `NODE_ENV`: `production`
   - `BOT_OWNER_ID`: Deine Discord-User-ID (z. B. `123456789012345678`)
   - `TURSO_DATABASE_URL`: Deine Turso-URL (`libsql://...`)
   - `TURSO_AUTH_TOKEN`: Dein Turso Auth Token
   - `VERIFY_BOT_TOKEN`: Das Discord Bot Token deines Verifizierungsbots
   - `VERIFY_BOT_CLIENT_ID`: Die Discord Application ID
7. Klicke auf **Deploy Web Service**.
8. Überprüfe das Bereitstellungs-Log:
   - Die Datenbankmigrationen werden automatisch beim Start ausgeführt.
   - Der Health-Check-Server lauscht auf `0.0.0.0:10000`.
   - Der Bot loggt sich bei Discord ein.
   - Der RAM-Verbrauch wird protokolliert (`RSS ~100MB`).

---

### Schritt 5: UptimeRobot regelkonform konfigurieren

Um den Health-Status des Services zu überwachen und über Ausfälle informiert zu werden:

1. Registriere dich kostenlos auf [uptimerobot.com](https://uptimerobot.com).
2. Klicke auf **Add New Monitor**:
   - **Monitor Type:** `HTTP(s)`
   - **Friendly Name:** `Discord Multi-Bot Health`
   - **URL (or IP):** `https://<dein-service-name>.onrender.com/health`
   - **Monitoring Interval:** `5 minutes` oder `10 minutes`
   - **HTTP Method:** `HEAD` oder `GET`
   - **Alert Contacts:** Deine E-Mail-Adresse
3. Klicke auf **Create Monitor**.

> **Transparenter Regelhinweis:**
> UptimeRobot dient primär der Erreichbarkeits- und Integritätsüberwachung deines Dienstes. Bei Render-Free-Instanzen verhindert regelmäßiger HTTP-Traffic zwar das vorzeitige Einschlafen nach 15 Minuten Inaktivität, garantiert jedoch **keine unterbrechungsfreie 24/7-Verfügbarkeit** (Render führt gelegentliche Restarts durch, und das Monatslimit von 750 Stunden darf über deinen Workspace hinweg nicht überschritten werden). Solltest du für eine große Community eine strikte 99,9 % SLA benötigen, empfiehlt Render das Upgrade auf den kleinsten Starter-Plan ($7/Monat) oder einen Hintergrund-Worker.

---

## ➕ Anleitung: Neuen Bot hinzufügen

Dank der zentralen Plugin- und Registry-Architektur kann jederzeit ein weiterer eigenständiger Bot hinzugefügt werden, ohne bestehenden Code zu stören:

1. **Neuen Ordner anlegen:**
   Erstelle unter `src/bots/` ein neues Verzeichnis, z. B. `src/bots/ticket-bot/`.

2. **Bot-Modul implementieren (`src/bots/ticket-bot/index.ts`):**

   ```typescript
   import { GatewayIntentBits } from 'discord.js';
   import type { IBotModule, BotContext } from '../../core/types.js';

   export const ticketBotModule: IBotModule = {
     id: 'ticket-bot',
     name: 'Ticket-System Bot',
     // Eindeutige eigene Umgebungsvariable für das Token:
     tokenEnvVar: 'TICKET_BOT_TOKEN',
     requiredIntents: [GatewayIntentBits.Guilds],
     migrations: [
       {
         id: '001_create_tickets',
         up: async (db) => {
           // Eigener Namespace mit eindeutigem Präfix ticket_*
           await db.execute(`
             CREATE TABLE IF NOT EXISTS ticket_records (
               ticket_id TEXT PRIMARY KEY,
               guild_id TEXT NOT NULL,
               user_id TEXT NOT NULL,
               status TEXT NOT NULL DEFAULT 'open',
               created_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
           `);
         }
       }
     ],
     commands: [
       /* Deine Slash-Commands */
     ],
     buttons: [
       /* Deine Button-Handler */
     ],
     async onInit(ctx: BotContext) {
       ctx.logger.info('Ticket-Bot initialisiert!');
     }
   };
   ```

3. **In `src/index.ts` registrieren:**

   ```typescript
   import { ticketBotModule } from './bots/ticket-bot/index.js';

   // Nach dem Verifizierungs-Bot einfach registrieren:
   registry.register(verifyBotModule);
   registry.register(ticketBotModule);
   ```

4. **In Render & `.env` hinterlegen:**
   - Trage in der Render Web Service Konfiguration die neue geheime Umgebungsvariable `TICKET_BOT_TOKEN` ein.
   - Nach dem nächsten Push baut Render die Anwendung automatisch neu. Beide Bots teilen sich dieselbe Laufzeit, denselben Health-Check und dieselbe Turso-Datenbank bei minimalem Ressourcenverbrauch!

---

## 💻 Lokale Entwicklung & Tests

```bash
# Abhängigkeiten installieren
npm ci

# Typecheck & Build
npm run build

# Linter ausführen
npm run lint

# Automatisierte Tests ausführen (Vitest)
npm run test

# Diagnosetest für Umgebung & Turso-Verbindung
npm run test-connection

# Slash-Commands im Dry-Run Modus prüfen
npm run deploy-commands -- --dry-run
```

---

## 🔒 Sicherheitshinweise

- **Keine Secrets im Quellcode:** Weder Discord-Tokens noch Turso-Keys dürfen im Git-Repository gespeichert werden.
- **Strikte Start-Validierung:** Das System startet mit `zod`-Validierung nur, wenn alle erforderlichen Variablen im erwarteten Format vorliegen.
- **Owner-Schutz:** Kritische Befehle überprüfen server- und code-seitig immer die Discord-ID gegen `BOT_OWNER_ID` und vertrauen niemals reiner Client-seitiger Verborgenheit.
- **Minimaler Attack Surface:** Der HTTP-Server bietet keinerlei interaktive Webfunktionen, Dateiauslieferungen oder Schnittstellen außer `/health`.
