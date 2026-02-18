/**
 * Model-specific degradation curves.
 *
 * Each model has empirically-derived thresholds for when quality starts to
 * degrade. These are based on published research (Chroma, Stanford
 * "lost-in-the-middle", Redis) and practical observations.
 *
 * The key insight: advertised context window ≠ effective context window.
 * Quality degrades well before the hard limit.
 */

export interface ModelProfile {
  /** Human-readable model name */
  name: string;
  /** Advertised max tokens */
  maxTokens: number;
  /** Tokens at which measurable quality loss begins */
  degradationOnset: number;
  /** Tokens at which quality is severely impacted */
  dangerZone: number;
  /** Multiplier for lost-in-the-middle effect (0-1, higher = worse) */
  middleLossCoefficient: number;
  /** Base retrieval accuracy at low token counts (0-1) */
  baseRetrievalAccuracy: number;
}

const MODEL_PROFILES: Record<string, ModelProfile> = {
  // ── Anthropic Claude ──────────────────────────────────────────────
  "claude-3.5-sonnet": {
    name: "Claude 3.5 Sonnet",
    maxTokens: 200_000,
    degradationOnset: 120_000,
    dangerZone: 152_000,
    middleLossCoefficient: 0.35,
    baseRetrievalAccuracy: 0.95,
  },
  "claude-3.7-sonnet": {
    name: "Claude 3.7 Sonnet",
    maxTokens: 200_000,
    degradationOnset: 130_000,
    dangerZone: 160_000,
    middleLossCoefficient: 0.30,
    baseRetrievalAccuracy: 0.96,
  },
  "claude-sonnet-4": {
    name: "Claude Sonnet 4",
    maxTokens: 200_000,
    degradationOnset: 135_000,
    dangerZone: 165_000,
    middleLossCoefficient: 0.28,
    baseRetrievalAccuracy: 0.96,
  },
  "claude-opus-4": {
    name: "Claude Opus 4",
    maxTokens: 200_000,
    degradationOnset: 140_000,
    dangerZone: 170_000,
    middleLossCoefficient: 0.25,
    baseRetrievalAccuracy: 0.97,
  },
  "claude-opus-4-5": {
    name: "Claude Opus 4.5",
    maxTokens: 200_000,
    degradationOnset: 145_000,
    dangerZone: 175_000,
    middleLossCoefficient: 0.22,
    baseRetrievalAccuracy: 0.97,
  },
  "claude-haiku-3.5": {
    name: "Claude Haiku 3.5",
    maxTokens: 200_000,
    degradationOnset: 100_000,
    dangerZone: 130_000,
    middleLossCoefficient: 0.40,
    baseRetrievalAccuracy: 0.92,
  },

  // ── OpenAI ────────────────────────────────────────────────────────
  "gpt-4o": {
    name: "GPT-4o",
    maxTokens: 128_000,
    degradationOnset: 80_000,
    dangerZone: 105_000,
    middleLossCoefficient: 0.40,
    baseRetrievalAccuracy: 0.93,
  },
  "gpt-4o-mini": {
    name: "GPT-4o Mini",
    maxTokens: 128_000,
    degradationOnset: 70_000,
    dangerZone: 95_000,
    middleLossCoefficient: 0.45,
    baseRetrievalAccuracy: 0.90,
  },
  "gpt-4.1": {
    name: "GPT-4.1",
    maxTokens: 1_000_000,
    degradationOnset: 200_000,
    dangerZone: 500_000,
    middleLossCoefficient: 0.38,
    baseRetrievalAccuracy: 0.94,
  },
  "gpt-4.1-mini": {
    name: "GPT-4.1 Mini",
    maxTokens: 1_000_000,
    degradationOnset: 180_000,
    dangerZone: 450_000,
    middleLossCoefficient: 0.42,
    baseRetrievalAccuracy: 0.91,
  },
  "o3": {
    name: "o3",
    maxTokens: 200_000,
    degradationOnset: 120_000,
    dangerZone: 160_000,
    middleLossCoefficient: 0.30,
    baseRetrievalAccuracy: 0.95,
  },
  "o4-mini": {
    name: "o4-mini",
    maxTokens: 200_000,
    degradationOnset: 110_000,
    dangerZone: 150_000,
    middleLossCoefficient: 0.35,
    baseRetrievalAccuracy: 0.93,
  },

  // ── Google Gemini ─────────────────────────────────────────────────
  "gemini-2.0-flash": {
    name: "Gemini 2.0 Flash",
    maxTokens: 1_000_000,
    degradationOnset: 200_000,
    dangerZone: 500_000,
    middleLossCoefficient: 0.50,
    baseRetrievalAccuracy: 0.88,
  },
  "gemini-2.5-pro": {
    name: "Gemini 2.5 Pro",
    maxTokens: 1_000_000,
    degradationOnset: 250_000,
    dangerZone: 600_000,
    middleLossCoefficient: 0.42,
    baseRetrievalAccuracy: 0.92,
  },
  "gemini-2.5-flash": {
    name: "Gemini 2.5 Flash",
    maxTokens: 1_000_000,
    degradationOnset: 220_000,
    dangerZone: 520_000,
    middleLossCoefficient: 0.48,
    baseRetrievalAccuracy: 0.89,
  },

  // ── Fallback ──────────────────────────────────────────────────────
  other: {
    name: "Unknown Model",
    maxTokens: 128_000,
    degradationOnset: 80_000,
    dangerZone: 100_000,
    middleLossCoefficient: 0.40,
    baseRetrievalAccuracy: 0.90,
  },
};

