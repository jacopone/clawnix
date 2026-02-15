import { join } from "node:path";
import { homedir } from "node:os";

export interface NixClawConfig {
  ai: { provider: "claude"; model: string; apiKeyFile: string };
  channels: {
    telegram: {
      enable: boolean;
      botTokenFile?: string;
      allowedUsers?: string[];
    };
    webui: { enable: boolean; port: number; host?: string };
  };
  voice: {
    stt: { provider: "claude" | "whisper" };
    tts: {
      provider: "elevenlabs" | "piper" | "none";
      elevenlabs?: { apiKeyFile: string; voiceId: string };
    };
  };
  tools: {
    nixos: {
      enable: boolean;
      flakePath?: string;
      allowConfigEdits?: boolean;
    };
    dev: { enable: boolean };
    observe: {
      enable: boolean;
      allowedReadPaths?: string[];
    };
  };
  mcp: {
    servers: Record<
      string,
      { command: string; args?: string[]; env?: Record<string, string> }
    >;
  };
  security: {
    policies: Array<{
      tool: string;
      effect: "allow" | "deny" | "approve";
      channels?: string[];
      users?: string[];
    }>;
    approvalTimeoutSeconds: number;
  };
  workspaceDir: string;
  stateDir: string;
}

const DEFAULT_CONFIG: NixClawConfig = {
  ai: { provider: "claude", model: "claude-sonnet-4-5-20250929", apiKeyFile: "" },
  channels: {
    telegram: { enable: false },
    webui: { enable: false, port: 3333 },
  },
  voice: {
    stt: { provider: "claude" },
    tts: { provider: "none" },
  },
  tools: {
    nixos: { enable: false },
    dev: { enable: false },
    observe: { enable: true, allowedReadPaths: ["/tmp", "/var/log", "/etc/nixos"] },
  },
  mcp: { servers: {} },
  security: {
    policies: [],
    approvalTimeoutSeconds: 300,
  },
  workspaceDir: join(homedir(), ".config/nixclaw"),
  stateDir: join(homedir(), ".local/share/nixclaw"),
};

export function loadConfig(): NixClawConfig {
  const envConfig = process.env.NIXCLAW_CONFIG;
  if (envConfig) return { ...DEFAULT_CONFIG, ...JSON.parse(envConfig) };
  return DEFAULT_CONFIG;
}
