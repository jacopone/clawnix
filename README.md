# ClawNix

MCP-native personal AI agent platform for NixOS. Version 0.2.0.

## What it does

A multi-agent AI platform that integrates with NixOS system management. Define named agents, each with its own channels (terminal, Telegram, web UI), tools, and MCP servers. A natural language router dispatches incoming requests to the appropriate agent. Packaged as a NixOS module for declarative deployment.

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
    tools = [ "nixos" "observe" "dev" "scheduler" "heartbeat" "memory" "directives" ];
    workspaceDir = "/var/lib/clawnix/personal";
  };
};
```

Each agent runs as a separate systemd service (`clawnix-<name>`). Global options include `tailscaleInterface` (bind web UI to Tailscale only), `secretsGroup` (sops-nix group access), and `mcp.servers` (shared across all agents).

## Server deployment

ClawNix runs well on a dedicated laptop operating headless with lid closed. Use Tailscale for remote access and sops-nix for secrets management. See `nix/server-example.nix` for a complete 4-agent configuration covering power management, firewall, SSH, and always-on operation.

## MCP tool servers

Agents gain capabilities through MCP (Model Context Protocol) tool servers. Each is a standalone Python server communicating via stdio.

| Server | Tools | Description |
|--------|-------|-------------|
| mcp-browser | `search_web`, `read_page` | Web search via DuckDuckGo, page content extraction |
| mcp-documents | `create_presentation`, `create_spreadsheet`, `create_pdf` | PPTX, XLSX, PDF creation |
| mcp-email | `list_emails`, `read_email`, `draft_reply`, `send_email` | IMAP inbox reading, draft-then-send workflow |
| mcp-calendar | `list_events`, `create_event`, `find_free_time` | Google Calendar integration via OAuth2 |
| mcp-playwright | `navigate`, `click`, `fill_form`, `screenshot`, `extract_data` | Headless Chromium browser automation via Playwright |

Configure in NixOS:

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
};
```

## Per-agent memory

Each agent has persistent memory via `memory/MEMORY.md` in its workspace directory. Agents can read and write their own memory using `clawnix_memory_read` and `clawnix_memory_write` tools. A shared `GLOBAL.md` in the state directory is read by all agents.

## Standing directives

Agents support standing directives — persistent "when X happens, do Y" instructions:

- `cron:EXPRESSION` — triggers on cron schedule (e.g. `cron:0 9 * * *` for daily at 9am)
- `interval:MINUTES` — triggers every N minutes

Directives persist across restarts and are managed with `clawnix_directive_create`, `clawnix_directive_list`, and `clawnix_directive_remove` tools.

## Agent-to-agent delegation

Agents delegate tasks to other specialists using `clawnix_delegate` and `clawnix_list_agents` tools. The AgentBroker routes requests between agents. When an agent receives a delegated task, it appears as a `message:incoming` event on the target agent's EventBus.

## Telegram inline buttons

Approval requests use inline keyboard buttons instead of text commands. Tap "Allow" or "Deny" directly in the Telegram message. The original message updates to show the decision.

## NixOS auto-updates

The devops agent can update the system with three tools:
- `clawnix_flake_update` — update flake.lock to pull latest nixpkgs
- `clawnix_system_rebuild` — rebuild and switch to new configuration
- `clawnix_system_rollback` — revert to previous generation on failure

Requires `security.sudo.extraRules` for NOPASSWD access to `nixos-rebuild`. See `nix/server-example.nix`.

## systemd watchdog

Each agent service pings systemd via `sd_notify(WATCHDOG=1)` every 15 seconds. If an agent hangs, systemd restarts it automatically. The NixOS module sets `WatchdogSec=60` and `Type=notify`. The `clawnix_agent_health` tool queries journal logs for service warnings.

## Multi-agent setup

Split responsibilities across specialized agents. Each agent has its own tools, MCP servers, memory, and tool policies. The natural language router dispatches Telegram messages to the correct agent.

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

## Project structure

- `src/core/` -- Agent runtime, event bus, state store, plugin host, MCP client, router
- `src/ai/` -- Claude API integration
- `src/channels/` -- Terminal, Telegram, and web UI frontends
- `src/tools/` -- Plugin modules (NixOS, scheduler, observe, dev, heartbeat, memory, directives)
- `mcp-servers/` -- Python MCP tool servers (browser, documents, email, calendar, playwright)
- `examples/` -- Workspace personality files for each agent
- `nix/` -- NixOS module, server example, and MCP server packaging
- `flake.nix` -- Nix packages and dev shell

## Tech stack

- TypeScript, Node.js 22
- Anthropic Claude SDK (AI backbone)
- MCP SDK (tool protocol)
- grammY (Telegram bot)
- Fastify (web UI server)
- better-sqlite3 (state persistence)
- Zod (schema validation)
- cron (scheduler and directives)
- FastMCP (Python MCP tool servers)
- Google Calendar API (calendar integration)
- Playwright (headless browser automation)
- Nix flake + NixOS module
