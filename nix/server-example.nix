# nix/server-example.nix
# Example NixOS configuration for a dedicated ClawNix server laptop.
# Copy and adapt for your hardware.
{ config, pkgs, ... }:
{
  # Headless operation: lid closed, no display manager
  services.logind.lidSwitch = "ignore";
  services.logind.lidSwitchExternalPower = "ignore";

  # Tailscale for remote access
  services.tailscale.enable = true;

  # sops-nix secrets (uncomment and point to your secrets file)
  # sops.defaultSopsFile = ./secrets.yaml;
  # sops.secrets."clawnix/anthropic-api-key" = {};
  # sops.secrets."clawnix/telegram-bot-token" = {};

  # ClawNix agent
  services.clawnix = {
    enable = true;
    stateDir = "/var/lib/clawnix";
    tailscaleInterface = "tailscale0";
    # secretsGroup = "keys";  # uncomment when using sops-nix

    # All MCP servers removed — replaced by native plugins:
    # - documents → exec + pandoc/libreoffice
    # - email + calendar → google plugin (gogcli)
    # - browser + playwright → browser plugin (BrowserClaw)
    mcp.servers = {};

    agents.personal = {
      description = "calendar, reminders, daily tasks, general questions";
      ai = {
        model = "claude-sonnet-4-6";
        # apiKeyFile = config.sops.secrets."clawnix/anthropic-api-key".path;
        apiKeyFile = "/run/secrets/anthropic-api-key";
      };
      channels.telegram = {
        enable = true;
        # botTokenFile = config.sops.secrets."clawnix/telegram-bot-token".path;
        botTokenFile = "/run/secrets/telegram-bot-token";
      };
      channels.webui.enable = true;
      tools = [ "nixos" "observe" "dev" "scheduler" "heartbeat" "memory" "directives" "watchdog" "delegation" "exec" "google" "browser" ];
      workspaceDir = "/var/lib/clawnix/personal";

      exec = {
        # Web search: agent uses ddgr (DuckDuckGo CLI) via exec
        # Documents: pandoc + libreoffice for PDF/PPTX/XLSX creation
        allowedPackages = [ "pandoc" "libreoffice" "ddgr" ];
        defaultTimeout = 60;
      };

      # google.account = "me@gmail.com";  # set to your Google account

      filesystem = {
        readPaths = [ "/tmp" "/var/log" "/etc/nixos" ];
        writePaths = [ "/var/lib/clawnix/documents" ];
        blockedPatterns = [ ".ssh" ".gnupg" "*.key" "*.pem" ];
      };

      security.toolPolicies = [
        # Exec: auto for allowlisted packages
        { tool = "clawnix_exec"; effect = "allow"; }
        # Browser: read-only auto, form interaction requires approval
        { tool = "clawnix_browser_open"; effect = "allow"; }
        { tool = "clawnix_browser_snapshot"; effect = "allow"; }
        { tool = "clawnix_browser_screenshot"; effect = "allow"; }
        { tool = "clawnix_browser_click"; effect = "approve"; }
        { tool = "clawnix_browser_type"; effect = "approve"; }
        { tool = "clawnix_browser_fill"; effect = "approve"; }
        { tool = "clawnix_browser_evaluate"; effect = "approve"; }
        # Google: read=auto, send/create=approve
        { tool = "clawnix_gmail_search"; effect = "allow"; }
        { tool = "clawnix_gmail_read"; effect = "allow"; }
        { tool = "clawnix_gmail_draft"; effect = "allow"; }
        { tool = "clawnix_gmail_send"; effect = "approve"; }
        { tool = "clawnix_calendar_list"; effect = "allow"; }
        { tool = "clawnix_calendar_freebusy"; effect = "allow"; }
        { tool = "clawnix_calendar_create"; effect = "approve"; }
        { tool = "clawnix_drive_search"; effect = "allow"; }
      ];
    };

    agents.devops = {
      description = "server health, NixOS, deployments, CI/CD, infrastructure, self-evolve";
      ai = {
        model = "claude-sonnet-4-6";
        apiKeyFile = "/run/secrets/anthropic-api-key";
      };
      channels.telegram.enable = true;
      channels.webui = {
        enable = true;
        port = 3334;
      };
      tools = [ "nixos" "observe" "scheduler" "heartbeat" "memory" "directives" "watchdog" "delegation" "evolve" ];
      workspaceDir = "/var/lib/clawnix/devops";
      filesystem.readPaths = [ "/tmp" "/var/log" "/etc/nixos" "/nix/var/nix" ];

      evolve = {
        configFile = "/etc/nixos/clawnix-evolved.nix";
        flakePath = "/etc/nixos";
      };

      security.toolPolicies = [
        { tool = "clawnix_flake_update"; effect = "allow"; channels = null; users = null; }
        { tool = "clawnix_system_rebuild"; effect = "approve"; channels = null; users = null; }
        { tool = "clawnix_system_rollback"; effect = "allow"; channels = null; users = null; }
        # Self-evolve: always requires approval (propose writes + rebuilds)
        { tool = "clawnix_evolve"; effect = "approve"; channels = null; users = null; }
      ];
    };

    agents.researcher = {
      description = "web research, article summaries, topic monitoring";
      ai = {
        model = "claude-sonnet-4-6";
        apiKeyFile = "/run/secrets/anthropic-api-key";
      };
      channels.telegram.enable = true;
      tools = [ "scheduler" "heartbeat" "memory" "directives" "watchdog" "delegation" "browser" "exec" ];
      workspaceDir = "/var/lib/clawnix/researcher";

      exec = {
        allowedPackages = [ "ddgr" ];
        defaultTimeout = 30;
      };

      security.toolPolicies = [
        { tool = "clawnix_exec"; effect = "allow"; }
        { tool = "clawnix_browser_open"; effect = "allow"; }
        { tool = "clawnix_browser_snapshot"; effect = "allow"; }
        { tool = "clawnix_browser_screenshot"; effect = "allow"; }
        { tool = "clawnix_browser_click"; effect = "approve"; }
        { tool = "clawnix_browser_type"; effect = "approve"; }
        { tool = "clawnix_browser_fill"; effect = "approve"; }
        { tool = "clawnix_browser_evaluate"; effect = "approve"; }
      ];
    };

    agents.support = {
      description = "email drafts, client communication, documents (PPTX/XLSX/PDF)";
      ai = {
        model = "claude-sonnet-4-6";
        apiKeyFile = "/run/secrets/anthropic-api-key";
      };
      channels.telegram.enable = true;
      tools = [ "scheduler" "memory" "directives" "watchdog" "delegation" "exec" "google" ];
      workspaceDir = "/var/lib/clawnix/support";

      exec = {
        allowedPackages = [ "pandoc" "libreoffice" ];
        defaultTimeout = 60;
      };

      security.toolPolicies = [
        { tool = "clawnix_exec"; effect = "allow"; }
        { tool = "clawnix_gmail_search"; effect = "allow"; }
        { tool = "clawnix_gmail_read"; effect = "allow"; }
        { tool = "clawnix_gmail_draft"; effect = "allow"; }
        { tool = "clawnix_gmail_send"; effect = "approve"; }
      ];
    };
  };

  security.sudo.extraRules = [{
    groups = [ "clawnix" ];
    commands = [
      { command = "/run/current-system/sw/bin/nixos-rebuild"; options = [ "NOPASSWD" ]; }
    ];
  }];

  # Power management for always-on operation
  powerManagement.enable = true;
  services.thermald.enable = true;

  # Minimal packages
  environment.systemPackages = with pkgs; [
    vim
    git
    htop
    tailscale
  ];

  # Firewall: only SSH, everything else via Tailscale
  networking.firewall = {
    enable = true;
    allowedTCPPorts = [ 22 ];
  };

  # SSH for emergency access
  services.openssh = {
    enable = true;
    settings = {
      PasswordAuthentication = false;
      PermitRootLogin = "no";
    };
  };
}
