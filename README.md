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

## Project structure

- `src/core/` -- Agent runtime, event bus, state store, plugin host, MCP client, router
- `src/ai/` -- Claude API integration
- `src/channels/` -- Terminal, Telegram, and web UI frontends
- `src/tools/` -- Plugin modules (NixOS, scheduler, observe, dev, heartbeat)
- `nix/` -- NixOS module and server example config
- `flake.nix` -- Nix package and dev shell

## Tech stack

- TypeScript, Node.js 22
- Anthropic Claude SDK (AI backbone)
- MCP SDK (tool protocol)
- grammY (Telegram bot)
- Fastify (web UI server)
- better-sqlite3 (state persistence)
- Zod (schema validation)
- Nix flake + NixOS module
