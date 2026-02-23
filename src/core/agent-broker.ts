export interface DelegationRequest {
  from: string;
  to: string;
  task: string;
  context?: string;
}

export interface DelegationResponse {
  from: string;
  to: string;
  status: "completed" | "error";
  result: string;
}

export type DelegationHandler = (request: DelegationRequest) => Promise<string>;

export class AgentBroker {
  private agents = new Map<string, DelegationHandler>();

  registerAgent(name: string, handler: DelegationHandler): void {
    this.agents.set(name, handler);
  }

  listAgents(): string[] {
    return [...this.agents.keys()];
  }

  async delegate(request: DelegationRequest): Promise<DelegationResponse> {
    const handler = this.agents.get(request.to);
    if (!handler) {
      return {
        from: request.to,
        to: request.from,
        status: "error",
        result: `Agent "${request.to}" not found. Available: ${this.listAgents().join(", ")}`,
      };
    }
    try {
      const result = await handler(request);
      return { from: request.to, to: request.from, status: "completed", result };
    } catch (err) {
      return {
        from: request.to,
        to: request.from,
        status: "error",
        result: `Delegation to "${request.to}" failed: ${(err as Error).message}`,
      };
    }
  }
}
