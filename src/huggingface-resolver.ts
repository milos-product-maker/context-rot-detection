/**
 * HuggingFace model profile resolver.
 *
 * Resolves unknown model strings by fetching config.json from HuggingFace,
 * extracting the context window size, and generating a conservative
 * ModelProfile. Results are cached in SQLite for instant subsequent lookups.
 */

import type Database from "better-sqlite3";
import {
  type ModelProfile,
  getModelProfile,
  generateHeuristicProfile,
} from "./degradation-curves.js";
import { log } from "./logger.js";

const HUGGINGFACE_TIMEOUT_MS = 5_000;

/**
 * Checks whether a model string looks like a HuggingFace repo ID (org/model).
 */
function looksLikeHuggingFaceRepoId(model: string): boolean {
  const parts = model.split("/");
  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
}

/**
 * Extract context window size from a HuggingFace config object.
 * Checks multiple field names used by different model architectures.
 */
function extractMaxTokens(config: Record<string, unknown>): number | null {
  const value =
    (config.max_position_embeddings as number | undefined) ??
    (config.n_positions as number | undefined) ??
    (config.max_seq_len as number | undefined) ??
    null;

  if (typeof value !== "number" || value <= 0) return null;
  return value;
}

export class HuggingFaceResolver {
  private db: Database.Database | null;
  private inFlightRequests: Map<string, Promise<ModelProfile>>;

  constructor(db: Database.Database | null) {
    this.db = db;
    this.inFlightRequests = new Map();
    if (db) this.initializeCacheTable();
  }

  private initializeCacheTable(): void {
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS hf_model_cache (
        repo_id TEXT PRIMARY KEY,
        max_tokens INTEGER NOT NULL,
        profile_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  /**
   * Resolve a model string to a ModelProfile.
   *
   * Resolution order:
   *   1. Curated static profiles (instant)
   *   2. SQLite cache (instant)
   *   3. HuggingFace fetch (async, 5s timeout)
   *   4. Fallback to "other" profile
   */
  async resolveModelProfile(model: string): Promise<ModelProfile> {
    // 1. Check curated profiles first
    const curated = getModelProfile(model);
    if (curated.name !== "Unknown Model") {
      return curated;
    }

    // 2. If it doesn't look like a HF repo ID, return "other"
    if (!looksLikeHuggingFaceRepoId(model)) {
      return curated; // This is the "other" fallback
    }

    // 3. Check SQLite cache
    const cached = this.getCached(model);
    if (cached) return cached;

    // 4. Check if a fetch is already in flight for this model
    const existing = this.inFlightRequests.get(model);
    if (existing) return existing;

    // 5. Fetch from HuggingFace
    const promise = this.fetchAndCache(model);
    this.inFlightRequests.set(model, promise);

    try {
      return await promise;
    } finally {
      this.inFlightRequests.delete(model);
    }
  }

  private async fetchAndCache(repoId: string): Promise<ModelProfile> {
    const maxTokens = await this.fetchHuggingFaceConfig(repoId);

    if (maxTokens === null) {
      log("warn", "hf_resolve_failed", { repo_id: repoId });
      return getModelProfile("other");
    }

    const profile = generateHeuristicProfile(repoId, maxTokens);

    // Cache the result
    this.cacheProfile(repoId, maxTokens, profile);

    log("info", "hf_resolve_success", {
      repo_id: repoId,
      max_tokens: maxTokens,
      danger_zone: profile.dangerZone,
    });

    return profile;
  }

  private async fetchHuggingFaceConfig(repoId: string): Promise<number | null> {
    const url = `https://huggingface.co/${repoId}/resolve/main/config.json`;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(HUGGINGFACE_TIMEOUT_MS),
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return null;
      const config = (await response.json()) as Record<string, unknown>;
      return extractMaxTokens(config);
    } catch {
      return null;
    }
  }

  private getCached(repoId: string): ModelProfile | null {
    if (!this.db) return null;
    try {
      const row = this.db
        .prepare("SELECT profile_json FROM hf_model_cache WHERE repo_id = ?")
        .get(repoId) as { profile_json: string } | undefined;
      if (!row) return null;
      return JSON.parse(row.profile_json) as ModelProfile;
    } catch {
      return null;
    }
  }

  private cacheProfile(
    repoId: string,
    maxTokens: number,
    profile: ModelProfile,
  ): void {
    if (!this.db) return;
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO hf_model_cache (repo_id, max_tokens, profile_json)
           VALUES (?, ?, ?)`,
        )
        .run(repoId, maxTokens, JSON.stringify(profile));
    } catch {
      // Non-critical — cache write failure is not fatal
    }
  }
}
