import { describe, it, expect } from "vitest";
import { assessHealth } from "./quality-estimation.js";

describe("assessHealth", () => {
  describe("healthy scenarios", () => {
    it("fresh session with low tokens is healthy", () => {
      const result = assessHealth({
        tokenCount: 5_000,
        model: "claude-opus-4",
      });
      expect(result.status).toBe("healthy");
      expect(result.health_score).toBeGreaterThanOrEqual(90);
    });

    it("mid-session with moderate tokens is still healthy", () => {
      const result = assessHealth({
        tokenCount: 80_000,
        model: "claude-opus-4",
        sessionDurationMinutes: 10,
        toolCallsCount: 3,
      });
      expect(result.status).toBe("healthy");
      expect(result.health_score).toBeGreaterThanOrEqual(70);
    });
  });

  describe("warning scenarios", () => {
    it("in the danger zone with session fatigue triggers warning", () => {
      const result = assessHealth({
        tokenCount: 170_000,
        model: "claude-opus-4",
        sessionDurationMinutes: 60,
        toolCallsCount: 20,
      });
      expect(result.status).toBe("warning");
      expect(result.health_score).toBeGreaterThanOrEqual(40);
      expect(result.health_score).toBeLessThan(70);
    });
  });

  describe("danger scenarios", () => {
    it("deep in danger zone is danger", () => {
      const result = assessHealth({
        tokenCount: 190_000,
        model: "claude-opus-4",
        sessionDurationMinutes: 120,
        toolCallsCount: 40,
      });
      expect(result.status).toBe("danger");
      expect(result.health_score).toBeLessThan(40);
    });
  });

  describe("token utilization", () => {
    it("reports correct danger zone for the model", () => {
      const result = assessHealth({
        tokenCount: 50_000,
        model: "claude-opus-4",
      });
      expect(result.token_utilization.danger_zone_starts_at).toBe(170_000);
      expect(result.token_utilization.current).toBe(50_000);
    });

    it("calculates percentage relative to danger zone", () => {
      const result = assessHealth({
        tokenCount: 85_000,
        model: "claude-opus-4",
      });
      // 85000 / 170000 = 50%
      expect(result.token_utilization.percentage).toBe(50);
    });
  });

  describe("unknown model fallback", () => {
    it("uses conservative 'other' profile for unknown models", () => {
      const result = assessHealth({
        tokenCount: 90_000,
        model: "llama-4",
      });
      // 'other' has dangerZone of 100_000
      expect(result.token_utilization.danger_zone_starts_at).toBe(100_000);
      expect(result.token_utilization.percentage).toBe(90);
    });
  });

  describe("tool-call burden", () => {
    it("low tool calls have low burden", () => {
      const result = assessHealth({
        tokenCount: 10_000,
        model: "claude-opus-4",
        toolCallsCount: 3,
      });
      expect(result.session_fatigue.tool_call_burden).toBe("low");
    });

    it("high tool calls have high burden", () => {
      const result = assessHealth({
        tokenCount: 10_000,
        model: "claude-opus-4",
        toolCallsCount: 25,
      });
      expect(result.session_fatigue.tool_call_burden).toBe("high");
    });

    it("very high tool calls have critical burden", () => {
      const result = assessHealth({
        tokenCount: 10_000,
        model: "claude-opus-4",
        toolCallsCount: 50,
      });
      expect(result.session_fatigue.tool_call_burden).toBe("critical");
    });
  });

  describe("session length risk", () => {
    it("short session is low risk", () => {
      const result = assessHealth({
        tokenCount: 10_000,
        model: "claude-opus-4",
        sessionDurationMinutes: 5,
      });
      expect(result.session_fatigue.session_length_risk).toBe("low");
    });

    it("long session is high risk", () => {
      const result = assessHealth({
        tokenCount: 10_000,
        model: "claude-opus-4",
        sessionDurationMinutes: 60,
      });
      expect(result.session_fatigue.session_length_risk).toBe("high");
    });
  });

  describe("quality estimate", () => {
    it("low tokens have excellent retrieval", () => {
      const result = assessHealth({
        tokenCount: 5_000,
        model: "claude-opus-4",
      });
      expect(result.quality_estimate.retrieval_accuracy).toBe("excellent");
      expect(result.quality_estimate.middle_content_risk).toBe("low");
      expect(result.quality_estimate.estimated_hallucination_risk).toBe("low");
    });

    it("high tokens degrade retrieval and increase hallucination risk", () => {
      const result = assessHealth({
        tokenCount: 180_000,
        model: "claude-opus-4",
      });
      expect(["degrading", "poor"]).toContain(
        result.quality_estimate.retrieval_accuracy,
      );
      expect(["high", "critical"]).toContain(
        result.quality_estimate.middle_content_risk,
      );
    });
  });

  describe("optional parameters", () => {
    it("works with only token_count and model", () => {
      const result = assessHealth({
        tokenCount: 50_000,
        model: "claude-opus-4",
      });
      expect(result.health_score).toBeGreaterThan(0);
      expect(result.session_fatigue.tool_call_burden).toBe("low");
      expect(result.session_fatigue.session_length_risk).toBe("low");
    });

    it("works with only token_count (defaults model to 'other')", () => {
      const result = assessHealth({
        tokenCount: 50_000,
        model: "other",
      });
      expect(result.health_score).toBeGreaterThan(0);
    });
  });
});
