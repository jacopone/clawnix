# ClawNix: NixOS-Native Multi-Agent AI Platform

## Overview

ClawNix is an independent, NixOS-native personal AI agent platform that runs 24/7 on a dedicated server laptop. It provides multiple specialized Claude-powered agents accessible via Telegram and a Tailscale-secured Web UI.

ClawNix is not a wrapper around OpenClaw. It is its own codebase with its own security model, leveraging NixOS declarative configuration as a core differentiator.

## Rename

The project renames from `nixclaw` to `clawnix`. This applies to: package name, NixOS module (`services.clawnix`), binary, all internal references.

## Architecture

```
NixOS Server Laptop (old laptop, lid closed, 24/7)
│
├── System Layer
│   ├── NixOS with flake-based config
│   ├── Tailscale (mesh VPN, zero exposed ports)
│   ├── sops-nix (encrypted secrets, decrypted at runtime)
│   └── Power: "restore on AC loss" BIOS + battery as UPS
│
├── Agent Layer (each a separate systemd service)
│   ├── clawnix-personal   ← daily assistant
│   ├── clawnix-devops     ← infra monitoring & deployment
│   ├── clawnix-researcher ← topic monitoring & summaries
│   └── clawnix-support    ← email drafts & document creation
│
├── Natural Language Router
│   ├── Haiku model classifies intent → picks agent
│   ├── Auto-generated prompt from agent descriptions in Nix config
│   ├── Fallback: /prefix override (/p, /d, /r, /s)
│   └── Ambiguous messages: Telegram asks with inline buttons
│
├── MCP Tool Servers (shared, each a systemd service)
│   ├── mcp-documents  (PPTX, XLSX, PDF via python-pptx, openpyxl, reportlab)
│   ├── mcp-email      (IMAP/SMTP read/draft/send)
│   ├── mcp-browser    (web search, page reading, RSS)
│   └── nixos tools    (generation diff, option queries — built-in plugin)
│
├── Communication Layer
│   ├── Telegram bot (single bot, router dispatches to correct agent)
│   └── Web UI dashboard (Tailscale-only, shows all agents)
│
└── State Layer
    ├── SQLite per agent (conversations, approvals, memory)
    └── CLAUDE.md hierarchy (global + per-agent, filesystem-based)
```

## Multi-Agent NixOS Module

Each agent is a named instance under `services.clawnix.agents`:

```nix
services.clawnix.agents = {
  personal = {
    description = "calendar, reminders, daily tasks, general questions";
    ai.model = "claude-sonnet-4-6";
    channels.telegram.enable = true;
    channels.webui.enable = true;
    tools = [ "nixos" "observe" "dev" "scheduler" "heartbeat" ];
    mcp.servers = [ "documents" "email" "browser" ];
    personality.workspaceDir = "/var/lib/clawnix/personal";
  };
  devops = {
    description = "server health, NixOS, deployments, CI/CD, infrastructure";
    ai.model = "claude-sonnet-4-6";
    channels.telegram.enable = true;
    tools = [ "nixos" "observe" "scheduler" "heartbeat" ];
    mcp.servers = [ "browser" ];
    personality.workspaceDir = "/var/lib/clawnix/devops";
  };
  researcher = {
    description = "web research, article summaries, topic monitoring, HN/Twitter";
    ai.model = "claude-sonnet-4-6";
    channels.telegram.enable = true;
    tools = [ "scheduler" "heartbeat" ];
    mcp.servers = [ "browser" "documents" ];
    personality.workspaceDir = "/var/lib/clawnix/researcher";
  };
  support = {
    description = "email drafts, client communication, documents (PPTX/XLSX/PDF)";
    ai.model = "claude-sonnet-4-6";
    channels.telegram.enable = true;
    tools = [ "scheduler" ];
    mcp.servers = [ "email" "documents" ];
    personality.workspaceDir = "/var/lib/clawnix/support";
  };
};
```

The `description` field serves double duty: documentation for humans, and input to the router's classification prompt.

`nixos-rebuild switch` spins up all agents. `nixos-rebuild switch --rollback` reverts them. Copy the flake to another machine for an identical setup.

