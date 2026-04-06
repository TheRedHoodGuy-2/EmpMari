// Typing simulation
export {
  TypingSimulator,
  SHORT_BRACKETS,
  NORMAL_BRACKETS,
  CLAIM_BRACKETS,
  type TypingBracket,
  type TypingSimulatorOptions,
  type PresenceAdapter,
} from './typing-simulator.js';

// Decision engine
export { createHumaniser } from './humaniser.js';
export type {
  Humaniser,
  ClaimInput,
  ClaimDecision,
  HumaniserConfigRow,
} from './types.js';
