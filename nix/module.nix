{ self }:
{ config, lib, pkgs, ... }:
let
  cfg = config.services.clawnix;

  # Submodule for per-agent MCP server config
  mcpServerModule = lib.types.submodule {
    options = {
      command = lib.mkOption {
        type = lib.types.str;
        description = "Command to run the MCP server";
      };
      args = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ ];
        description = "Arguments for the MCP server command";
      };
      env = lib.mkOption {
        type = lib.types.attrsOf lib.types.str;
        default = { };
        description = "Environment variables for the MCP server";
      };
    };
  };

  # Submodule for tool access policies
  toolPolicyModule = lib.types.submodule {
    options = {
      tool = lib.mkOption {
        type = lib.types.str;
        description = "Tool name or '*' for wildcard";
      };
      effect = lib.mkOption {
        type = lib.types.enum [ "allow" "deny" "approve" ];
        description = "Policy effect";
      };
      channels = lib.mkOption {
        type = lib.types.nullOr (lib.types.listOf lib.types.str);
        default = null;
        description = "Channels this policy applies to (null = all)";
      };
      users = lib.mkOption {
        type = lib.types.nullOr (lib.types.listOf lib.types.str);
        default = null;
        description = "Users this policy applies to (null = all)";
      };
    };
  };

  # Resolve web UI host for an agent, considering tailscaleInterface
  webuiHost = agentCfg:
    if agentCfg.channels.webui.host != null
    then agentCfg.channels.webui.host
    else if cfg.tailscaleInterface != null
    then "{{${cfg.tailscaleInterface}}}"
    else "127.0.0.1";

  # Build the JSON config for a single agent
  agentConfigJSON = name: agentCfg: builtins.toJSON {
    agents.${name} = {
      description = agentCfg.description;
      ai = {
        provider = agentCfg.ai.provider;
        model = agentCfg.ai.model;
        apiKeyFile = agentCfg.ai.apiKeyFile;
      };
      channels = {
        telegram = {
          enable = agentCfg.channels.telegram.enable;
          botTokenFile = agentCfg.channels.telegram.botTokenFile;
          allowedUsers = agentCfg.channels.telegram.allowedUsers;
        };
        webui = {
          enable = agentCfg.channels.webui.enable;
          port = agentCfg.channels.webui.port;
          host = webuiHost agentCfg;
        };
      };
      voice = {
        stt = { provider = agentCfg.voice.stt.provider; };
        tts = {
          provider = agentCfg.voice.tts.provider;
        } // lib.optionalAttrs (agentCfg.voice.tts.provider == "elevenlabs") {
          elevenlabs = {
            apiKeyFile = agentCfg.voice.tts.elevenlabs.apiKeyFile;
            voiceId = agentCfg.voice.tts.elevenlabs.voiceId;
          };
        };
      };
      tools = agentCfg.tools;
      mcp = {
        servers = lib.mapAttrs (_: serverCfg: {
          command = serverCfg.command;
          args = serverCfg.args;
          env = serverCfg.env;
        }) (cfg.mcp.servers // agentCfg.mcp.servers);
      };
      security = {
        toolPolicies = agentCfg.security.toolPolicies;
      };
      workspaceDir = agentCfg.workspaceDir;
      filesystem = {
        readPaths = agentCfg.filesystem.readPaths;
        writePaths = agentCfg.filesystem.writePaths;
        blockedPatterns = agentCfg.filesystem.blockedPatterns;
      };
      exec = {
        allowedPackages = agentCfg.exec.allowedPackages;
        defaultTimeout = agentCfg.exec.defaultTimeout;
      };
      google = {
        gogcliBin = "${self.packages.${pkgs.system}.gogcli}/bin/gog";
        defaultTimeout = agentCfg.google.defaultTimeout;
      } // lib.optionalAttrs (agentCfg.google.account != null) {
        account = agentCfg.google.account;
      };
      browser = {
        headless = agentCfg.browser.headless;
      };
      evolve = {
        configFile = agentCfg.evolve.configFile;
        flakePath = agentCfg.evolve.flakePath;
      };
    };
    stateDir = cfg.stateDir;
    router.model = cfg.router.model;
  };

  # Agent submodule definition
  agentModule = lib.types.submodule {
    options = {
      description = lib.mkOption {
        type = lib.types.str;
        default = "";
        description = "Human-readable description of this agent's purpose";
      };

      ai = {
        provider = lib.mkOption {
          type = lib.types.enum [ "claude" ];
          default = "claude";
          description = "AI backend provider";
        };
        model = lib.mkOption {
          type = lib.types.str;
          default = "claude-sonnet-4-6";
          description = "AI model identifier";
        };
        apiKeyFile = lib.mkOption {
          type = lib.types.path;
          description = "Path to file containing the API key. Works with sops-nix: set to config.sops.secrets.\"clawnix/api-key\".path";
        };
      };

      channels = {
        telegram = {
          enable = lib.mkEnableOption "Telegram channel";
          botTokenFile = lib.mkOption {
            type = lib.types.nullOr lib.types.path;
            default = null;
            description = "Path to file containing Telegram bot token. Works with sops-nix: set to config.sops.secrets.\"clawnix/telegram-token\".path";
          };
          allowedUsers = lib.mkOption {
            type = lib.types.listOf lib.types.str;
            default = [ ];
            description = "Telegram user IDs allowed to interact (empty = all)";
          };
        };
        webui = {
          enable = lib.mkEnableOption "Web UI channel";
          port = lib.mkOption {
            type = lib.types.port;
            default = 3333;
            description = "Web UI listen port";
          };
          host = lib.mkOption {
            type = lib.types.nullOr lib.types.str;
            default = null;
            description = "Web UI listen address. When null, uses tailscaleInterface binding if set, otherwise 127.0.0.1";
          };
        };
      };

      voice = {
        stt = {
          provider = lib.mkOption {
            type = lib.types.enum [ "claude" "whisper" ];
            default = "claude";
            description = "Speech-to-text provider";
          };
        };
        tts = {
          provider = lib.mkOption {
            type = lib.types.enum [ "elevenlabs" "piper" "none" ];
            default = "none";
            description = "Text-to-speech provider";
          };
          elevenlabs = {
            apiKeyFile = lib.mkOption {
              type = lib.types.nullOr lib.types.path;
              default = null;
              description = "Path to file containing ElevenLabs API key. Works with sops-nix: set to config.sops.secrets.\"elevenlabs/api-key\".path";
            };
            voiceId = lib.mkOption {
              type = lib.types.str;
              default = "";
              description = "ElevenLabs voice ID for TTS output";
            };
          };
        };
      };

      tools = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ ];
        description = "List of tool names enabled for this agent (e.g. [\"nixos\" \"dev\" \"observe\"])";
      };

      mcp = {
        servers = lib.mkOption {
          type = lib.types.attrsOf mcpServerModule;
          default = { };
          description = "Per-agent MCP servers (merged with global mcp.servers)";
        };
      };

      security = {
        toolPolicies = lib.mkOption {
          type = lib.types.listOf toolPolicyModule;
          default = [ ];
          description = "Tool access policies for this agent (first match wins)";
        };
      };

      workspaceDir = lib.mkOption {
        type = lib.types.path;
        default = "/var/lib/clawnix/workspace";
        description = "Directory containing personality files (IDENTITY.md, SOUL.md, USER.md, HEARTBEAT.md)";
      };

      filesystem = {
        readPaths = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [ "/tmp" "/var/log" "/etc/nixos" ];
          description = "Paths the agent can read (passed to observe plugin allowedReadPaths)";
        };
        writePaths = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [ ];
          description = "Additional paths the agent can write to (added to systemd ReadWritePaths)";
        };
        blockedPatterns = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [ ".ssh" ".gnupg" "*.key" "*.pem" ];
          description = "File patterns the agent cannot access";
        };
      };

      exec = {
        allowedPackages = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [ ];
          description = "Nixpkgs packages the agent can use via clawnix_exec without approval";
        };
        defaultTimeout = lib.mkOption {
          type = lib.types.int;
          default = 30;
          description = "Default timeout in seconds for exec commands (max 300)";
        };
      };

      google = {
        account = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "Google account email for gogcli API commands";
        };
        defaultTimeout = lib.mkOption {
          type = lib.types.int;
          default = 30;
          description = "Default timeout in seconds for Google API commands";
        };
      };

      browser = {
        headless = lib.mkOption {
          type = lib.types.bool;
          default = true;
          description = "Run browser in headless mode";
        };
      };

      evolve = {
        configFile = lib.mkOption {
          type = lib.types.path;
          default = "/etc/nixos/clawnix-evolved.nix";
          description = "Path to the agent-managed NixOS overlay file";
        };
        flakePath = lib.mkOption {
          type = lib.types.str;
          default = ".";
          description = "Path to the NixOS flake for validation and rebuild";
        };
      };
    };
  };