## Natural Language Router

A lightweight classification layer between Telegram and the agents.

- Uses Haiku for fast, cheap intent classification (<500ms, fractions of a cent)
- System prompt auto-generated from agent `description` fields at startup
- Returns agent name, forwards full message
- If ambiguous: asks user via Telegram inline buttons
- Override: `/p`, `/d`, `/r`, `/s` prefixes route directly
- Single agent configured: router is skipped

## MCP Tool Servers

Each MCP server is a standalone Nix derivation running as its own systemd service, communicating over Unix domain sockets.

### mcp-documents
- Creates PPTX, XLSX, PDF files
- Tech: Python + python-pptx, openpyxl, reportlab
- Tools: `create_presentation`, `create_spreadsheet`, `create_pdf`
- Output: files saved to shared output dir, download link via Telegram/Web UI

### mcp-email
- Reads inbox, drafts replies, sends with approval
- Tech: Python + imaplib/smtplib
- Tools: `list_emails`, `read_email`, `draft_reply`, `send_email`
- Credentials isolated: only this service accesses IMAP passwords via sops-nix

### mcp-browser
- Web search, page reading, RSS feed monitoring
- Tech: TypeScript + Playwright or readability
- Tools: `web_search`, `read_page`, `monitor_rss`
- Sandboxed: own user, no access to agent state or email credentials

### Configuration

```nix
services.clawnix.mcp-servers = {
  documents = {
    package = pkgs.clawnix-mcp-documents;
    socket = "/run/clawnix/mcp-documents.sock";
  };
  email = {
    package = pkgs.clawnix-mcp-email;
    socket = "/run/clawnix/mcp-email.sock";
    secretsFile = config.sops.secrets.email-credentials.path;
  };
  browser = {
    package = pkgs.clawnix-mcp-browser;
    socket = "/run/clawnix/mcp-browser.sock";
  };
};
```

Unix domain sockets: no network exposure, socket activation for lazy startup, file permissions for access control.

## Security Model

### Layer 1: Network isolation
- Zero ports exposed to the internet
- Tailscale mesh VPN for remote access
- Web UI bound to Tailscale interface only
- Telegram bot: outbound connections only
- MCP servers: Unix domain sockets, no TCP

### Layer 2: Process isolation
- Each agent: separate systemd service with `DynamicUser=yes`
- `ProtectSystem=strict` — filesystem read-only except allowed paths
- `PrivateTmp=yes` — isolated /tmp per agent
- `ReadWritePaths` — limited to agent workspace and state DB
- `CapabilityBoundingSet=` — drop all Linux capabilities
- MCP servers: same sandboxing, scoped to their own data

### Layer 3: Application-level policies

Three-tier autonomy model:

| Tier | Action type | Behavior | Examples |
|------|------------|----------|----------|
| Auto | Read-only, no side effects | Execute silently | Web search, read email, check health, read files |
| Notify | Writes to own systems | Execute, notify after | Save file, create document, write memory, schedule task |
| Approve | External side effects | Ask via Telegram first | Send email, push code, restart service |

Configured per agent in Nix:

```nix
services.clawnix.agents.support.toolPolicies = [
  { tool = "read_email";   policy = "auto"; }
  { tool = "draft_reply";  policy = "notify"; }
  { tool = "send_email";   policy = "approve"; }
  { tool = "create_*";     policy = "notify"; }
];
```

Tunable over time: start strict, relax based on experience, all declarative and auditable.

### Secrets management
- sops-nix: encrypted in repo, decrypted at runtime
- Per-service scoping: each agent/MCP server gets only the secrets it needs

```nix
sops.secrets = {
  "anthropic-api-key" = { owner = "clawnix"; };
  "telegram-bot-token" = { owner = "clawnix"; };
  "email-credentials" = { owner = "clawnix-mcp-email"; };
};
```

### Filesystem access control (inspired by NanoClaw)

```nix
services.clawnix.agents.devops.filesystem = {
  readPaths = [ "/etc/nixos" "/var/log" ];
  writePaths = [ "/var/lib/clawnix/devops" ];
  blockedPatterns = [ ".ssh" ".gnupg" "*.key" ];
};
```

