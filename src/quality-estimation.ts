/**
 * Quality estimation engine.
 *
 * Combines token analysis, lost-in-the-middle scoring, tool-call burden,
 * and session fatigue into a unified quality assessment.
 */

import {
  type ModelProfile,
  calculateQualityMultiplier,
  estimateRetrievalAccuracy,
  getModelProfile,
} from "./degradation-curves.js";

export type RiskLevel = "low" | "moderate" | "high" | "critical";
export type RetrievalStatus = "excellent" | "good" | "degrading" | "poor";
export type HealthStatus = "healthy" | "warning" | "danger";

export interface QualityEstimate {
  retrieval_accuracy: RetrievalStatus;
  middle_content_risk: RiskLevel;
  estimated_hallucination_risk: RiskLevel;
}

export interface TokenUtilization {
  current: number;
  max_effective: number;
  percentage: number;
  danger_zone_starts_at: number;
}

export interface SessionFatigue {
  tool_call_burden: RiskLevel;
  session_length_risk: RiskLevel;
  recommendation: string;
}

export interface HealthAssessment {
  health_score: number;
  status: HealthStatus;
  token_utilization: TokenUtilization;
  quality_estimate: QualityEstimate;
  session_fatigue: SessionFatigue;
}

export interface AssessmentInput {
  tokenCount: number;
  model: string;
  sessionDurationMinutes?: number;
  toolCallsCount?: number;
  contextSummary?: string;
}

/**
 * Calculate the lost-in-the-middle risk.
 *
 * As context grows, information in the middle of the context window becomes
 * harder to retrieve. This follows Stanford's "lost-in-the-middle" research.
 */
function calculateMiddleContentRisk(
  tokenCount: number,
  profile: ModelProfile,
): RiskLevel {
  const ratio = tokenCount / profile.maxTokens;
  if (ratio < 0.3) return "low";
  if (ratio < 0.5) return "moderate";
  if (ratio < 0.75) return "high";
  return "critical";
}

/**
 * Estimate hallucination risk based on quality degradation.
 *
 * As retrieval accuracy drops, the model increasingly confabulates to fill
 * gaps, leading to higher hallucination rates.
 */
function calculateHallucinationRisk(
  retrievalAccuracy: number,
  toolCallBurden: RiskLevel,
): RiskLevel {
  const toolPenalty =
    toolCallBurden === "critical"
      ? 0.15
      : toolCallBurden === "high"
        ? 0.1
        : toolCallBurden === "moderate"
          ? 0.05
          : 0;

  const adjustedAccuracy = retrievalAccuracy - toolPenalty;

  if (adjustedAccuracy > 0.85) return "low";
  if (adjustedAccuracy > 0.7) return "moderate";
  if (adjustedAccuracy > 0.5) return "high";
  return "critical";
}

/**
 * Assess tool-call burden.
 *
 * Each tool call adds context (input + output). After ~10 calls, the
 * accumulated context starts measurably degrading quality. After ~25 calls,
 * compounding effects become severe.
 */
function calculateToolCallBurden(toolCallsCount: number): RiskLevel {
  if (toolCallsCount <= 5) return "low";
  if (toolCallsCount <= 15) return "moderate";
  if (toolCallsCount <= 30) return "high";
  return "critical";
}

/**
 * Assess session length risk.
 *
 * Longer sessions accumulate more context even without tool calls.
 * Conversation history, clarifications, and corrections all add up.
 */
function calculateSessionLengthRisk(durationMinutes: number): RiskLevel {
  if (durationMinutes <= 15) return "low";
  if (durationMinutes <= 45) return "moderate";
  if (durationMinutes <= 90) return "high";
  return "critical";
}

function retrievalAccuracyToStatus(accuracy: number): RetrievalStatus {
  if (accuracy > 0.9) return "excellent";
  if (accuracy > 0.75) return "good";
  if (accuracy > 0.55) return "degrading";
  return "poor";
}

