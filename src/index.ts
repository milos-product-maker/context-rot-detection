#!/usr/bin/env node

/**
 * Context Rot Detection & Healing — MCP Server
 *
 * Gives AI agents self-awareness about their cognitive state by analyzing
 * token utilization, context quality degradation, and session fatigue.
 *
 * MCP Tool: check_my_health
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { assessHealth, type ModelProfileResolver } from "./quality-estimation.js";
import { generateRecommendations } from "./recommendations.js";
import type { HealthHistoryStore } from "./health-history.js";
import { log, logToolCall } from "./logger.js";
import { KNOWN_MODELS } from "./degradation-curves.js";

// Lazy-loaded store — only initialized when the server actually starts via main().
// Smithery's scan phase calls createSandboxServer() which skips SQLite entirely.
let historyStore: HealthHistoryStore | null = null;

/**
 * Create an MCP server with all tools registered.
 * The store parameter is optional — when null, history/metrics are silently skipped.
 * The resolver parameter enables runtime HuggingFace model profile resolution.
 */
function createServer(
  store: HealthHistoryStore | null = null,
  resolver?: ModelProfileResolver,
): McpServer {
  const server = new McpServer({
    name: "context-rot-detection",
    version: "0.1.0",
  });

  // Register the check_my_health tool
  server.tool(
    "check_my_health",
    "Analyze your current context window health. Returns a health score (0-100), token utilization, estimated quality degradation, and recommendations for recovery. Call this periodically during long sessions or before critical decisions.",
    {
      context_summary: z
        .string()
        .optional()
        .describe(
          "A brief summary of your current task and recent actions (the tool will analyze patterns, not raw context)",
        ),
      token_count: z
        .number()
        .int()
        .positive()
        .describe("Your current estimated token count in context window"),
      session_duration_minutes: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("How long this session has been running"),
      tool_calls_count: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Number of tool calls made in this session"),
      model: z
        .string()
        .optional()
        .describe(
          `The LLM model you're running on. Known models with tuned profiles: ${KNOWN_MODELS.join(", ")}. You can also pass a HuggingFace repo ID (e.g., "meta-llama/Llama-3.1-70B-Instruct") and the context window will be auto-detected. Any other string falls back to conservative defaults.`,
        ),
      agent_id: z
        .string()
        .optional()
        .describe(
          "Optional unique identifier for this agent instance, used for health history tracking",
        ),
    },
    async (params) => {
      const start = performance.now();
      const model = params.model ?? "other";
      const agentId = params.agent_id ?? "anonymous";
      const toolCallsCount = params.tool_calls_count ?? 0;
      const sessionDurationMinutes = params.session_duration_minutes ?? 0;

      // Run health assessment
      const assessment = await assessHealth({
        tokenCount: params.token_count,
        model,
        sessionDurationMinutes,
        toolCallsCount,
        contextSummary: params.context_summary,
      }, resolver);

      // Generate recommendations
      const recommendations = generateRecommendations(assessment);

      // Record to health history if agent_id is provided
      if (params.agent_id && store) {
        try {
          store.record(
            params.agent_id,
            model,
            toolCallsCount,
            sessionDurationMinutes,
            assessment,
            recommendations,
          );
        } catch {
          // Non-critical — don't fail the health check if recording fails
        }
      }

      const durationMs = Math.round((performance.now() - start) * 100) / 100;

      // Record service-level metrics (always, even for anonymous calls)
      if (store) {
        try {
          store.recordCall({
            tool: "check_my_health",
            agentId,
            model,
            tokenCount: params.token_count,
            healthScore: assessment.health_score,
            status: assessment.status,
            durationMs,
          });
        } catch {
          // Non-critical
        }
      }

      // Structured log
      logToolCall("check_my_health", params, assessment, durationMs);

      // Build response
      const response = {
        ...assessment,
        recommendations,
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    },
  );

  // Register the get_health_history tool (paid tier, but included in MVP for testing)
  server.tool(
    "get_health_history",
    "Retrieve health check history for an agent. Requires agent_id. Returns recent health checks and aggregate statistics.",
    {
      agent_id: z
        .string()
        .describe("The unique identifier for the agent instance"),
      limit: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
        .describe("Maximum number of records to return (default: 20, max: 100)"),
    },
    async (params) => {
      const start = performance.now();

      const history = store?.getHistory(params.agent_id, params.limit ?? 20) ?? [];
      const stats = store?.getAgentStats(params.agent_id) ?? null;

      const durationMs = Math.round((performance.now() - start) * 100) / 100;

      if (store) {
        try {
          store.recordCall({
            tool: "get_health_history",
            agentId: params.agent_id,
            model: "n/a",
            durationMs,
          });
        } catch {
          // Non-critical
        }
      }

      log("info", "tool_call", {
        tool: "get_health_history",
        agent_id: params.agent_id,
        records_returned: history.length,
        duration_ms: durationMs,
      });

      const response = {
        agent_id: params.agent_id,
        stats: stats ?? { total_checks: 0, avg_health_score: null, min_health_score: null, danger_count: 0 },
        recent_checks: history.map((h) => ({
          timestamp: h.timestamp,
          health_score: h.health_score,
          status: h.status,
          token_count: h.token_count,
          token_percentage: h.token_percentage,
        })),
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    },
  );

  // Register the get_service_stats tool (operator/admin tool)
  server.tool(
    "get_service_stats",
    "Get service-wide utilization statistics: total calls, unique agents, model distribution, health score averages, and recent activity. Useful for operators monitoring service adoption and usage patterns.",
    {},
    async () => {
      const start = performance.now();

      const stats = store?.getServiceStats() ?? {
        total_calls: 0,
        unique_agents: 0,
        avg_duration_ms: null,
        avg_health_score: null,
        first_call: null,
        last_call: null,
        calls_last_hour: 0,
        calls_last_24h: 0,
        calls_by_tool: {},
        calls_by_model: {},
        calls_by_status: {},
      };

      const durationMs = Math.round((performance.now() - start) * 100) / 100;

      if (store) {
        try {
          store.recordCall({
            tool: "get_service_stats",
            agentId: "operator",
            model: "n/a",
            durationMs,
          });
        } catch {
          // Non-critical
        }
      }

      log("info", "tool_call", {
        tool: "get_service_stats",
        duration_ms: durationMs,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(stats, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

/**
 * Smithery sandbox export — allows Smithery to scan server tools
 * without loading native modules (better-sqlite3).
 */
export function createSandboxServer(): McpServer {
  return createServer(null);
}

// Start the server (only when executed directly, not when imported by Smithery)
async function main(): Promise<void> {
  // Dynamic imports so native modules are only loaded at runtime, not at scan time
  const { HealthHistoryStore } = await import("./health-history.js");
  const { HuggingFaceResolver } = await import("./huggingface-resolver.js");

  const historyDbPath = process.env.HEALTH_HISTORY_DB ?? ":memory:";
  historyStore = new HealthHistoryStore(historyDbPath);

  const resolver = new HuggingFaceResolver(historyStore.getDb());
  const server = createServer(historyStore, resolver);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "server_started", {
    version: "0.1.0",
    history_db: historyDbPath,
  });
}

main().catch((error) => {
  console.error("Fatal error starting MCP server:", error);
  process.exit(1);
});