in
{
  options.services.clawnix = {
    enable = lib.mkEnableOption "ClawNix AI agent platform";

    stateDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/clawnix";
      description = "Base directory for persistent state (SQLite databases)";
    };

    router.model = lib.mkOption {
      type = lib.types.str;
      default = "claude-sonnet-4-6";
      description = "Model used for routing requests across agents";
    };

    tailscaleInterface = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Tailscale interface name (e.g., 'tailscale0'). When set, web UI binds to this interface only.";
      example = "tailscale0";
    };

    secretsGroup = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Group for accessing sops-nix secrets (e.g., 'keys')";
    };

    mcp = {
      servers = lib.mkOption {
        type = lib.types.attrsOf mcpServerModule;
        default = { };
        description = "Global MCP servers shared across all agents";
      };
    };

    agents = lib.mkOption {
      type = lib.types.attrsOf agentModule;
      default = { };
      description = "Named agent instances, each running as a separate systemd service";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services = lib.mapAttrs' (name: agentCfg:
      lib.nameValuePair "clawnix-${name}" {
        description = "ClawNix agent: ${name}" + lib.optionalString (agentCfg.description != "") " - ${agentCfg.description}";
        after = [ "network-online.target" ];
        wants = [ "network-online.target" ];
        wantedBy = [ "multi-user.target" ];

        environment.CLAWNIX_CONFIG = agentConfigJSON name agentCfg;

        serviceConfig = {
          ExecStart = "${self.packages.${pkgs.system}.default}/bin/clawnix";
          DynamicUser = true;
          StateDirectory = "clawnix/${name}";
          ProtectSystem = "strict";
          ProtectHome = "read-only";
          ReadWritePaths = [ cfg.stateDir "${cfg.stateDir}/${name}" agentCfg.workspaceDir ]
            ++ agentCfg.filesystem.writePaths;
          NoNewPrivileges = true;
          PrivateTmp = true;
          RestartSec = 10;
          Restart = "on-failure";
          WatchdogSec = 60;
          NotifyAccess = "main";
          Type = "notify";
        } // lib.optionalAttrs (cfg.secretsGroup != null) {
          SupplementaryGroups = [ cfg.secretsGroup ];
        };
      }
    ) cfg.agents;
  };
}