function sessionFatigueRecommendation(
  toolBurden: RiskLevel,
  sessionRisk: RiskLevel,
): string {
  if (toolBurden === "critical" || sessionRisk === "critical") {
    return "Session is critically fatigued. Strongly recommend starting a fresh session or performing aggressive context compaction immediately.";
  }
  if (toolBurden === "high" || sessionRisk === "high") {
    return "Significant session fatigue detected. Consider summarizing completed work and removing stale context before continuing.";
  }
  if (toolBurden === "moderate" || sessionRisk === "moderate") {
    return "Consider breaking into sub-tasks if complexity increases.";
  }
  return "Session fatigue is low. Continue as normal.";
}

/**
 * Compute a 0-100 health score from all signals.
 *
 * Weighted composition:
 *   - Token utilization quality: 40%
 *   - Retrieval accuracy: 25%
 *   - Tool-call burden: 20%
 *   - Session length: 15%
 */
function computeHealthScore(
  qualityMultiplier: number,
  retrievalAccuracy: number,
  toolCallsCount: number,
  sessionDurationMinutes: number,
): number {
  // Token quality: 0-1 → 0-40
  const tokenScore = qualityMultiplier * 40;

  // Retrieval accuracy: 0-1 → 0-25
  const retrievalScore = retrievalAccuracy * 25;

  // Tool burden: inverse mapping, 0-20
  const toolScore =
    toolCallsCount <= 5
      ? 20
      : toolCallsCount <= 15
        ? 15
        : toolCallsCount <= 30
          ? 8
          : 3;

  // Session length: inverse mapping, 0-15
  const sessionScore =
    sessionDurationMinutes <= 15
      ? 15
      : sessionDurationMinutes <= 45
        ? 12
        : sessionDurationMinutes <= 90
          ? 6
          : 2;

  return Math.round(
    Math.max(0, Math.min(100, tokenScore + retrievalScore + toolScore + sessionScore)),
  );
}

function scoreToStatus(score: number): HealthStatus {
  if (score >= 70) return "healthy";
  if (score >= 40) return "warning";
  return "danger";
}

/** Interface for model profile resolvers (e.g., HuggingFaceResolver). */
export interface ModelProfileResolver {
  resolveModelProfile(model: string): Promise<ModelProfile>;
}

/**
 * Main assessment function — the core of the quality estimation engine.
 *
 * When a resolver is provided, unknown models can be resolved at runtime
 * (e.g., from HuggingFace). Without a resolver, falls back to the
 * curated static profiles.
 */
export async function assessHealth(
  input: AssessmentInput,
  resolver?: ModelProfileResolver,
): Promise<HealthAssessment> {
  const profile = resolver
    ? await resolver.resolveModelProfile(input.model)
    : getModelProfile(input.model);
  const toolCallsCount = input.toolCallsCount ?? 0;
  const sessionDurationMinutes = input.sessionDurationMinutes ?? 0;

  const qualityMultiplier = calculateQualityMultiplier(input.tokenCount, profile);
  const retrievalAccuracy = estimateRetrievalAccuracy(input.tokenCount, profile);
  const toolBurden = calculateToolCallBurden(toolCallsCount);
  const sessionRisk = calculateSessionLengthRisk(sessionDurationMinutes);

  const healthScore = computeHealthScore(
    qualityMultiplier,
    retrievalAccuracy,
    toolCallsCount,
    sessionDurationMinutes,
  );

  const middleRisk = calculateMiddleContentRisk(input.tokenCount, profile);
  const hallucinationRisk = calculateHallucinationRisk(retrievalAccuracy, toolBurden);

  return {
    health_score: healthScore,
    status: scoreToStatus(healthScore),
    token_utilization: {
      current: input.tokenCount,
      max_effective: profile.dangerZone,
      percentage: Math.round((input.tokenCount / profile.dangerZone) * 1000) / 10,
      danger_zone_starts_at: profile.dangerZone,
    },
    quality_estimate: {
      retrieval_accuracy: retrievalAccuracyToStatus(retrievalAccuracy),
      middle_content_risk: middleRisk,
      estimated_hallucination_risk: hallucinationRisk,
    },
    session_fatigue: {
      tool_call_burden: toolBurden,
      session_length_risk: sessionRisk,
      recommendation: sessionFatigueRecommendation(toolBurden, sessionRisk),
    },
  };
}
