# ClawNix

NixOS-native personal AI agent platform. Version 0.2.0.

## What is ClawNix

ClawNix is a multi-agent AI platform that treats NixOS as a first-class deployment target. Define named agents in Nix, each with its own channels (terminal, Telegram, web UI), tools, MCP servers, and security policies. A natural language router dispatches incoming requests to the appropriate agent. Each agent runs as a hardened systemd service with `DynamicUser`, filesystem isolation, and watchdog monitoring.

ClawNix is not a fork of or wrapper around [OpenClaw](https://github.com/openclaw/openclaw) or [PicoClaw](https://github.com/sipeed/picoclaw). It is its own codebase designed around NixOS declarative configuration as a core differentiator. See [How ClawNix compares](#how-clawnix-compares) for a detailed comparison.

## Capabilities

### Communication channels
- **Telegram** — single bot, router dispatches to correct agent. Voice messages via STT/TTS. Inline keyboard buttons for tool approvals.
- **Web UI** — per-agent Fastify dashboard, bindable to Tailscale interface only
- **Terminal** — interactive REPL for local development

### Built-in tools
| Tool | Description |
|------|-------------|
| `nixos` | System status, generation diffs, option queries, flake check, auto-update (flake update + rebuild + rollback) |
| `observe` | Read files within allowed paths, run approved commands |
| `dev` | Code search, file operations for development tasks |
| `scheduler` | Persistent scheduled tasks with cron expressions |
| `heartbeat` | Periodic task execution from `HEARTBEAT.md` |
| `memory` | Per-agent persistent memory (`MEMORY.md`) with shared `GLOBAL.md` |
| `directives` | Standing "when X happens, do Y" instructions with cron and interval triggers |
| `delegation` | Agent-to-agent task routing via AgentBroker |
| `watchdog` | systemd `sd_notify` ping + journal health queries |

### MCP tool servers
External capabilities via [Model Context Protocol](https://modelcontextprotocol.io/) servers. Each is a standalone Python package communicating via stdio.

| Server | Tools | Description |
|--------|-------|-------------|
| mcp-browser | `search_web`, `read_page` | Web search via DuckDuckGo, page content extraction |
| mcp-documents | `create_presentation`, `create_spreadsheet`, `create_pdf` | PPTX, XLSX, PDF creation |
| mcp-email | `list_emails`, `read_email`, `draft_reply`, `send_email` | IMAP inbox reading, draft-then-send workflow |
| mcp-calendar | `list_events`, `create_event`, `find_free_time` | Google Calendar integration via OAuth2 |
| mcp-playwright | `navigate`, `click`, `fill_form`, `screenshot`, `extract_data` | Headless Chromium browser automation via Playwright |

### Proactive behavior
- **Standing directives** — persistent instructions that trigger on cron schedules or intervals. Example: "Every morning at 9am, generate a briefing with today's calendar, pending tasks, and system status."
- **Morning briefings** — the personal agent auto-creates a daily directive on first interaction
- **NixOS auto-updates** — the devops agent runs weekly `flake update` + `rebuild`, with automatic rollback on failure
- **Heartbeat tasks** — periodic execution of instructions from workspace files

### Multi-agent delegation
Agents delegate tasks to specialists via `clawnix_delegate`. The AgentBroker routes requests point-to-point (the EventBus handles broadcast). A personal agent can ask the researcher to find articles, or the devops agent to check server health.

### Security model
- **Network isolation** — zero exposed ports. Tailscale mesh VPN for remote access. Web UI bound to Tailscale interface only.
- **Process isolation** — each agent runs as a separate systemd service with `DynamicUser=yes`, `ProtectSystem=strict`, `ProtectHome=read-only`.
- **Filesystem policies** — per-agent `readPaths`, `writePaths`, and `blockedPatterns`. Write paths added to systemd `ReadWritePaths`.
- **Tool policies** — three-tier autonomy per tool: `allow` (auto-execute), `approve` (require human confirmation via Telegram inline buttons), `deny` (block).
- **systemd watchdog** — `WatchdogSec=60` with `sd_notify` ping every 15s. Hung agents restart automatically.
- **Secrets** — sops-nix encrypted at rest, decrypted at runtime. API keys, bot tokens, and credentials never in plaintext config.

## How ClawNix compares

ClawNix occupies a specific niche: NixOS-native, multi-agent, declarative deployment. Two other open-source personal AI agent platforms solve different problems:

### OpenClaw

[OpenClaw](https://github.com/openclaw/openclaw) (by Peter Steinberger) is the most popular open-source personal AI assistant. It provides a Gateway architecture with 15+ channel integrations (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams, Matrix, and more), voice interaction, browser automation, and a visual canvas workspace. Written in TypeScript/Node.js, deployable via Docker, Nix, or systemd.

**Where OpenClaw excels:**
- Channel coverage (15+ messaging platforms vs ClawNix's 2)
- Mature ecosystem with large community (100k+ GitHub stars)
- Cross-platform support (macOS, iOS, Android, Linux)
- Visual canvas and A2UI integration

**Where ClawNix differs:**
- NixOS-native deployment with declarative agent definitions in Nix configuration
- Multi-agent architecture with natural language routing and inter-agent delegation
- Per-agent systemd service isolation (`DynamicUser`, `ProtectSystem=strict`, filesystem policies)
- NixOS system management tools (generation diffs, auto-updates with rollback)
- Standing directives with cron/interval triggers for proactive behavior
- Reproducible deployment — `nixos-rebuild switch` deploys everything

If you want broad platform support and the largest ecosystem, use OpenClaw. If you run NixOS and want declarative multi-agent deployment with system-level integration, ClawNix fills that gap.

### PicoClaw

[PicoClaw](https://github.com/sipeed/picoclaw) is an ultra-lightweight AI agent written in Go, designed for resource-constrained hardware. It runs on less than 10MB RAM with sub-second startup, validated on RISC-V (MaixCAM) and Raspberry Pi Zero. Single binary, no runtime dependencies.

**Where PicoClaw excels:**
- Minimal resource footprint (10MB RAM vs ClawNix's ~200MB per agent)
- Runs on $10 hardware (RISC-V, ARM, Raspberry Pi Zero)
- Single binary deployment, no container or Nix required
- Sub-second startup time

**Where ClawNix differs:**
- Multi-agent architecture (PicoClaw is single-agent)
- Deep NixOS integration (system management, declarative config, generation rollback)
- MCP tool servers for extensible capabilities
- Process-level security isolation via systemd
- Standing directives and proactive behavior

If you need an AI agent on constrained hardware or want the simplest possible deployment, use PicoClaw. If you want multiple specialized agents with NixOS system management, ClawNix is the better fit.

### Summary

| | ClawNix | OpenClaw | PicoClaw |
|---|---------|----------|----------|
| Language | TypeScript | TypeScript | Go |
| Deployment | NixOS module | Docker/Nix/systemd | Single binary |
| Agents | Multi-agent with router | Single gateway | Single agent |
| Channels | Telegram, Web UI, Terminal | 15+ platforms | Telegram, Discord, QQ, DingTalk |
| System integration | NixOS-native (generations, rebuild, rollback) | Cross-platform | Minimal |
| Resource usage | ~200MB per agent | ~1GB | <10MB |
| Security | systemd DynamicUser + ProtectSystem + filesystem policies | Gateway-level | Process-level |
| Proactive behavior | Standing directives (cron/interval) | Cron jobs, webhooks | Cron reminders |
| Inter-agent | Delegation via AgentBroker | N/A | N/A |

## Quick start

```bash
# Enter dev environment
nix develop

# Install dependencies
npm install

# Build
npm run build

# Run
npm start

# Development mode with hot reload
npm run dev
```

## NixOS module

Declare agents under `services.clawnix.agents.<name>`:

```nix
services.clawnix = {
  enable = true;
  stateDir = "/var/lib/clawnix";

  agents.personal = {
    description = "calendar, reminders, daily tasks, general questions";
    ai = {
      model = "claude-sonnet-4-6";
      apiKeyFile = config.sops.secrets."clawnix/anthropic-api-key".path;
    };
    channels.telegram = {
      enable = true;
      botTokenFile = config.sops.secrets."clawnix/telegram-bot-token".path;
    };
    channels.webui.enable = true;
    tools = [ "nixos" "observe" "dev" "scheduler" "heartbeat" "memory" "directives" "delegation" "watchdog" ];
    workspaceDir = "/var/lib/clawnix/personal";
  };
};
```

Each agent runs as a separate systemd service (`clawnix-<name>`). Global options include `tailscaleInterface` (bind web UI to Tailscale only), `secretsGroup` (sops-nix group access), and `mcp.servers` (shared across all agents).

## MCP server configuration

```nix
services.clawnix.mcp.servers = {
  browser.command = "${self.packages.${pkgs.system}.mcp-browser}/bin/clawnix-mcp-browser";
  documents = {
    command = "${self.packages.${pkgs.system}.mcp-documents}/bin/clawnix-mcp-documents";
    env.CLAWNIX_DOCUMENTS_DIR = "/var/lib/clawnix/documents";
  };
  email = {
    command = "${self.packages.${pkgs.system}.mcp-email}/bin/clawnix-mcp-email";
    env.CLAWNIX_EMAIL_USER_FILE = config.sops.secrets."clawnix/email-user".path;
    env.CLAWNIX_EMAIL_PASS_FILE = config.sops.secrets."clawnix/email-pass".path;
  };
  calendar = {
    command = "${self.packages.${pkgs.system}.mcp-calendar}/bin/clawnix-mcp-calendar";
    env.CLAWNIX_GOOGLE_CREDENTIALS_FILE = config.sops.secrets."clawnix/google-creds".path;
    env.CLAWNIX_GOOGLE_TOKEN_FILE = "/var/lib/clawnix/google-token.json";
  };
  playwright = {
    command = "${self.packages.${pkgs.system}.mcp-playwright}/bin/clawnix-mcp-playwright";
  };
};
```

## Multi-agent setup

Split responsibilities across specialized agents. Each agent has its own tools, MCP servers, memory, and tool policies. The natural language router dispatches Telegram messages to the correct agent. Agents delegate tasks to each other via the AgentBroker.

See `examples/workspaces/` for personality file templates and `nix/server-example.nix` for a 4-agent configuration (personal, devops, researcher, support).

## Filesystem access control

Per-agent filesystem policies restrict what each agent can read and write:

```nix
agents.devops.filesystem = {
  readPaths = [ "/tmp" "/var/log" "/etc/nixos" "/nix/var/nix" ];
  writePaths = [ ];
  blockedPatterns = [ ".ssh" ".gnupg" "*.key" "*.pem" ];
};
```

Read paths are passed to the observe plugin. Write paths are added to systemd `ReadWritePaths`. Blocked patterns prevent access to sensitive files.

## Deployment options

### Headless server (recommended)
A dedicated laptop operating headless with lid closed. Use Tailscale for remote access and sops-nix for secrets management. See `nix/server-example.nix` for a complete 4-agent configuration.

### Desktop (daily-driver)
ClawNix runs on a desktop NixOS machine used for daily work. Each agent is process-isolated via systemd `DynamicUser` and cannot access your home directory. Recommendations for desktop use:
- Start with a single `personal` agent
- Skip the NixOS auto-update tools (or set `effect = "deny"`) — no sudo rules needed
- Use Telegram + web UI channels
- Add agents and tools as you get comfortable

## Project structure

- `src/core/` -- Agent runtime, event bus, state store, plugin host, MCP client, router, agent broker
- `src/ai/` -- Claude API integration, context management, summarization
- `src/channels/` -- Terminal, Telegram (with inline buttons), and web UI frontends
- `src/tools/` -- Plugin modules (NixOS, scheduler, observe, dev, heartbeat, memory, directives, delegation, watchdog)
- `mcp-servers/` -- Python MCP tool servers (browser, documents, email, calendar, playwright)
- `examples/` -- Workspace personality files and briefing templates
- `nix/` -- NixOS module, server example, and MCP server packaging
- `flake.nix` -- Nix packages (6 total) and dev shell

## Tech stack

- TypeScript, Node.js 22
- Anthropic Claude SDK (AI backbone)
- MCP SDK (tool protocol)
- grammY (Telegram bot with InlineKeyboard)
- Fastify (web UI server)
- better-sqlite3 (state persistence)
- Zod (schema validation)
- cron (scheduler and directives)
- FastMCP (Python MCP tool servers)
- Playwright (headless browser automation)
- Google Calendar API (calendar integration)
- Nix flake + NixOS module

## License

MIT
