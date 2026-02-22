export interface AgentRoute {
  description: string;
  prefix: string;
}

export interface RouteResult {
  agent: string | null;
  message: string;
  method: "prefix" | "classification" | "ambiguous" | "single";
}

export interface Classifier {
  classify: (prompt: string, message: string) => Promise<string>;
}

export function parseRoutePrefix(text: string): { prefix: string; message: string } | null {
  const match = text.match(/^\/([a-z])\s+(.+)$/s);
  if (!match) return null;
  return { prefix: match[1], message: match[2] };
}

export class Router {
  private agents: Record<string, AgentRoute>;
  private prefixMap: Map<string, string>;

  constructor(agents: Record<string, AgentRoute>) {
    this.agents = agents;
    this.prefixMap = new Map();
    for (const [name, route] of Object.entries(agents)) {
      this.prefixMap.set(route.prefix, name);
    }
  }

  getClassificationPrompt(): string {
    const lines = Object.entries(this.agents)
      .map(([name, route]) => `- ${name}: ${route.description}`)
      .join("\n");
    return [
      "You route user messages to the correct agent. Reply with ONLY the agent name.",
      "If unclear, reply: AMBIGUOUS",
      "",
      "Agents:",
      lines,
    ].join("\n");
  }

  async route(text: string, classifier: Classifier): Promise<RouteResult> {
    const agentNames = Object.keys(this.agents);

    if (agentNames.length === 1) {
      return { agent: agentNames[0], message: text, method: "single" };
    }

    const prefixResult = parseRoutePrefix(text);
    if (prefixResult) {
      const agent = this.prefixMap.get(prefixResult.prefix);
      if (agent) {
        return { agent, message: prefixResult.message, method: "prefix" };
      }
    }

    const prompt = this.getClassificationPrompt();
    const classification = await classifier.classify(prompt, text);
    const normalized = classification.trim().toLowerCase();

    if (normalized === "ambiguous" || !agentNames.includes(normalized)) {
      return { agent: null, message: text, method: "ambiguous" };
    }

    return { agent: normalized, message: text, method: "classification" };
  }
}
