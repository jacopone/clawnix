import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "./types.js";
import { z } from "zod";

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface ConnectedServer {
  name: string;
  client: Client;
  transport: StdioClientTransport;
}

export class McpClientManager {
  private servers: ConnectedServer[] = [];

  constructor(private serverConfigs: Record<string, McpServerConfig>) {}

  async connectAll(): Promise<void> {
    for (const [name, config] of Object.entries(this.serverConfigs)) {
      try {
        const transport = new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
          env: { ...process.env, ...config.env } as Record<string, string>,
        });
        const client = new Client({ name: `clawnix-${name}`, version: "0.2.0" });
        await client.connect(transport);
        this.servers.push({ name, client, transport });
        console.log(`[mcp] Connected to ${name}`);
      } catch (err) {
        console.error(`[mcp] Failed to connect to ${name}:`, err);
      }
    }
  }

  async getAllTools(): Promise<Tool[]> {
    const tools: Tool[] = [];
    for (const server of this.servers) {
      try {
        const response = await server.client.listTools();
        for (const mcpTool of response.tools) {
          tools.push({
            name: `${server.name}_${mcpTool.name}`,
            description: mcpTool.description ?? mcpTool.name,
            inputSchema: z.any(),
            rawInputSchema: (mcpTool.inputSchema ?? { type: "object" }) as Record<string, unknown>,
            run: async (input) => {
              const result = await server.client.callTool({
                name: mcpTool.name,
                arguments: input as Record<string, unknown>,
              });
              const textContent = (result.content as Array<{ type: string; text?: string }>)
                .filter((c): c is { type: "text"; text: string } => c.type === "text")
                .map((c) => c.text)
                .join("\n");
              return textContent || JSON.stringify(result.content);
            },
          });
        }
      } catch (err) {
        console.error(`[mcp] Failed to list tools from ${server.name}:`, err);
      }
    }
    return tools;
  }

  async disconnectAll(): Promise<void> {
    for (const server of this.servers) {
      try {
        await server.client.close();
      } catch {
        // Ignore close errors
      }
    }
    this.servers = [];
  }
}
