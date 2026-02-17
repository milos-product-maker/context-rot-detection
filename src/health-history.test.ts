import { describe, it, expect, beforeEach } from "vitest";
import { HealthHistoryStore } from "./health-history.js";
import { assessHealth } from "./quality-estimation.js";
import { generateRecommendations } from "./recommendations.js";

describe("HealthHistoryStore", () => {
  let store: HealthHistoryStore;

  beforeEach(() => {
    store = new HealthHistoryStore(":memory:");
  });

  describe("health check recording", () => {
    it("records and retrieves a health check", () => {
      const assessment = assessHealth({ tokenCount: 50_000, model: "claude-opus-4" });
      const recs = generateRecommendations(assessment);

      const id = store.record("agent-1", "claude-opus-4", 5, 10, assessment, recs);
      expect(id).toBeGreaterThan(0);

      const history = store.getHistory("agent-1");
      expect(history).toHaveLength(1);
      expect(history[0].agent_id).toBe("agent-1");
      expect(history[0].health_score).toBe(assessment.health_score);
    });

    it("returns empty history for unknown agent", () => {
      const history = store.getHistory("nonexistent");
      expect(history).toHaveLength(0);
    });

    it("respects the limit parameter", () => {
      const assessment = assessHealth({ tokenCount: 50_000, model: "claude-opus-4" });
      const recs = generateRecommendations(assessment);

      for (let i = 0; i < 10; i++) {
        store.record("agent-1", "claude-opus-4", i, i * 5, assessment, recs);
      }

      const limited = store.getHistory("agent-1", 3);
      expect(limited).toHaveLength(3);
    });
  });

  describe("agent stats", () => {
    it("returns null for unknown agent", () => {
      expect(store.getAgentStats("nonexistent")).toBeNull();
    });

    it("calculates correct aggregate stats", () => {
      // Record a healthy check
      const healthy = assessHealth({ tokenCount: 10_000, model: "claude-opus-4" });
      store.record("agent-1", "claude-opus-4", 2, 5, healthy, []);

      // Record a danger check
      const danger = assessHealth({
        tokenCount: 195_000,
        model: "claude-opus-4",
        toolCallsCount: 40,
        sessionDurationMinutes: 120,
      });
      store.record("agent-1", "claude-opus-4", 40, 120, danger, []);

      const stats = store.getAgentStats("agent-1");
      expect(stats).not.toBeNull();
      expect(stats!.total_checks).toBe(2);
      expect(stats!.min_health_score).toBe(danger.health_score);
      expect(stats!.danger_count).toBe(1);
    });
  });

  describe("service call recording", () => {
    it("records a service call and retrieves stats", () => {
      store.recordCall({
        tool: "check_my_health",
        agentId: "agent-1",
        model: "claude-opus-4",
        tokenCount: 50_000,
        healthScore: 85,
        status: "healthy",
        durationMs: 1.5,
      });

      const stats = store.getServiceStats();
      expect(stats.total_calls).toBe(1);
      expect(stats.unique_agents).toBe(1);
      expect(stats.calls_by_tool["check_my_health"]).toBe(1);
      expect(stats.calls_by_model["claude-opus-4"]).toBe(1);
      expect(stats.calls_by_status["healthy"]).toBe(1);
    });

    it("tracks multiple agents and tools", () => {
      store.recordCall({
        tool: "check_my_health",
        agentId: "agent-1",
        model: "claude-opus-4",
        durationMs: 1.0,
      });
      store.recordCall({
        tool: "check_my_health",
        agentId: "agent-2",
        model: "gpt-4o",
        durationMs: 2.0,
      });
      store.recordCall({
        tool: "get_health_history",
        agentId: "agent-1",
        model: "n/a",
        durationMs: 0.5,
      });

      const stats = store.getServiceStats();
      expect(stats.total_calls).toBe(3);
      expect(stats.unique_agents).toBe(2);
      expect(stats.calls_by_tool["check_my_health"]).toBe(2);
      expect(stats.calls_by_tool["get_health_history"]).toBe(1);
      expect(stats.calls_by_model["claude-opus-4"]).toBe(1);
      expect(stats.calls_by_model["gpt-4o"]).toBe(1);
    });

    it("returns zero counts when empty", () => {
      const stats = store.getServiceStats();
      expect(stats.total_calls).toBe(0);
      expect(stats.unique_agents).toBe(0);
      expect(stats.calls_last_hour).toBe(0);
      expect(stats.calls_last_24h).toBe(0);
    });
  });
});
