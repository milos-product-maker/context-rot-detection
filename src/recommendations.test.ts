import { describe, it, expect } from "vitest";
import { assessHealth } from "./quality-estimation.js";
import { generateRecommendations } from "./recommendations.js";

describe("generateRecommendations", () => {
  it("returns 'continue' for a healthy session", () => {
    const assessment = assessHealth({
      tokenCount: 5_000,
      model: "claude-opus-4",
      toolCallsCount: 2,
      sessionDurationMinutes: 5,
    });
    const recs = generateRecommendations(assessment);
    expect(recs).toHaveLength(1);
    expect(recs[0].action).toBe("continue");
    expect(recs[0].priority).toBe("low");
  });

  it("recommends compact_context when approaching danger zone", () => {
    const assessment = assessHealth({
      tokenCount: 150_000,
      model: "claude-opus-4",
    });
    const recs = generateRecommendations(assessment);
    const compactRec = recs.find((r) => r.action === "compact_context");
    expect(compactRec).toBeDefined();
    expect(["high", "critical"]).toContain(compactRec!.priority);
  });

  it("recommends immediate_context_reset when past danger zone", () => {
    const assessment = assessHealth({
      tokenCount: 195_000,
      model: "claude-opus-4",
    });
    const recs = generateRecommendations(assessment);
    const resetRec = recs.find((r) => r.action === "immediate_context_reset");
    expect(resetRec).toBeDefined();
    expect(resetRec!.priority).toBe("critical");
  });

  it("recommends offload_to_memory when middle content risk is high", () => {
    // At 160K tokens with opus-4 (maxTokens 200K), ratio = 0.8 → high/critical middle risk
    const assessment = assessHealth({
      tokenCount: 160_000,
      model: "claude-opus-4",
    });
    const recs = generateRecommendations(assessment);
    const memoryRec = recs.find((r) => r.action === "offload_to_memory");
    expect(memoryRec).toBeDefined();
  });

  it("recommends break_into_subtasks for high tool call burden", () => {
    const assessment = assessHealth({
      tokenCount: 10_000,
      model: "claude-opus-4",
      toolCallsCount: 35,
    });
    const recs = generateRecommendations(assessment);
    const subtaskRec = recs.find((r) => r.action === "break_into_subtasks");
    expect(subtaskRec).toBeDefined();
  });

  it("recommends session_checkpoint for long sessions", () => {
    const assessment = assessHealth({
      tokenCount: 10_000,
      model: "claude-opus-4",
      sessionDurationMinutes: 120,
    });
    const recs = generateRecommendations(assessment);
    const checkpointRec = recs.find((r) => r.action === "session_checkpoint");
    expect(checkpointRec).toBeDefined();
  });

  it("recommends verify_outputs when hallucination risk is high", () => {
    // High tokens + high tool calls → elevated hallucination risk
    const assessment = assessHealth({
      tokenCount: 185_000,
      model: "claude-opus-4",
      toolCallsCount: 35,
    });
    const recs = generateRecommendations(assessment);
    const verifyRec = recs.find((r) => r.action === "verify_outputs");
    expect(verifyRec).toBeDefined();
  });

  it("sorts recommendations by priority (critical first)", () => {
    const assessment = assessHealth({
      tokenCount: 195_000,
      model: "claude-opus-4",
      toolCallsCount: 40,
      sessionDurationMinutes: 120,
    });
    const recs = generateRecommendations(assessment);
    expect(recs.length).toBeGreaterThan(1);

    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    for (let i = 1; i < recs.length; i++) {
      expect(priorityOrder[recs[i].priority]).toBeGreaterThanOrEqual(
        priorityOrder[recs[i - 1].priority],
      );
    }
  });

  it("every recommendation has a positive or zero quality gain", () => {
    const assessment = assessHealth({
      tokenCount: 185_000,
      model: "claude-opus-4",
      toolCallsCount: 30,
      sessionDurationMinutes: 90,
    });
    const recs = generateRecommendations(assessment);
    for (const rec of recs) {
      expect(rec.estimated_quality_gain).toBeGreaterThanOrEqual(0);
    }
  });
});
