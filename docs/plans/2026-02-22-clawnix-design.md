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
├── MCP Tool Servers (shared, each a standalone Nix package)
│   ├── mcp-browser    (web search, page reading via DuckDuckGo + BeautifulSoup)
│   ├── mcp-documents  (PPTX, XLSX, PDF via python-pptx, openpyxl, reportlab)
│   ├── mcp-email      (IMAP/SMTP read/draft/send with draft-then-send)
│   ├── mcp-calendar   (Google Calendar / CalDAV — planned)
│   ├── mcp-playwright (headless browser automation — planned)
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
    mcp.servers = [ "documents" "email" "browser" "calendar" ];
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
- Web search and page content extraction
- Tech: Python + FastMCP, DuckDuckGo (ddgs), httpx, BeautifulSoup
- Tools: `search_web`, `read_page`
- URL scheme validation (http/https only), 10k char truncation, non-content stripping

### mcp-calendar (planned — Phase 5)
- Calendar management and scheduling
- Tech: Python + FastMCP, Google Calendar API or CalDAV
- Tools: `list_events`, `create_event`, `find_free_time`, `reschedule_event`
- Credentials via sops-nix (OAuth tokens or app passwords)
- Policy: list/find = auto, create/reschedule = notify

### mcp-playwright (planned — Phase 6)
- Headless browser automation for authenticated sites and form filling
- Tech: Python + FastMCP, Playwright
- Tools: `navigate`, `click`, `fill_form`, `screenshot`, `extract_data`
- Isolated browser profile per session, no persistent cookies by default
- Policy: navigate/screenshot/extract = auto, click/fill_form = approve

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

### Phase 3: Server Foundation ✅
- Rename nixclaw → clawnix across codebase
- Evolve module.nix to support `services.clawnix.agents.<name>`
- Add natural language router (Haiku classification)
- Add Tailscale-only binding for web UI
- Add sops-nix secrets management
- Ship with one agent (personal) with all existing tools
- Minimal NixOS config for server laptop (headless, lid-closed)

### Phase 4: MCP Tool Servers ✅
- mcp-browser (web search, page reading via DuckDuckGo + BeautifulSoup)
- mcp-documents (PPTX, XLSX, PDF via python-pptx, openpyxl, reportlab)
- mcp-email (IMAP/SMTP with draft-then-send workflow)
- Each Nix-packaged with `writeShellScriptBin` + `python3.withPackages`
- NixOS module and server example updated with tool policies

### Phase 5: Multi-Agent Split + Calendar
- Split personal into 2-4 specialized agents
- Per-agent filesystem memory (GLOBAL.md + per-agent CLAUDE.md)
- Per-agent mount allowlists
- Router classifies across multiple agents
- mcp-calendar (Google Calendar / CalDAV integration)
- Event-driven triggers: extend scheduler with watch conditions (email arrival, file change, webhook). Enables proactive behavior — the gap between a chatbot and a digital employee.
- Standing directives: persistent instructions that trigger on conditions ("when X happens, do Y"), stored in agent memory and evaluated by the trigger system

### Phase 6: Polish and Harden
- Agent-to-agent communication (delegation, handoff between specialists)
- Telegram inline buttons for approvals
- Scheduled heartbeat reports (morning briefings)
- NixOS auto-update pipeline (flake lock + rebuild + rollback on failure)
- systemd watchdog + journal alerts for agent crashes
- mcp-playwright (headless browser automation for authenticated sites)

### Phase 7: Digital Employee
- Additional communication channels (Slack, WhatsApp, Discord)
- CRM / project management integrations (mcp-jira, mcp-linear)
- File sharing via Telegram (send created documents directly in chat)
- Conversation handoff (agent escalates to human with full context)
- Standing directive dashboard in Web UI (view/edit/disable triggers)
- Audit log viewer (what the agent did, when, why, approval chain)

## Digital Employee Evolution

ClawNix is designed to evolve from a personal assistant into a digital employee — an autonomous agent that doesn't just respond but proactively acts on your behalf.

The key architectural insight: most "digital employee" capabilities are **just MCP servers**. The core runtime (event bus, plugin host, state, router, approval) stays stable while capabilities grow through new MCP packages:

```
Capability          → Implementation           → Core change needed?
─────────────────────────────────────────────────────────────────────
Web research        → mcp-browser              → No (done)
Document creation   → mcp-documents            → No (done)
Email management    → mcp-email                → No (done)
Calendar            → mcp-calendar             → No
Browser automation  → mcp-playwright           → No
CRM integration     → mcp-jira                 → No
Slack/WhatsApp      → new channel plugin       → No (plugin interface exists)
Proactive triggers  → scheduler enhancement    → Small (event bus extension)
Agent delegation    → inter-agent messaging    → Small (new event type)
```

Three things separate a chatbot from a digital employee:

1. **Proactive behavior.** The agent watches for conditions and acts without being asked. Requires event-driven triggers (Phase 5).
2. **Persistent memory and directives.** Standing instructions that survive across sessions. Requires CLAUDE.md hierarchy + directive storage (Phase 5).
3. **Multi-agent delegation.** One agent identifies a task outside its scope and hands it to a specialist. Requires inter-agent communication (Phase 6).

Each of these builds on the existing architecture without breaking it.

## Design Principles

1. **Declarative over imperative.** Configuration is Nix. Security is Nix. Deployment is Nix.
2. **Small enough to understand.** Each component reviewable in a sitting. MCP servers are separate packages.
3. **Secure by default, tunable by experience.** Start with three-tier autonomy. Relax based on real usage.
4. **Launch and iterate.** Phase 3 gets value fast. Each subsequent phase is informed by living with the previous one.
5. **NixOS is the differentiator.** Reproducible multi-agent deployment, declarative security, instant rollback. This platform could not exist outside NixOS.
