// ============================================================
// @mariabelle/identifier — Types
// ============================================================

export type SenderType = 'bot' | 'player' | 'self' | 'unknown';

export type KnownBot = {
  id: string;
  jid: string;       // normalised JID (no :N suffix)
  number: string;    // clean number, no @domain
  status: 'verified' | 'unverified';
  createdAt: string;
};

export type ClassifyResult = {
  jid: string;             // original jid as received
  normalizedJid: string;
  number: string;
  senderType: SenderType;
  isGroup: boolean;
  autoDiscovered: boolean; // true if we just inserted into known_bots
};

export type Classifier = {
  classify:   (senderJid: string) => Promise<ClassifyResult>;
  /** Evict a JID from the in-memory cache so the next classify() re-queries DB. */
  invalidate: (senderJid: string) => void;
};
