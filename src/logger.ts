/**
 * Structured JSON logger.
 *
 * Emits one JSON line per event to stderr (stdout is reserved for MCP
 * protocol communication). Designed for piping to log aggregation tools
 * or tailing with `jq`.
 *
 * Usage:
 *   tail -f /path/to/logs | jq .
 *   tail -f /path/to/logs | jq 'select(.event == "tool_call")'
 */

import { appendFileSync } from "node:fs";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  [key: string]: unknown;
}

const logFilePath = process.env.LOG_FILE ?? null;

/**
 * Emit a structured JSON log line.
 *
 * Writes to stderr by default. If LOG_FILE env var is set, also appends
 * to that file for persistent log collection.
 */
export function log(level: LogLevel, event: string, data: Record<string, unknown> = {}): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...data,
  };

  const line = JSON.stringify(entry);

  // Always write to stderr (stdout is MCP protocol)
  process.stderr.write(line + "\n");

  // Optionally append to log file
  if (logFilePath) {
    try {
      appendFileSync(logFilePath, line + "\n");
    } catch {
      // Don't crash the service if log file is inaccessible
    }
  }
}

/**
 * Log a tool call with all relevant metrics.
 */
export function logToolCall(
  tool: string,
  params: Record<string, unknown>,
  result: { health_score?: number; status?: string },
  durationMs: number,
): void {
  log("info", "tool_call", {
    tool,
    agent_id: params.agent_id ?? "anonymous",
    model: params.model ?? "other",
    token_count: params.token_count,
    tool_calls_count: params.tool_calls_count,
    session_duration_minutes: params.session_duration_minutes,
    health_score: result.health_score,
    status: result.status,
    duration_ms: durationMs,
  });
}
