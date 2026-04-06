// ============================================================
// @mariabelle/identifier — JID utilities
//
// Pure string functions. Zero dependencies. Zero DB. Zero network.
// ============================================================

/**
 * Extract the plain phone number from a JID.
 * Strips both the @domain suffix and any :N multi-device suffix.
 *
 * "447911234567:3@s.whatsapp.net" → "447911234567"
 * "447911234567@s.whatsapp.net"   → "447911234567"
 * "447911234567"                  → "447911234567"
 */
export function getNumber(jid: string): string {
  // Strip @domain first, then strip :N device suffix.
  const atIdx = jid.indexOf('@');
  const local = atIdx !== -1 ? jid.slice(0, atIdx) : jid;
  const colonIdx = local.indexOf(':');
  return colonIdx !== -1 ? local.slice(0, colonIdx) : local;
}

/**
 * Normalise a JID by removing the :N multi-device suffix.
 * Keeps the @domain intact.
 *
 * "447911234567:3@s.whatsapp.net" → "447911234567@s.whatsapp.net"
 * "447911234567@s.whatsapp.net"   → "447911234567@s.whatsapp.net"
 */
export function normalizeJid(jid: string): string {
  const atIdx = jid.indexOf('@');
  if (atIdx === -1) {
    // No @domain — strip :N if present, return as-is.
    const colonIdx = jid.indexOf(':');
    return colonIdx !== -1 ? jid.slice(0, colonIdx) : jid;
  }
  const domain = jid.slice(atIdx);          // "@s.whatsapp.net"
  const local  = jid.slice(0, atIdx);       // "447911234567:3"
  const colonIdx = local.indexOf(':');
  const cleanLocal = colonIdx !== -1 ? local.slice(0, colonIdx) : local;
  return cleanLocal + domain;
}

/**
 * Returns true for group JIDs (end with @g.us).
 */
export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us');
}

/**
 * Returns true if the JID belongs to the bot itself.
 */
export function isSelf(jid: string, selfNumber: string): boolean {
  return getNumber(jid) === selfNumber;
}

/**
 * Format a JID as a display string: "+447911234567".
 * Just prepends "+" — no libphonenumber dependency.
 */
export function formatDisplay(jid: string): string {
  return '+' + getNumber(jid);
}
