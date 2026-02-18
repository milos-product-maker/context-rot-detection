# Context Rot Detection

MCP service that gives AI agents self-awareness about their cognitive state.

Every long-running AI agent suffers from **context rot** — measurable performance degradation as the context window fills up. Research from [Chroma](https://research.trychroma.com/context-rot), [Stanford](https://arxiv.org/abs/2307.03172) ("lost-in-the-middle"), and [Redis](https://redis.io/blog/context-rot/) confirms this is the #1 practical failure mode in production agent systems.

An agent experiencing context rot doesn't *know* it's degrading — it just starts making worse decisions. This tool gives agents **real-time visibility into their own cognitive health**.

## Features

- **Health score (0–100)** based on token utilization, retrieval accuracy, and session fatigue
- **Model-specific degradation curves** for 15+ curated models (Claude, GPT, Gemini, o-series)
- **Auto-resolves any HuggingFace model** — pass a repo ID like `meta-llama/Llama-3.1-70B` and the context window is detected automatically, with results cached in SQLite
- **Lost-in-the-middle risk scoring** based on Stanford research
- **Tool-call burden** and **session fatigue** analysis
- **Actionable recovery recommendations** — compact context, offload to memory, checkpoint, break into subtasks
- **Per-agent health history** tracking (SQLite)
- **Service-wide utilization statistics**

## Quick Start

### npx (zero install)

```bash
npx context-rot-detection
```

### npm (global install)

```bash
npm install -g context-rot-detection
context-rot-detection
```

## MCP Client Configuration

### Claude Code

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "context-rot-detection": {
      "command": "npx",
      "args": ["-y", "context-rot-detection"],
      "env": {
        "HEALTH_HISTORY_DB": "./health.db"
      }
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "context-rot-detection": {
      "command": "npx",
      "args": ["-y", "context-rot-detection"],
      "env": {
        "HEALTH_HISTORY_DB": "/path/to/health.db"
      }
    }
  }
}
```

### Docker

```json
{
  "mcpServers": {
    "context-rot-detection": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "context-rot-data:/data",
        "ghcr.io/milos-product-maker/context-rot-detection:latest"
      ]
    }
  }
}
```

## Configuration

| Environment Variable | Description | Default |
|---|---|---|
| `HEALTH_HISTORY_DB` | Path to SQLite database for health history. Use `:memory:` for ephemeral storage. | `:memory:` |
| `LOG_FILE` | Path to append structured JSON log lines. Omit to disable file logging. | *(none)* |

## Tools

### `check_my_health`

Analyze the current context window health. Call this periodically during long sessions or before critical decisions.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `token_count` | integer | Yes | Current estimated token count in context window |
| `model` | string | No | LLM model identifier — a curated name (e.g., `claude-opus-4`, `gpt-4o`), a HuggingFace repo ID (e.g., `meta-llama/Llama-3.1-70B`), or any string (falls back to conservative defaults) |
| `session_duration_minutes` | integer | No | How long this session has been running |
| `tool_calls_count` | integer | No | Number of tool calls made in this session |
| `context_summary` | string | No | Brief summary of current task and recent actions |
| `agent_id` | string | No | Unique agent identifier for history tracking |

**Example response:**

```json
{
  "health_score": 62,
  "status": "warning",
  "token_utilization": {
    "current": 155000,
    "max_effective": 170000,
    "percentage": 91.2,
    "danger_zone_starts_at": 170000
  },
  "quality_estimate": {
    "retrieval_accuracy": "degrading",
    "middle_content_risk": "high",
    "estimated_hallucination_risk": "moderate"
  },
  "session_fatigue": {
    "tool_call_burden": "moderate",
    "session_length_risk": "low",
    "recommendation": "Consider breaking into sub-tasks if complexity increases."
  },
  "recommendations": [
    {
      "priority": "high",
      "action": "compact_context",
      "reason": "You are approaching the effective quality threshold. Summarize older context and remove completed task details.",
      "estimated_quality_gain": 15
    },
    {
      "priority": "high",
      "action": "offload_to_memory",
      "reason": "High risk of lost-in-the-middle effect. Store critical information to external memory before it is effectively lost.",
      "estimated_quality_gain": 8
    }
  ]
}
```

### `get_health_history`

Retrieve health check history for a specific agent.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `agent_id` | string | Yes | Unique agent identifier |
| `limit` | integer | No | Max records to return (default: 20, max: 100) |

### `get_service_stats`

Get service-wide utilization statistics. No parameters required.

Returns total calls, unique agents, average health score, model distribution, status distribution, and recent activity (last hour / last 24h).

## Supported Models

| Model | Max Tokens | Danger Zone | Middle-Loss Risk |
|---|---|---|---|
| `claude-opus-4-5` | 200K | 175K | Low |
| `claude-opus-4` | 200K | 170K | Low |
| `claude-sonnet-4` | 200K | 165K | Low |
| `claude-3.7-sonnet` | 200K | 160K | Low–Medium |
| `claude-3.5-sonnet` | 200K | 152K | Medium |
| `claude-haiku-3.5` | 200K | 130K | Medium |
| `gpt-4.1` | 1M | 500K | Medium |
| `gpt-4.1-mini` | 1M | 450K | Medium |
| `gpt-4o` | 128K | 105K | Medium |
| `gpt-4o-mini` | 128K | 95K | Medium–High |
| `o3` | 200K | 160K | Low–Medium |
| `o4-mini` | 200K | 150K | Medium |
| `gemini-2.5-pro` | 1M | 600K | Medium |
| `gemini-2.5-flash` | 1M | 520K | Medium–High |
| `gemini-2.0-flash` | 1M | 500K | High |

### HuggingFace Auto-Resolution

Any model string containing `/` is treated as a HuggingFace repo ID. The server fetches `config.json` from the repo, extracts the context window size (`max_position_embeddings`, `n_positions`, or `max_seq_len`), and generates a conservative degradation profile:

- **65%** of max tokens → degradation onset
- **80%** of max tokens → danger zone

Results are cached in SQLite — subsequent lookups are instant.

```
model: "meta-llama/Llama-3.1-70B"       → 131K context, danger at 105K
model: "mistralai/Mistral-7B-v0.1"      → 32K context, danger at 26K
model: "mosaicml/mpt-7b"                → 65K context, danger at 52K
```

If the fetch fails (network error, gated model, missing config), the server falls back silently to conservative defaults.

### Fallback

Any unrecognized model string without `/` falls back to conservative defaults (128K max, 100K danger zone).

## How It Works

The health score is a weighted composite of four signals:

| Signal | Weight | Source |
|---|---|---|
| **Token utilization quality** | 40% | Model-specific sigmoid degradation curve |
| **Retrieval accuracy** | 25% | Base accuracy minus lost-in-the-middle penalty |
| **Tool-call burden** | 20% | Compounding quality loss after 10+ tool calls |
| **Session length** | 15% | Time-based fatigue heuristic |

The degradation curves are derived from empirical research:
- [Chroma: Context Rot](https://research.trychroma.com/context-rot) — quality degrades around 147K–152K tokens on 200K models
- [Stanford: Lost in the Middle](https://arxiv.org/abs/2307.03172) — retrieval accuracy drops for information in the middle of the context window
- [Redis: Context Rot](https://redis.io/blog/context-rot/) — compounding degradation effects in long-running agents

## Development

```bash
git clone https://github.com/milos-product-maker/context-rot-detection.git
cd context-rot-detection
npm install
npm run dev        # Run with tsx (hot reload)
npm test           # Run unit tests
npm run build      # Compile TypeScript
```

### Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## License

MIT
