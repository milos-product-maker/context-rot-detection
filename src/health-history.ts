/**
 * Health history storage using SQLite.
 *
 * Tracks agent health checks over time, enabling trend analysis
 * and fleet-level monitoring (paid tier feature).
 */

import Database from "better-sqlite3";
import type { HealthAssessment } from "./quality-estimation.js";
import type { Recommendation } from "./recommendations.js";

export interface HealthRecord {
  id: number;
  agent_id: string;
  timestamp: string;
  health_score: number;
  status: string;
  token_count: number;
  token_percentage: number;
  model: string;
  tool_calls_count: number;
  session_duration_minutes: number;
  recommendations_json: string;
}

export class HealthHistoryStore {
  private db: Database.Database;

  constructor(dbPath: string = ":memory:") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS health_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL DEFAULT 'anonymous',
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        health_score INTEGER NOT NULL,
        status TEXT NOT NULL,
        token_count INTEGER NOT NULL,
        token_percentage REAL NOT NULL,
        model TEXT NOT NULL DEFAULT 'other',
        tool_calls_count INTEGER NOT NULL DEFAULT 0,
        session_duration_minutes INTEGER NOT NULL DEFAULT 0,
        recommendations_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE INDEX IF NOT EXISTS idx_health_agent_time
        ON health_checks (agent_id, timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_health_timestamp
        ON health_checks (timestamp DESC);

      CREATE TABLE IF NOT EXISTS service_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        tool TEXT NOT NULL,
        agent_id TEXT NOT NULL DEFAULT 'anonymous',
        model TEXT NOT NULL DEFAULT 'other',
        token_count INTEGER,
        health_score INTEGER,
        status TEXT,
        duration_ms REAL NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_service_calls_timestamp
        ON service_calls (timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_service_calls_tool
        ON service_calls (tool, timestamp DESC);
    `);
  }

  /**
   * Record a health check result.
   */
  record(
    agentId: string,
    model: string,
    toolCallsCount: number,
    sessionDurationMinutes: number,
    assessment: HealthAssessment,
    recommendations: Recommendation[],
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO health_checks
        (agent_id, health_score, status, token_count, token_percentage,
         model, tool_calls_count, session_duration_minutes, recommendations_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      agentId,
      assessment.health_score,
      assessment.status,
      assessment.token_utilization.current,
      assessment.token_utilization.percentage,
      model,
      toolCallsCount,
      sessionDurationMinutes,
      JSON.stringify(recommendations),
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Get the most recent health checks for an agent.
   */
  getHistory(agentId: string, limit: number = 20): HealthRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM health_checks
      WHERE agent_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    return stmt.all(agentId, limit) as HealthRecord[];
  }

  /**
   * Get aggregate stats for an agent.
   */
  getAgentStats(agentId: string): {
    total_checks: number;
    avg_health_score: number;
    min_health_score: number;
    danger_count: number;
  } | null {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total_checks,
        ROUND(AVG(health_score), 1) as avg_health_score,
        MIN(health_score) as min_health_score,
        SUM(CASE WHEN status = 'danger' THEN 1 ELSE 0 END) as danger_count
      FROM health_checks
      WHERE agent_id = ?
    `);

    const row = stmt.get(agentId) as {
      total_checks: number;
      avg_health_score: number;
      min_health_score: number;
      danger_count: number;
    } | undefined;

    if (!row || row.total_checks === 0) return null;
    return row;
  }

  /**
   * Record every tool call for service-level utilization tracking.
   * This captures both anonymous and identified calls.
   */
  recordCall(params: {
    tool: string;
    agentId: string;
    model: string;
    tokenCount?: number;
    healthScore?: number;
    status?: string;
    durationMs: number;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO service_calls
        (tool, agent_id, model, token_count, health_score, status, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      params.tool,
      params.agentId,
      params.model,
      params.tokenCount ?? null,
      params.healthScore ?? null,
      params.status ?? null,
      params.durationMs,
    );
  }

  /**
   * Get service-wide utilization statistics.
   */
  getServiceStats(): ServiceStats {
    const totals = this.db.prepare(`
      SELECT
        COUNT(*) as total_calls,
        COUNT(DISTINCT agent_id) as unique_agents,
        ROUND(AVG(duration_ms), 1) as avg_duration_ms,
        ROUND(AVG(health_score), 1) as avg_health_score,
        MIN(timestamp) as first_call,
        MAX(timestamp) as last_call
      FROM service_calls
    `).get() as {
      total_calls: number;
      unique_agents: number;
      avg_duration_ms: number | null;
      avg_health_score: number | null;
      first_call: string | null;
      last_call: string | null;
    };

    const byTool = this.db.prepare(`
      SELECT tool, COUNT(*) as count
      FROM service_calls
      GROUP BY tool
      ORDER BY count DESC
    `).all() as { tool: string; count: number }[];

    const byModel = this.db.prepare(`
      SELECT model, COUNT(*) as count
      FROM service_calls
      GROUP BY model
      ORDER BY count DESC
    `).all() as { model: string; count: number }[];

    const byStatus = this.db.prepare(`
      SELECT status, COUNT(*) as count
      FROM service_calls
      WHERE status IS NOT NULL
      GROUP BY status
      ORDER BY count DESC
    `).all() as { status: string; count: number }[];

    const last24h = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM service_calls
      WHERE timestamp >= datetime('now', '-1 day')
    `).get() as { count: number };

    const last1h = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM service_calls
      WHERE timestamp >= datetime('now', '-1 hour')
    `).get() as { count: number };

    return {
      total_calls: totals.total_calls,
      unique_agents: totals.unique_agents,
      avg_duration_ms: totals.avg_duration_ms,
      avg_health_score: totals.avg_health_score,
      first_call: totals.first_call,
      last_call: totals.last_call,
      calls_last_hour: last1h.count,
      calls_last_24h: last24h.count,
      calls_by_tool: Object.fromEntries(byTool.map((r) => [r.tool, r.count])),
      calls_by_model: Object.fromEntries(byModel.map((r) => [r.model, r.count])),
      calls_by_status: Object.fromEntries(byStatus.map((r) => [r.status, r.count])),
    };
  }

  getDb(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}

export interface ServiceStats {
  total_calls: number;
  unique_agents: number;
  avg_duration_ms: number | null;
  avg_health_score: number | null;
  first_call: string | null;
  last_call: string | null;
  calls_last_hour: number;
  calls_last_24h: number;
  calls_by_tool: Record<string, number>;
  calls_by_model: Record<string, number>;
  calls_by_status: Record<string, number>;
}
