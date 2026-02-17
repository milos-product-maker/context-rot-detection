/**
 * Recommendation engine.
 *
 * Analyzes health assessment results and produces prioritized,
 * actionable recovery recommendations.
 */

import type { HealthAssessment, RiskLevel } from "./quality-estimation.js";

export interface Recommendation {
  priority: "critical" | "high" | "medium" | "low";
  action: string;
  reason: string;
  estimated_quality_gain: number;
}

/**
 * Generate recommendations based on current health assessment.
 *
 * Recommendations are ordered by priority (critical first) and
 * estimated quality gain.
 */
export function generateRecommendations(
  assessment: HealthAssessment,
): Recommendation[] {
  const recs: Recommendation[] = [];

  // Token utilization recommendations
  const utilPct = assessment.token_utilization.percentage;

  if (utilPct >= 100) {
    recs.push({
      priority: "critical",
      action: "immediate_context_reset",
      reason:
        "You have exceeded the effective quality threshold. Context quality is severely degraded. Save critical state to external memory and start a fresh session immediately.",
      estimated_quality_gain: 40,
    });
  } else if (utilPct >= 80) {
    recs.push({
      priority: "critical",
      action: "compact_context",
      reason:
        "You are deep in the danger zone. Aggressively summarize all older context, remove completed task details, and retain only active task information.",
      estimated_quality_gain: 25,
    });
  } else if (utilPct >= 60) {
    recs.push({
      priority: "high",
      action: "compact_context",
      reason:
        "You are approaching the effective quality threshold. Summarize older context and remove completed task details.",
      estimated_quality_gain: 15,
    });
  } else if (utilPct >= 40) {
    recs.push({
      priority: "medium",
      action: "plan_compaction",
      reason:
        "Token usage is moderate. Begin planning which context can be safely summarized or offloaded before you reach the degradation zone.",
      estimated_quality_gain: 5,
    });
  }

  // Middle-content risk recommendations
  if (
    assessment.quality_estimate.middle_content_risk === "high" ||
    assessment.quality_estimate.middle_content_risk === "critical"
  ) {
    recs.push({
      priority: riskToPriority(assessment.quality_estimate.middle_content_risk),
      action: "offload_to_memory",
      reason:
        "High risk of lost-in-the-middle effect. Key decisions and facts in the middle of your context may already be unretrievable. Store critical information to external memory before it is effectively lost.",
      estimated_quality_gain: 8,
    });
  }

  // Tool-call burden recommendations
  if (
    assessment.session_fatigue.tool_call_burden === "high" ||
    assessment.session_fatigue.tool_call_burden === "critical"
  ) {
    recs.push({
      priority: riskToPriority(assessment.session_fatigue.tool_call_burden),
      action: "break_into_subtasks",
      reason:
        "High number of tool calls has accumulated significant context overhead. Break remaining work into independent sub-tasks that can each start with a fresh, focused context.",
      estimated_quality_gain: 12,
    });
  }

  // Session length recommendations
  if (
    assessment.session_fatigue.session_length_risk === "high" ||
    assessment.session_fatigue.session_length_risk === "critical"
  ) {
    recs.push({
      priority: riskToPriority(assessment.session_fatigue.session_length_risk),
      action: "session_checkpoint",
      reason:
        "This session has been running for a long time. Create a checkpoint by documenting current state, decisions made, and next steps — then consider continuing in a fresh session.",
      estimated_quality_gain: 10,
    });
  }

  // Hallucination risk recommendations
  if (
    assessment.quality_estimate.estimated_hallucination_risk === "high" ||
    assessment.quality_estimate.estimated_hallucination_risk === "critical"
  ) {
    recs.push({
      priority: riskToPriority(
        assessment.quality_estimate.estimated_hallucination_risk,
      ),
      action: "verify_outputs",
      reason:
        "Elevated hallucination risk detected. Double-check facts, re-read source material before citing it, and consider re-verifying recent conclusions against original data.",
      estimated_quality_gain: 5,
    });
  }

  // If everything looks good, give a positive signal
  if (recs.length === 0) {
    recs.push({
      priority: "low",
      action: "continue",
      reason:
        "Context health is good. No immediate action needed. Continue your current task.",
      estimated_quality_gain: 0,
    });
  }

  // Sort by priority weight (critical first), then by quality gain
  return recs.sort((a, b) => {
    const pw = priorityWeight(a.priority) - priorityWeight(b.priority);
    if (pw !== 0) return pw;
    return b.estimated_quality_gain - a.estimated_quality_gain;
  });
}

function riskToPriority(risk: RiskLevel): Recommendation["priority"] {
  switch (risk) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "moderate":
      return "medium";
    case "low":
      return "low";
  }
}

function priorityWeight(p: Recommendation["priority"]): number {
  switch (p) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
  }
}
