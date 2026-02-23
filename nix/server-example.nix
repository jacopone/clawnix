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

    # MCP tool servers shared across all agents
    mcp.servers = {
      browser = {
        command = "${self.packages.${pkgs.system}.mcp-browser}/bin/clawnix-mcp-browser";
      };
      documents = {
        command = "${self.packages.${pkgs.system}.mcp-documents}/bin/clawnix-mcp-documents";
        env.CLAWNIX_DOCUMENTS_DIR = "/var/lib/clawnix/documents";
      };
      email = {
        command = "${self.packages.${pkgs.system}.mcp-email}/bin/clawnix-mcp-email";
        env = {
          CLAWNIX_EMAIL_IMAP_HOST = "imap.gmail.com";
          CLAWNIX_EMAIL_SMTP_HOST = "smtp.gmail.com";
          # CLAWNIX_EMAIL_USER_FILE = config.sops.secrets."clawnix/email-user".path;
          # CLAWNIX_EMAIL_PASS_FILE = config.sops.secrets."clawnix/email-pass".path;
          CLAWNIX_EMAIL_USER_FILE = "/run/secrets/email-user";
          CLAWNIX_EMAIL_PASS_FILE = "/run/secrets/email-pass";
        };
      };
      calendar = {
        command = "${self.packages.${pkgs.system}.mcp-calendar}/bin/clawnix-mcp-calendar";
        env = {
          # CLAWNIX_GOOGLE_CREDENTIALS_FILE = config.sops.secrets."clawnix/google-creds".path;
          CLAWNIX_GOOGLE_CREDENTIALS_FILE = "/run/secrets/google-credentials.json";
          CLAWNIX_GOOGLE_TOKEN_FILE = "/var/lib/clawnix/google-token.json";
        };
      };
    };

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
      tools = [ "nixos" "observe" "dev" "scheduler" "heartbeat" "memory" "directives" ];
      workspaceDir = "/var/lib/clawnix/personal";

      filesystem = {
        readPaths = [ "/tmp" "/var/log" "/etc/nixos" ];
        writePaths = [ "/var/lib/clawnix/documents" ];
        blockedPatterns = [ ".ssh" ".gnupg" "*.key" "*.pem" ];
      };

      security.toolPolicies = [
        # Browser: auto (read-only)
        { tool = "search_web"; effect = "allow"; }
        { tool = "read_page"; effect = "allow"; }
        # Documents: auto (creates files locally)
        { tool = "create_presentation"; effect = "allow"; }
        { tool = "create_spreadsheet"; effect = "allow"; }
        { tool = "create_pdf"; effect = "allow"; }
        # Email: tiered (read=auto, draft=auto, send=approve)
        { tool = "list_emails"; effect = "allow"; }
        { tool = "read_email"; effect = "allow"; }
        { tool = "draft_reply"; effect = "allow"; }
        { tool = "send_email"; effect = "approve"; }
        # Calendar: list=auto, create=approve
        { tool = "list_events"; effect = "allow"; }
        { tool = "find_free_time"; effect = "allow"; }
        { tool = "create_event"; effect = "approve"; }
      ];
    };

    agents.devops = {
      description = "server health, NixOS, deployments, CI/CD, infrastructure";
      ai = {
        model = "claude-sonnet-4-6";
        apiKeyFile = "/run/secrets/anthropic-api-key";
      };
      channels.telegram.enable = true;
      channels.webui = {
        enable = true;
        port = 3334;
      };
      tools = [ "nixos" "observe" "scheduler" "heartbeat" "memory" "directives" ];
      workspaceDir = "/var/lib/clawnix/devops";
      filesystem.readPaths = [ "/tmp" "/var/log" "/etc/nixos" "/nix/var/nix" ];
    };

    agents.researcher = {
      description = "web research, article summaries, topic monitoring";
      ai = {
        model = "claude-sonnet-4-6";
        apiKeyFile = "/run/secrets/anthropic-api-key";
      };
      channels.telegram.enable = true;
      tools = [ "scheduler" "heartbeat" "memory" "directives" ];
      workspaceDir = "/var/lib/clawnix/researcher";
    };

    agents.support = {
      description = "email drafts, client communication, documents (PPTX/XLSX/PDF)";
      ai = {
        model = "claude-sonnet-4-6";
        apiKeyFile = "/run/secrets/anthropic-api-key";
      };
      channels.telegram.enable = true;
      tools = [ "scheduler" "memory" "directives" ];
      workspaceDir = "/var/lib/clawnix/support";

      security.toolPolicies = [
        { tool = "list_emails"; effect = "allow"; }
        { tool = "read_email"; effect = "allow"; }
        { tool = "draft_reply"; effect = "allow"; }
        { tool = "send_email"; effect = "approve"; }
        { tool = "create_presentation"; effect = "allow"; }
        { tool = "create_spreadsheet"; effect = "allow"; }
        { tool = "create_pdf"; effect = "allow"; }
      ];
    };
  };

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
