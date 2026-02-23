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
    tools = [ "nixos" "observe" "dev" "scheduler" "heartbeat" ];
    workspaceDir = "/var/lib/clawnix/personal";
  };
};
```

Each agent runs as a separate systemd service (`clawnix-<name>`). Global options include `tailscaleInterface` (bind web UI to Tailscale only), `secretsGroup` (sops-nix group access), and `mcp.servers` (shared across all agents).

## Server deployment

ClawNix runs well on a dedicated laptop operating headless with lid closed. Use Tailscale for remote access and sops-nix for secrets management. See `nix/server-example.nix` for a complete configuration covering power management, firewall, SSH, and always-on operation.

## MCP tool servers

Agents gain capabilities through MCP (Model Context Protocol) tool servers. Each is a standalone Python server communicating via stdio.

| Server | Tools | Description |
|--------|-------|-------------|
| mcp-browser | `search_web`, `read_page` | Web search via DuckDuckGo, page content extraction |
| mcp-documents | `create_presentation`, `create_spreadsheet`, `create_pdf` | PPTX, XLSX, PDF creation |
| mcp-email | `list_emails`, `read_email`, `draft_reply`, `send_email` | IMAP inbox reading, draft-then-send workflow |

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
};
```

## Project structure

- `src/core/` -- Agent runtime, event bus, state store, plugin host, MCP client, router
- `src/ai/` -- Claude API integration
- `src/channels/` -- Terminal, Telegram, and web UI frontends
- `src/tools/` -- Plugin modules (NixOS, scheduler, observe, dev, heartbeat)
- `mcp-servers/` -- Python MCP tool servers (browser, documents, email)
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
- FastMCP (Python MCP tool servers)
- Nix flake + NixOS module
