{ self }:
{ config, lib, pkgs, ... }:
let
  cfg = config.services.clawnix;
  configJSON = builtins.toJSON {
    ai = {
      provider = cfg.ai.provider;
      model = cfg.ai.model;
      apiKeyFile = cfg.ai.apiKeyFile;
    };
    channels = {
      telegram = {
        enable = cfg.channels.telegram.enable;
        botTokenFile = cfg.channels.telegram.botTokenFile;
        allowedUsers = cfg.channels.telegram.allowedUsers;
      };
      webui = {
        enable = cfg.channels.webui.enable;
        port = cfg.channels.webui.port;
        host = cfg.channels.webui.host;
      };
    };
    voice = {
      stt = { provider = cfg.voice.stt.provider; };
      tts = {
        provider = cfg.voice.tts.provider;
      } // lib.optionalAttrs (cfg.voice.tts.provider == "elevenlabs") {
        elevenlabs = {
          apiKeyFile = cfg.voice.tts.elevenlabs.apiKeyFile;
          voiceId = cfg.voice.tts.elevenlabs.voiceId;
        };
      };
    };
    tools = {
      nixos = {
        enable = cfg.tools.nixos.enable;
        flakePath = cfg.tools.nixos.flakePath;
        allowConfigEdits = cfg.tools.nixos.allowConfigEdits;
      };
      dev = {
        enable = cfg.tools.dev.enable;
      };
      observe = {
        enable = cfg.tools.observe.enable;
        allowedReadPaths = cfg.tools.observe.allowedReadPaths;
      };
    };
    mcp = {
      servers = lib.mapAttrs (name: serverCfg: {
        command = serverCfg.command;
        args = serverCfg.args;
        env = serverCfg.env;
      }) cfg.mcp.servers;
    };
    workspaceDir = cfg.workspaceDir;
    security = {
      policies = cfg.security.policies;
      approvalTimeoutSeconds = cfg.security.approvalTimeoutSeconds;
    };
    stateDir = cfg.stateDir;
  };
in
{
  options.services.clawnix = {
    enable = lib.mkEnableOption "ClawNix AI agent";

    ai = {
      provider = lib.mkOption {
        type = lib.types.enum [ "claude" ];
        default = "claude";
        description = "AI backend provider";
      };
      model = lib.mkOption {
        type = lib.types.str;
        default = "claude-sonnet-4-5-20250929";
        description = "AI model identifier";
      };
      apiKeyFile = lib.mkOption {
        type = lib.types.path;
        description = "Path to file containing the API key";
      };
    };

    channels = {
      telegram = {
        enable = lib.mkEnableOption "Telegram channel";
        botTokenFile = lib.mkOption {
          type = lib.types.nullOr lib.types.path;
          default = null;
          description = "Path to file containing Telegram bot token";
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
          type = lib.types.str;
          default = "127.0.0.1";
          description = "Web UI listen address";
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
            description = "Path to file containing ElevenLabs API key";
          };
          voiceId = lib.mkOption {
            type = lib.types.str;
            default = "";
            description = "ElevenLabs voice ID for TTS output";
          };
        };
      };
    };

    tools = {
      nixos = {
        enable = lib.mkEnableOption "NixOS management tools";
        flakePath = lib.mkOption {
          type = lib.types.path;
          default = "/etc/nixos";
          description = "Path to NixOS flake configuration";
        };
        allowConfigEdits = lib.mkOption {
          type = lib.types.bool;
          default = false;
          description = "Allow ClawNix to propose config file edits";
        };
      };
      dev = {
        enable = lib.mkEnableOption "Development workflow tools";
      };
    };

    mcp = {
      servers = lib.mkOption {
        type = lib.types.attrsOf (lib.types.submodule {
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
        });
        default = { };
        description = "MCP servers to connect to at startup";
      };
    };

    workspaceDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/clawnix/workspace";
      description = "Directory containing personality files (IDENTITY.md, SOUL.md, USER.md, HEARTBEAT.md)";
    };

    tools.observe = {
      enable = lib.mkEnableOption "observation tools (processes, resources, journal, network, read_file, query)";
      allowedReadPaths = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ "/tmp" "/var/log" "/etc/nixos" ];
        description = "Paths the read_file tool is allowed to access";
      };
    };

    security = {
      policies = lib.mkOption {
        type = lib.types.listOf (lib.types.submodule {
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
        });
        default = [ ];
        description = "Tool access policies (first match wins)";
      };
      approvalTimeoutSeconds = lib.mkOption {
        type = lib.types.int;
        default = 300;
        description = "Seconds before pending approval requests expire";
      };
    };

    stateDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/clawnix";
      description = "Directory for persistent state (SQLite database)";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.clawnix = {
      description = "ClawNix AI Agent";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];

      environment.CLAWNIX_CONFIG = configJSON;

      serviceConfig = {
        ExecStart = "${self.packages.${pkgs.system}.default}/bin/clawnix";
        DynamicUser = true;
        StateDirectory = "clawnix";
        ProtectSystem = "strict";
        ProtectHome = "read-only";
        ReadWritePaths = [ cfg.stateDir cfg.workspaceDir ] ++ lib.optional cfg.tools.nixos.enable cfg.tools.nixos.flakePath;
        NoNewPrivileges = true;
        PrivateTmp = true;
        RestartSec = 10;
        Restart = "on-failure";
      };
    };

    networking.firewall.allowedTCPPorts =
      lib.optional cfg.channels.webui.enable cfg.channels.webui.port;
  };
}
