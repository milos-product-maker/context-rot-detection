# Project: Context Rot Detection & Healing
## MCP Tool: `check_my_health`

**Status:** Ready to build
**Effort:** 🟢 S — 1-2 weeks, 2 engineers
**MVP Cost:** ~$2-5K (compute + hosting)
**External Competences:** None required

---

## Business Case

### The Problem
Every long-running AI agent suffers from "context rot" — measurable performance degradation as the context window fills up. This is the #1 practical failure mode in production agent systems.

### Key Evidence
- **Chroma Research** documented that quality degrades around 147K-152K tokens even with 200K advertised context windows ([source](https://research.trychroma.com/context-rot))
- **Stanford's "lost-in-the-middle" research** shows agents forget information in the middle of their context, leading to missed details and hallucinations
- **Redis** confirmed context rot as a measurable phenomenon with compounding effects ([source](https://redis.io/blog/context-rot/))
- **LangChain survey**: 41% of developers cite unreliable performance as #1 blocker — context rot is the root cause
- When tasks exceed **10 tool calls**, accumulated context starts degrading decision quality
- The Qwen3-8B model was observed generating "I'm going to take a break" and "I need to chill out" when overwhelmed — agents literally express burnout
- **95% of enterprises** see no AI ROI, primarily due to poor context management (MIT report)

### Why Agents Would Use This
An agent experiencing context rot doesn't *know* it's degrading — it just starts making worse decisions. This tool gives agents **self-awareness about their own cognitive state**. It's the equivalent of a human checking if they're too tired to drive.

### Market Signal
- No existing MCP tool or service offers real-time context health monitoring
- Every agent framework (LangChain, CrewAI, OpenClaw, OpenAI SDK) has this problem
- Context engineering is emerging as a discipline (Anthropic, LangChain both publishing guides) but no one has productized the monitoring layer

### Revenue Model
- **Free tier:** Basic health check (token count, estimated quality score)
- **Paid tier:** Continuous monitoring, auto-compaction triggers, historical health analytics, multi-agent fleet health dashboards
- **Pricing:** Per-check (fractions of a cent via x402) or monthly subscription for developers

---

## Technical Specification

### MCP Tool Interface

```json
{
  "name": "check_my_health",
  "description": "Analyze your current context window health. Returns a health score (0-100), token utilization, estimated quality degradation, and recommendations for recovery. Call this periodically during long sessions or before critical decisions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "context_summary": {
        "type": "string",
        "description": "A brief summary of your current task and recent actions (the tool will analyze patterns, not raw context)"
      },
      "token_count": {
        "type": "integer",
        "description": "Your current estimated token count in context window"
      },
      "session_duration_minutes": {
        "type": "integer",
        "description": "How long this session has been running"
      },
      "tool_calls_count": {
        "type": "integer",
        "description": "Number of tool calls made in this session"
      },
      "model": {
        "type": "string",
        "description": "The LLM model you're running on (e.g., 'claude-3.5-sonnet', 'gpt-4o')",
        "enum": ["claude-3.5-sonnet", "claude-3.7-sonnet", "gpt-4o", "gpt-4o-mini", "gemini-2.0-flash", "other"]
      }
    },
    "required": ["token_count"]
  }
}
```

### Response Format

```json
{
  "health_score": 78,
  "status": "warning",
  "token_utilization": {
    "current": 89000,
    "max_effective": 128000,
    "percentage": 69.5,
    "danger_zone_starts_at": 100000
  },
  "quality_estimate": {
    "retrieval_accuracy": "degrading",
    "middle_content_risk": "high",
    "estimated_hallucination_risk": "moderate"
  },
  "recommendations": [
    {
      "priority": "high",
      "action": "compact_context",
      "reason": "You are approaching the effective quality threshold. Summarize older context and remove completed task details.",
      "estimated_quality_gain": 15
    },
    {
      "priority": "medium",
      "action": "offload_to_memory",
      "reason": "Store key decisions and facts to external memory before they are lost in the middle of context.",
      "estimated_quality_gain": 8
    }
  ],
  "session_fatigue": {
    "tool_call_burden": "moderate",
    "session_length_risk": "low",
    "recommendation": "Consider breaking into sub-tasks if complexity increases"
  }
}
```

### Architecture

```
Agent (any framework)
  │
  ├── MCP call: check_my_health
  │
  ▼
┌─────────────────────────────┐
│  Context Rot Detection API  │
│                             │
│  1. Token analysis          │  ← Model-specific thresholds
│  2. Quality estimation      │  ← Empirical degradation curves
│  3. Session fatigue model   │  ← Tool-call burden heuristics
│  4. Recommendation engine   │  ← Recovery action suggestions
│                             │
│  Storage: per-agent health  │
│  history (optional, paid)   │
└─────────────────────────────┘
```

### Key Technical Components

1. **Model-specific degradation curves**: Empirical data on when each model starts degrading (Claude at ~147K, GPT-4o at different thresholds, etc.). This is our core IP — building the most accurate quality-vs-tokens curves.

2. **Lost-in-the-middle scoring**: Estimate how much of the context is in the "dead zone" (middle of the window) where retrieval accuracy drops.

3. **Tool-call burden heuristic**: Each tool call adds context. After 10+ calls, quality compounds downward. Track this.

4. **Recommendation engine**: Don't just diagnose — prescribe. "Compact now," "offload these facts to memory," "break into sub-tasks."

5. **Health history** (paid feature): Track an agent's health over time. Show patterns. Alert owners when an agent consistently operates in the rot zone.

### Tech Stack (MVP)
- **Runtime:** Python (FastAPI) or TypeScript (Hono/Express)
- **MCP SDK:** `mcp` Python or TypeScript package
- **Hosting:** Single container on Fly.io, Railway, or similar ($5-20/mo)
- **Storage:** SQLite for MVP health history, upgrade to Postgres later
- **No external dependencies** — no vector DB, no blockchain, no special infra

### Build Plan

| Day | Task |
|-----|------|
| 1-2 | MCP server scaffold + tool registration + basic token counting |
| 3-4 | Model-specific degradation curves (research + implement) |
| 5-6 | Quality estimation engine (lost-in-middle, tool-call burden) |
| 7-8 | Recommendation engine + response formatting |
| 9-10 | Health history storage + fleet dashboard (paid tier) |
| 11-12 | Testing with real agents, MCP Registry submission, docs |

---

## Go-to-Market

### Distribution
1. **MCP Registry** — submit on day 1 of launch
2. **npm + PyPI** — publish as installable package
3. **`/.well-known/mcp/server.json`** — host on our domain for auto-discovery
4. **Blog post** — "Your Agent Is Degrading and Doesn't Know It" with benchmarks
5. **Reddit/HN** — share findings on context rot with the tool as the solution
6. **LangChain / CrewAI integrations** — provide framework-specific setup guides

### Success Metrics
- Number of MCP tool installations
- Daily active agents calling `check_my_health`
- Conversion from free to paid tier
- Agent health improvements (before/after scores)

---

## Competitive Landscape
- **No direct competitor** offers this as an MCP tool
- Chroma published research but no product
- Redis published a blog post but no service
- Claude Code has auto-compact but it's internal, not available as a service
- LLMLingua (Microsoft Research) does compression but not monitoring/diagnosis

**We would be first to market.**
