/**
 * Single source of truth for marketplace application field bounds (API + client forms).
 */
export const MARKETPLACE_APPLICATION_FIELD_LIMITS = {
  coverLetter: { min: 20, max: 8000 },
  proposedTimeline: { max: 2000 },
  portfolioUrl: { max: 2048 },
} as const;
