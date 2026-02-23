# ClawNix

Self-evolving AI agent platform for NixOS. Inspired by [OpenClaw](https://github.com/openclaw/openclaw), rebuilt around what NixOS uniquely enables for autonomous agents.

## What ClawNix does

ClawNix is a personal AI agent platform inspired by OpenClaw's vision of an always-on AI assistant. Where OpenClaw targets broad cross-platform support with 15+ channel integrations and a Gateway architecture, ClawNix takes a different path: it leans into NixOS as a first-class deployment target.

Agents are declared as NixOS modules. Each agent has its own channels (Telegram, web UI, terminal), tools, security policies, and workspace. A natural language router dispatches incoming messages to the right agent. Agents delegate tasks to each other via an AgentBroker with audit trail and depth limiting.

The key differentiator: NixOS declarative configuration + atomic rollbacks makes it safe for an agent to propose changes to its own infrastructure. No other OS provides this safety net natively. This enables a capability OpenClaw deliberately avoids: **self-evolution** — an agent that can modify its own system configuration, validate the change, apply it, and auto-rollback on failure.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  NixOS Module (services.clawnix)                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ personal │ │  devops  │ │researcher│ ...     │
│  │ (systemd)│ │ (systemd)│ │ (systemd)│         │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘        │
│       │             │            │               │
│  ┌────┴─────────────┴────────────┴──────┐       │
│  │         Natural Language Router       │       │
│  └────┬─────────────┬───────────────────┘       │
│       │             │                            │
│  ┌────┴────┐  ┌─────┴────┐                      │
│  │Telegram │  │  Web UI  │                      │
│  │(grammY) │  │(Fastify) │                      │
│  └─────────┘  └──────────┘                      │
└─────────────────────────────────────────────────┘
```

Each agent is a hardened systemd service with `DynamicUser`, `ProtectSystem=strict`, filesystem isolation, and watchdog monitoring.

## Native plugins

All capabilities are built-in TypeScript plugins. No external MCP servers needed.

| Plugin | Tools | Description |
|--------|-------|-------------|
| `nixos` | `system_status`, `generations`, `generation_diff`, `nixos_option`, `flake_check`, `flake_update`, `system_rebuild`, `system_rollback` | NixOS system management |
| `observe` | `read_file`, `processes`, `resources`, `journal`, `network` | System monitoring within allowed paths |
| `exec` | `exec` | Run CLI commands via `nix shell nixpkgs#<package>`. Allowlisted packages auto-approved, unknown trigger approval. |
| `google` | `gmail_search`, `gmail_read`, `gmail_send`, `gmail_draft`, `calendar_list`, `calendar_create`, `calendar_freebusy`, `drive_search` | Google Workspace via [gogcli](https://github.com/steipete/gogcli) |
| `browser` | `browser_open`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_fill`, `browser_screenshot`, `browser_evaluate` | Headless browser via [BrowserClaw](https://github.com/nicobailon/browserclaw) |
| `evolve` | `evolve` | Self-modify NixOS config: propose changes, validate, rebuild, auto-rollback on failure |
| `dev` | `git_status`, `run_tests`, `claude_sessions` | Development workflow tools |
| `scheduler` | `schedule_task`, `list_scheduled`, `remove_scheduled` | Persistent cron-based task scheduling |
| `heartbeat` | Periodic execution from `HEARTBEAT.md` | Proactive task execution |
| `memory` | `remember`, `recall`, `forget` | Per-agent persistent memory with shared global knowledge |
| `directives` | `create_directive`, `list_directives`, `remove_directive` | Standing "when X, do Y" instructions with cron triggers |
| `delegation` | `delegate`, `list_agents` | Agent-to-agent task routing with audit trail |
| `watchdog` | `sd_notify`, `journal_health` | systemd watchdog integration |

## Self-evolution

The `evolve` plugin lets agents propose NixOS configuration changes:

1. Agent calls `clawnix_evolve` with `action: "propose"`, provides Nix code and description
2. Tool writes to a scoped overlay file (`/etc/nixos/clawnix-evolved.nix`)
3. Validates with `nix flake check`
4. Triggers approval request (Telegram inline buttons or web UI)
5. On approval: runs `nixos-rebuild switch`
6. On failure: auto-reverts overlay and rolls back to previous generation

Agents can only modify a dedicated overlay file, not arbitrary NixOS config. The rebuild runs via a sudo rule scoped to `nixos-rebuild`.

## Exec tool: nixpkgs as tool layer

The `exec` plugin gives agents access to 100,000+ nixpkgs packages via ephemeral `nix shell` environments:

```nix
agents.personal.exec = {
  allowedPackages = [ "pandoc" "libreoffice" "ddgr" "jq" "ripgrep" ];
  defaultTimeout = 60;
};
```

- Allowlisted packages execute without approval
- Unknown packages trigger the approval workflow
- Commands run inside the agent's systemd sandbox
- Web search via `ddgr` (DuckDuckGo CLI), documents via `pandoc`/`libreoffice`

## Skills system

Each agent loads skill files from its workspace (`skills/{toolname}.md`), filtered by its enabled tools. Skills teach agents how to use their tools effectively without bloating other agents' context windows.

Example skill files are in `examples/skills/`. Copy to your agent's workspace:

```bash
cp examples/skills/browser.md /var/lib/clawnix/personal/skills/
cp examples/skills/google.md /var/lib/clawnix/personal/skills/
```

## Security model

- **Network isolation** — zero exposed ports. Tailscale mesh VPN for remote access. Web UI bound to Tailscale interface only.
- **Process isolation** — each agent runs as a separate systemd service with `DynamicUser=yes`, `ProtectSystem=strict`, `ProtectHome=read-only`.
- **Filesystem policies** — per-agent `readPaths`, `writePaths`, and `blockedPatterns`.
- **Tool policies** — three-tier autonomy per tool: `allow` (auto-execute), `approve` (require human confirmation), `deny` (block).
- **Approval workflow** — tools with `effect: "approve"` block the agent loop until the user decides via Telegram inline buttons or web UI.
- **Delegation audit** — every agent-to-agent delegation is logged with timing, status, and result. Max depth of 3 prevents runaway chains.
- **Secrets** — sops-nix encrypted at rest, decrypted at runtime.

## Usage tracking

Every Claude API call records input/output tokens per agent. Query via the web UI:

- `GET /api/usage?days=30` — summary by agent
- `GET /api/usage/recent?limit=50` — recent records

## Quick start

```bash
nix develop
npm install
npm run build
npm start       # or: npm run dev
```

## NixOS module

```nix
{
  inputs.clawnix.url = "github:jacopone/clawnix";

  outputs = { self, nixpkgs, clawnix, ... }: {
    nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
      modules = [
        clawnix.nixosModules.default
        ./configuration.nix
      ];
    };
  };
}
```

Declare agents under `services.clawnix.agents.<name>`:

```nix
services.clawnix = {
  enable = true;
  stateDir = "/var/lib/clawnix";
  tailscaleInterface = "tailscale0";

  agents.personal = {
    description = "calendar, reminders, daily tasks";
    ai.model = "claude-sonnet-4-6";
    ai.apiKeyFile = config.sops.secrets."clawnix/anthropic-api-key".path;
    channels.telegram = {
      enable = true;
      botTokenFile = config.sops.secrets."clawnix/telegram-bot-token".path;
    };
    channels.webui.enable = true;
    tools = [ "nixos" "observe" "scheduler" "heartbeat" "memory"
              "directives" "delegation" "watchdog" "exec" "google" "browser" ];
    workspaceDir = "/var/lib/clawnix/personal";
    exec.allowedPackages = [ "pandoc" "libreoffice" "ddgr" ];
    security.toolPolicies = [
      { tool = "clawnix_exec"; effect = "allow"; }
      { tool = "clawnix_gmail_send"; effect = "approve"; }
      { tool = "clawnix_calendar_create"; effect = "approve"; }
      { tool = "clawnix_browser_click"; effect = "approve"; }
    ];
  };

  agents.devops = {
    description = "server health, NixOS, deployments, self-evolve";
    ai.model = "claude-sonnet-4-6";
    ai.apiKeyFile = config.sops.secrets."clawnix/anthropic-api-key".path;
    tools = [ "nixos" "observe" "scheduler" "heartbeat" "memory"
              "directives" "delegation" "watchdog" "evolve" ];
    security.toolPolicies = [
      { tool = "clawnix_system_rebuild"; effect = "approve"; }
      { tool = "clawnix_evolve"; effect = "approve"; }
    ];
  };
};
```

See `nix/server-example.nix` for a complete 4-agent configuration.

## Inspired by OpenClaw

ClawNix draws direct inspiration from [OpenClaw](https://github.com/openclaw/openclaw), the most popular open-source personal AI assistant. OpenClaw proved that an always-on AI agent with tool access, voice interaction, and messaging integration is practical and useful. ClawNix builds on that premise.

**What ClawNix borrows from OpenClaw's playbook:**
- Tool-use agent loop with human-in-the-loop approval
- Telegram as a primary channel with inline keyboard for decisions
- Skills as markdown files loaded into the system prompt
- Personality/workspace files that shape agent behavior

**Where ClawNix diverges:**

| | ClawNix | OpenClaw |
|---|---------|----------|
| Deployment | `services.clawnix.enable = true` in NixOS config | Docker, Nix package, or systemd install |
| Agents | Multiple named agents as NixOS services, each isolated | Single gateway agent |
| Tool provisioning | `nix shell nixpkgs#tool` — ephemeral, reproducible | Pre-installed CLIs or MCP servers |
| Self-modification | Agent proposes NixOS config changes, validates, rebuilds, auto-rollbacks | Cannot modify its own infrastructure |
| Safety net | NixOS atomic rollbacks built into the OS | Docker sandbox (opt-in) |
| Reproducibility | Entire system defined in Nix, `nixos-rebuild switch` deploys everything | Depends on host state |
| Channels | Telegram, Web UI, Terminal (3) | WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams, Matrix, and more (15+) |
| Inter-agent | Delegation via AgentBroker with audit trail | N/A |

**Use OpenClaw** if you want broad platform support and the largest ecosystem.
**Use ClawNix** if you run NixOS and want declarative multi-agent deployment with self-evolving infrastructure.

## Project structure

```
src/core/       Agent runtime, event bus, state store, plugin host, router, broker, usage tracking
src/ai/         Claude API integration, context management, summarization
src/channels/   Terminal, Telegram (inline buttons), web UI
src/tools/      Native plugins: nixos, observe, dev, scheduler, heartbeat, memory,
                directives, delegation, watchdog, exec, google, browser, evolve
examples/       Skill files and workspace templates
nix/            NixOS module, server example, gogcli derivation
```

## Tech stack

- TypeScript, Node.js 22
- Anthropic Claude SDK
- grammY (Telegram bot)
- Fastify (web UI)
- better-sqlite3 (state + usage tracking)
- BrowserClaw (headless browser)
- gogcli (Google Workspace CLI)
- Zod (schema validation)
- cron (scheduler and directives)
- Nix flake + NixOS module

## License

MIT