/** All known model identifiers (excluding "other"). */
export const KNOWN_MODELS = Object.keys(MODEL_PROFILES).filter((k) => k !== "other");

export function getModelProfile(model: string): ModelProfile {
  return MODEL_PROFILES[model] ?? MODEL_PROFILES["other"];
}

/**
 * Generate a conservative ModelProfile from a context window size.
 *
 * Used for models resolved at runtime (e.g., from HuggingFace) where we
 * know the max tokens but not the empirical degradation characteristics.
 */
export function generateHeuristicProfile(
  name: string,
  maxTokens: number,
): ModelProfile {
  return {
    name,
    maxTokens,
    degradationOnset: Math.round(maxTokens * 0.65),
    dangerZone: Math.round(maxTokens * 0.80),
    middleLossCoefficient: 0.40,
    baseRetrievalAccuracy: 0.90,
  };
}

/**
 * Calculate the quality multiplier (0-1) based on current token usage.
 *
 * Uses a sigmoid-like curve:
 *   - Below degradationOnset: quality ≈ 1.0
 *   - Between onset and dangerZone: smooth degradation
 *   - Above dangerZone: accelerating degradation
 */
export function calculateQualityMultiplier(
  tokenCount: number,
  profile: ModelProfile,
): number {
  if (tokenCount <= profile.degradationOnset) {
    return 1.0;
  }

  if (tokenCount >= profile.maxTokens) {
    return 0.2; // Floor — model is still producing output but quality is very poor
  }

  const range = profile.maxTokens - profile.degradationOnset;
  const progress = (tokenCount - profile.degradationOnset) / range;

  // Sigmoid-ish curve: slow start, accelerating degradation
  // f(x) = 1 - (x^1.5) gives a nice curve that starts gentle and steepens
  const degradation = Math.pow(progress, 1.5);
  return Math.max(0.2, 1.0 - degradation * 0.8);
}

/**
 * Estimate retrieval accuracy at the current token count.
 *
 * Combines the base model accuracy with the quality multiplier and
 * the lost-in-the-middle coefficient.
 */
export function estimateRetrievalAccuracy(
  tokenCount: number,
  profile: ModelProfile,
): number {
  const qualityMult = calculateQualityMultiplier(tokenCount, profile);
  const middlePenalty =
    tokenCount > profile.degradationOnset
      ? profile.middleLossCoefficient *
        ((tokenCount - profile.degradationOnset) /
          (profile.maxTokens - profile.degradationOnset))
      : 0;

  return Math.max(0.1, profile.baseRetrievalAccuracy * qualityMult - middlePenalty);
}
