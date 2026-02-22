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
      tools = [ "nixos" "observe" "dev" "scheduler" "heartbeat" ];
      workspaceDir = "/var/lib/clawnix/personal";
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
