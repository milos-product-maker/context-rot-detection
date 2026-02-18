import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { HuggingFaceResolver } from "./huggingface-resolver.js";
import { getModelProfile } from "./degradation-curves.js";

function mockFetchSuccess(config: Record<string, unknown>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(config),
  });
}

function mockFetchFailure(status: number = 404) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
  });
}

function mockFetchNetworkError() {
  return vi.fn().mockRejectedValue(new TypeError("fetch failed"));
}

describe("HuggingFaceResolver", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  describe("curated model bypass", () => {
    it("returns curated profile without calling fetch", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const resolver = new HuggingFaceResolver(db);

      const profile = await resolver.resolveModelProfile("claude-opus-4");
      expect(profile.name).toBe("Claude Opus 4");
      expect(profile.maxTokens).toBe(200_000);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("non-HuggingFace model strings", () => {
    it("returns 'other' fallback for plain model names without fetch", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const resolver = new HuggingFaceResolver(db);

      const profile = await resolver.resolveModelProfile("llama-4");
      expect(profile.name).toBe("Unknown Model");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("successful HuggingFace resolution", () => {
    it("resolves via max_position_embeddings", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({ max_position_embeddings: 131_072 }));
      const resolver = new HuggingFaceResolver(db);

      const profile = await resolver.resolveModelProfile("meta-llama/Llama-3.1-70B");
      expect(profile.name).toBe("meta-llama/Llama-3.1-70B");
      expect(profile.maxTokens).toBe(131_072);
      expect(profile.degradationOnset).toBe(Math.round(131_072 * 0.65));
      expect(profile.dangerZone).toBe(Math.round(131_072 * 0.80));
    });

    it("resolves via n_positions (GPT-2 family)", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({ n_positions: 1_024 }));
      const resolver = new HuggingFaceResolver(db);

      const profile = await resolver.resolveModelProfile("openai-community/gpt2");
      expect(profile.maxTokens).toBe(1_024);
    });

    it("resolves via max_seq_len (MPT family)", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({ max_seq_len: 65_536 }));
      const resolver = new HuggingFaceResolver(db);

      const profile = await resolver.resolveModelProfile("mosaicml/mpt-7b");
      expect(profile.maxTokens).toBe(65_536);
    });

    it("prefers max_position_embeddings over n_positions", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        max_position_embeddings: 32_768,
        n_positions: 1_024,
      }));
      const resolver = new HuggingFaceResolver(db);

      const profile = await resolver.resolveModelProfile("some/model");
      expect(profile.maxTokens).toBe(32_768);
    });
  });

  describe("error handling", () => {
    it("falls back to 'other' on 404", async () => {
      vi.stubGlobal("fetch", mockFetchFailure(404));
      const resolver = new HuggingFaceResolver(db);

      const profile = await resolver.resolveModelProfile("nonexistent/model");
      expect(profile.name).toBe("Unknown Model");
    });

    it("falls back to 'other' on 401 (gated model)", async () => {
      vi.stubGlobal("fetch", mockFetchFailure(401));
      const resolver = new HuggingFaceResolver(db);

      const profile = await resolver.resolveModelProfile("gated/model");
      expect(profile.name).toBe("Unknown Model");
    });

    it("falls back to 'other' on network error", async () => {
      vi.stubGlobal("fetch", mockFetchNetworkError());
      const resolver = new HuggingFaceResolver(db);

      const profile = await resolver.resolveModelProfile("org/model");
      expect(profile.name).toBe("Unknown Model");
    });

    it("falls back to 'other' when config has no context-length fields", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({ model_type: "llama", hidden_size: 4096 }));
      const resolver = new HuggingFaceResolver(db);

      const profile = await resolver.resolveModelProfile("org/model");
      expect(profile.name).toBe("Unknown Model");
    });

    it("falls back to 'other' when max_position_embeddings is 0", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({ max_position_embeddings: 0 }));
      const resolver = new HuggingFaceResolver(db);

      const profile = await resolver.resolveModelProfile("org/model");
      expect(profile.name).toBe("Unknown Model");
    });

    it("falls back to 'other' when max_position_embeddings is negative", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({ max_position_embeddings: -1 }));
      const resolver = new HuggingFaceResolver(db);

      const profile = await resolver.resolveModelProfile("org/model");
      expect(profile.name).toBe("Unknown Model");
    });
  });

  describe("SQLite caching", () => {
    it("caches results and skips fetch on second call", async () => {
      const fetchMock = mockFetchSuccess({ max_position_embeddings: 8_192 });
      vi.stubGlobal("fetch", fetchMock);
      const resolver = new HuggingFaceResolver(db);

      // First call — fetches
      const first = await resolver.resolveModelProfile("org/model");
      expect(first.maxTokens).toBe(8_192);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second call — cached
      const second = await resolver.resolveModelProfile("org/model");
      expect(second.maxTokens).toBe(8_192);
      expect(fetchMock).toHaveBeenCalledTimes(1); // Still only 1 fetch
    });

    it("cache persists across resolver instances", async () => {
      const fetchMock = mockFetchSuccess({ max_position_embeddings: 32_768 });
      vi.stubGlobal("fetch", fetchMock);

      // First resolver fetches
      const resolver1 = new HuggingFaceResolver(db);
      await resolver1.resolveModelProfile("org/model");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second resolver reads from cache
      const resolver2 = new HuggingFaceResolver(db);
      const profile = await resolver2.resolveModelProfile("org/model");
      expect(profile.maxTokens).toBe(32_768);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("no-database mode", () => {
    it("resolves via HuggingFace without crashing when db is null", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({ max_position_embeddings: 4_096 }));
      const resolver = new HuggingFaceResolver(null);

      const profile = await resolver.resolveModelProfile("org/model");
      expect(profile.maxTokens).toBe(4_096);
    });

    it("does not cache when db is null (re-fetches)", async () => {
      const fetchMock = mockFetchSuccess({ max_position_embeddings: 4_096 });
      vi.stubGlobal("fetch", fetchMock);
      const resolver = new HuggingFaceResolver(null);

      await resolver.resolveModelProfile("org/model");
      await resolver.resolveModelProfile("org/model");
      // Without cache, it fetches each time (but in-flight dedup may coalesce)
      // The second call happens after the first completes, so it does re-fetch
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("concurrent deduplication", () => {
    it("only fetches once for parallel requests", async () => {
      const fetchMock = vi.fn().mockImplementation(() =>
        new Promise((resolve) =>
          setTimeout(() => resolve({
            ok: true,
            json: () => Promise.resolve({ max_position_embeddings: 16_384 }),
          }), 50),
        ),
      );
      vi.stubGlobal("fetch", fetchMock);
      const resolver = new HuggingFaceResolver(db);

      // Fire two requests in parallel
      const [first, second] = await Promise.all([
        resolver.resolveModelProfile("org/model"),
        resolver.resolveModelProfile("org/model"),
      ]);

      expect(first.maxTokens).toBe(16_384);
      expect(second.maxTokens).toBe(16_384);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
