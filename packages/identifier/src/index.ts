// ============================================================
// @mariabelle/identifier — Public API
// ============================================================

export { getNumber, normalizeJid, isGroupJid, isSelf, formatDisplay } from './jid.js';
export { createClassifier, insertUnverifiedBot } from './classifier.js';
export type { SenderType, KnownBot, ClassifyResult, Classifier } from './types.js';
