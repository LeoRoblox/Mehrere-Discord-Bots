/**
 * Konfiguration und Konstanten für den Verifizierungs-Bot
 * (Christlichernico Community Server)
 */
export const VERIFY_BOT_CONFIG = {
  // IDs der Rollen, die den Slash-Command /verifysystem ausführen dürfen
  ALLOWED_ROLE_IDS: ['1548429120948670616', '1548458441566330970'] as const,

  // ID der Rolle, die Mitgliedern nach Klick auf "Verifizieren" vergeben wird
  VERIFIED_ROLE_ID: '1550951446961332495',

  // Custom-ID für den Verifizierungs-Button
  VERIFY_BUTTON_ID: 'verify_rules_accept_button',

  // Container Titel & Inhalt
  RULES_TITLE: '✝️ Christlichernico Community Server',

  RULES_CONTENT: `### 📜 Offizielle Serverregeln

Willkommen auf dem **Christlichernico Community Server**!

Damit sich hier jeder wohlfühlen kann, gelten für alle Mitglieder die folgenden Regeln.

> **Mit dem Betreten und Nutzen des Servers akzeptierst du diese Regeln.**

---

## 1. 🤝 Respektvoller Umgang

* Behandle alle Mitglieder mit Respekt und Anstand.
* Beleidigungen, Mobbing, Belästigungen und persönliche Angriffe sind nicht erlaubt.
* Niemand wird aufgrund seiner Herkunft, Hautfarbe, Religion, Meinung, seines Geschlechts oder anderer persönlicher Eigenschaften angegriffen oder diskriminiert.
* Provokationen und unnötige Streitigkeiten sind zu vermeiden.
* Diskussionen sind erlaubt – respektloses Verhalten nicht.

## 2. ✝️ Christlicher Umgang

 *Der Server steht für einen* *christlich geprägten und respektvollen Umgang**.
* Respektiere den Glauben und die persönlichen Überzeugungen anderer.
* Niemand darf zum Glauben gezwungen oder wegen seines Glaubens verspottet werden.
* Religiöse Diskussionen dürfen geführt werden, solange sie sachlich und respektvoll bleiben.
* Hass, Hetze oder Abwertung anderer Religionen und Weltanschauungen sind nicht erlaubt.

## 3. 🚫 Kein Spam

* Kein Nachrichten-Spam.
* Kein sinnloses Wiederholen von Nachrichten, Emojis oder Zeichen.
* Kein unnötiges Pingen von Mitgliedern oder Teams.
* Vermeide übermäßiges Caps-Lock.
* Flooding in Text- oder Voice-Channels ist verboten.

## 4. 📢 Werbung

* Werbung für andere Server, Social-Media-Accounts, Websites oder eigene Projekte sind nicht erlaubt.
* Werbung per DM an andere Mitglieder ist nicht gestattet.
* Unaufgeforderte Werbung kann zu einem Timeout oder Bann führen.

## 5. 🔒 Privatsphäre & persönliche Daten

* Teile niemals private Daten anderer Personen.
* Dazu gehören beispielsweise Adressen, Telefonnummern, Passwörter oder private Bilder.
* Doxxing und das Veröffentlichen privater Informationen sind strengstens verboten.
* Respektiere die Privatsphäre jedes Mitglieds.

## 6. 🛡️ Sicherheit

* Kein Scamming, Phishing oder Betrug.
* Keine schädlichen Dateien oder Links.
* Keine Versuche, Accounts zu hacken oder Sicherheitslücken auszunutzen.
* Verdächtige Nachrichten oder Links bitte dem Team melden.

## 7. 🎮 Gaming & Community

* Cheating, Exploiting oder das absichtliche Ausnutzen von Bugs darf nicht dazu benutzt werden, andere zu schädigen.
* Fair Play und ein gutes Miteinander stehen an erster Stelle.
* Streitigkeiten aus Spielen sollen nicht auf den Server übertragen werden.

## 8. 🔊 Voice-Channels

* Respektiere andere Personen im Voice-Chat.
* Kein absichtliches Schreien, Soundboard-Spam oder extrem laute Geräusche.
* Keine störenden Hintergrundgeräusche, wenn andere dadurch beeinträchtigt werden.
* Lass andere ausreden und halte dich an normale Gesprächsregeln.

## 9. 🖼️ Unangemessene Inhalte

* Pornografische, extrem gewalttätige oder anderweitig ungeeignete Inhalte sind verboten.
* Keine Inhalte, die andere Mitglieder absichtlich schockieren oder belästigen.
* Auch Profilbilder, Namen und Status sollten angemessen bleiben.

## 10. 👮 Team & Moderation

* Anweisungen des Serverteams sind zu respektieren.
* Moderationsentscheidungen dürfen sachlich hinterfragt werden.
* Diskussionen über Moderationsmaßnahmen gehören nicht in öffentliche Channels.
* Missbrauch von Moderationsrechten ist nicht erlaubt.
* Wenn du mit einer Entscheidung nicht einverstanden bist, wende dich an ein zuständiges Teammitglied.

## 11. 🐛 Bugs & Regelverstöße melden

* Gefundene Bugs oder Probleme sollten dem Team gemeldet werden.
* Regelverstöße bitte nicht öffentlich eskalieren, sondern einem Teammitglied melden.
* Bewusstes Ausnutzen eines Bugs kann ebenfalls sanktioniert werden.

## 12. ⚖️ Konsequenzen

Je nach Situation können Regelverstöße zu folgenden Maßnahmen führen:

**1.** Verwarnung
**2.** Timeout
**3.** Kick
**4.** Temporärer Bann
**5.** Permanenter Bann

Die Konsequenz hängt von der Schwere und Häufigkeit des Verstoßes ab.

> **Schwere Verstöße können auch ohne vorherige Verwarnung zu ein einem direkten Bann führen.**

### ✝️ Gott segne euch ❤️`,

  // Button Eigenschaften
  BUTTON_LABEL: 'Verifizieren',
  BUTTON_EMOJI: '✅',

  // Ephemere Bestätigungsnachricht
  CONFIRMATION_TEXT:
    'Du hast bestätigt dass du die Regeln gelesen hast. **Unwissenheit schützt nicht vor Strafe!**',

  // Akzentfarbe (Grün / Christlich-Elegantes Dunkelgrün/Smaragd)
  ACCENT_COLOR: 0x2ecc71
} as const;
