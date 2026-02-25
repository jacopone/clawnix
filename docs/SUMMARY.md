# ClawNix — Project Summary

## The idea

A personal AI agent platform that treats NixOS as a first-class deployment target. Inspired by OpenClaw's vision of an always-on AI assistant, rebuilt around what NixOS uniquely enables: agents that can safely modify their own infrastructure because NixOS provides declarative configuration and atomic rollbacks.

## What was built

77 commits over 9 days, from empty repo to self-evolving multi-agent platform.

**Core runtime** — Event-driven architecture with EventBus, SQLite state store, plugin host with lifecycle management, Claude API client with tool-use agent loop, conversation manager with context summarization.

**3 channels** — Telegram (grammY, inline keyboard buttons for approvals, voice messages via STT/TTS), Web UI (Fastify, SSE streaming, dark theme dashboard), Terminal (readline REPL for local dev).

**13 native plugins:**

| Plugin | Purpose |
|--------|---------|
| `nixos` | System status, generations, diffs, option queries, flake check/update, rebuild, rollback |
| `observe` | Read files, processes, resources, journal, network — within allowed paths |
| `dev` | Git status, test runner, Claude session management |
| `scheduler` | Persistent cron-based task scheduling in SQLite |
| `heartbeat` | Periodic execution from HEARTBEAT.md workspace files |
| `memory` | Per-agent persistent memory with shared GLOBAL.md |
| `directives` | Standing "when X, do Y" instructions with cron/interval triggers |
| `delegation` | Agent-to-agent task routing via AgentBroker with audit trail |
| `watchdog` | systemd sd_notify ping + journal health queries |
| `exec` | Run any nixpkgs package via `nix shell` — allowlist + approval for unknown |
| `google` | Gmail, Calendar, Drive via gogcli (8 tools with fine-grained policies) |
| `browser` | Headless browser via BrowserClaw (7 tools: open, snapshot, click, type, fill, screenshot, evaluate) |
| `evolve` | Self-modify NixOS config: propose, validate, rebuild, auto-rollback |

**Multi-agent system** — Agents declared as NixOS modules, each running as an isolated systemd service. Natural language router dispatches messages by prefix or AI classification. AgentBroker handles inter-agent delegation with audit trail and depth limiting (max 3).

**Security model** — Three-tier tool policies (allow/approve/deny), per-agent filesystem isolation (readPaths, writePaths, blockedPatterns), systemd DynamicUser + ProtectSystem=strict, sops-nix encrypted secrets, approval workflow that blocks the agent loop until the user decides.

**Skills system** — Per-tool markdown files loaded into the system prompt, filtered by each agent's enabled tools. 8 example skills shipped.

**Usage tracking** — Every Claude API call records input/output tokens per agent to SQLite. Exposed via `/api/usage` and `/api/usage/recent` endpoints.

## The 5-phase evolution

| Phase | What | Net effect |
|-------|------|------------|
| **1-2** | Approval workflow + exec tool | Agents can use any of 100k+ nixpkgs, with human-in-the-loop for unknown packages |
| **3** | MCP-to-CLI migration | Replaced 5 Python MCP servers with 3 native TypeScript plugins. -1314 lines, +1057 lines. Zero context bloat from MCP tool definitions. |
| **4** | Self-evolve | Agent proposes NixOS config, validates, rebuilds, auto-rollbacks on failure. Scoped to a dedicated overlay file. |
| **5** | Polish | Token usage tracking, skills system, delegation audit trail with depth limiting |

## NixOS integration

The NixOS module (`nix/module.nix`, 384 lines) declares the full agent topology:

```nix
services.clawnix = {
  enable = true;
  agents.personal = { tools = [ "exec" "google" "browser" ... ]; };
  agents.devops   = { tools = [ "nixos" "evolve" ... ]; };
};
```

Each agent becomes a systemd service. `nixos-rebuild switch` deploys everything. The 4-agent server example (`nix/server-example.nix`) shows a complete headless laptop deployment with Tailscale, sops-nix secrets, and per-agent tool policies.

## Numbers

- **77 commits**, clean linear history on master
- **173 tests** across 43 test files, all passing
- **13 native plugins**, 0 MCP servers
- **8 example skill files**
- **3 channels** (Telegram, Web UI, Terminal)
- **1 NixOS module** with multi-agent support
- **Repo**: [github.com/jacopone/clawnix](https://github.com/jacopone/clawnix) (MIT)

## Key differentiator

No other AI agent platform lets the agent modify its own infrastructure safely. NixOS declarative config + atomic rollbacks + the approval workflow = an agent that can propose "enable PostgreSQL", get your approval on Telegram, rebuild the system, and auto-rollback if something breaks. That's the gap ClawNix fills.