Security policy lives in Nix config (read-only /nix/store) — agents cannot modify their own permissions.

## Memory Model

Filesystem-based CLAUDE.md hierarchy (inspired by NanoClaw):

```
/var/lib/clawnix/
├── GLOBAL.md              ← all agents read (NixOS info, user preferences)
├── personal/
│   ├── CLAUDE.md          ← personal agent memory
│   ├── state.db           ← conversations, approvals
│   └── drafts/            ← prepared documents
├── devops/
│   ├── CLAUDE.md          ← devops agent memory
│   └── state.db
├── researcher/
│   ├── CLAUDE.md          ← researcher agent memory
│   └── state.db
└── support/
    ├── CLAUDE.md          ← support agent memory
    └── state.db
```

- Agents write to their own CLAUDE.md, read global
- Human-readable, version-controllable
- SQLite per agent for conversations and approvals (existing system)
- Personality files (IDENTITY.md, SOUL.md, USER.md) per agent workspace

## Research Context

### OpenClaw
196K-star TypeScript/Node.js always-on agent by Peter Steinberger (now at OpenAI). Three-layer architecture: Gateway + Channel adapters + LLM backend. Suffered February 2026 security crisis: 42K+ exposed instances, CVE-2026-25253 (CVSS 8.8), 1,184 malicious ClawHub skills. ClawNix avoids these issues by design: no exposed ports, no skill marketplace, NixOS-immutable security policy.

### PicoClaw
Ultra-lightweight Go agent by Sipeed. <10MB RAM, runs on $10 RISC-V boards. Different problem space (edge/embedded). Relevant lesson: stay small, stay focused.

### NanoClaw
Lightweight TypeScript agent using Claude Agent SDK. Key inspirations adopted:
- Container isolation per invocation → systemd sandboxing in ClawNix
- CLAUDE.md memory hierarchy → per-agent filesystem memory
- Mount allowlists → NixOS module options for filesystem policy
- "Small enough to understand" philosophy

### Existing NixOS ecosystem
- nix-openclaw: Home Manager module for OpenClaw
- openclaw-nix: hardened NixOS module with systemd sandboxing
- microvm.nix approach: cloud-hypervisor isolation for OpenClaw

ClawNix takes the best security patterns from these and builds them into the core, not as an afterthought.

## Phased Rollout

### Phase 3: Server Foundation
- Rename nixclaw → clawnix across codebase
- Evolve module.nix to support `services.clawnix.agents.<name>`
- Add natural language router (Haiku classification)
- Add Tailscale-only binding for web UI
- Add sops-nix secrets management
- Ship with one agent (personal) with all existing tools
- Minimal NixOS config for server laptop (headless, lid-closed)

### Phase 4: MCP Tool Servers
- mcp-browser (web search, page reading — highest value)
- mcp-documents (PPTX, XLSX, PDF)
- mcp-email (IMAP/SMTP with three-tier autonomy)
- Each Nix-packaged with systemd service and Unix socket

### Phase 5: Multi-Agent Split
- Split personal into 2-4 specialized agents
- Per-agent filesystem memory (GLOBAL.md + per-agent CLAUDE.md)
- Per-agent mount allowlists
- Router classifies across multiple agents

### Phase 6: Polish and Harden
- Agent-to-agent communication
- Telegram inline buttons for approvals
- Scheduled heartbeat reports (morning briefings)
- NixOS auto-update pipeline (flake lock + rebuild + rollback on failure)
- systemd watchdog + journal alerts for agent crashes

## Design Principles

1. **Declarative over imperative.** Configuration is Nix. Security is Nix. Deployment is Nix.
2. **Small enough to understand.** Each component reviewable in a sitting. MCP servers are separate packages.
3. **Secure by default, tunable by experience.** Start with three-tier autonomy. Relax based on real usage.
4. **Launch and iterate.** Phase 3 gets value fast. Each subsequent phase is informed by living with the previous one.
5. **NixOS is the differentiator.** Reproducible multi-agent deployment, declarative security, instant rollback. This platform could not exist outside NixOS.
