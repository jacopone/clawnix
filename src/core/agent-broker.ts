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

export interface DelegationRecord {
  id: number;
  fromAgent: string;
  toAgent: string;
  task: string;
  status: "completed" | "error";
  result: string;
  timestamp: string;
  durationMs: number;
}

export type DelegationHandler = (request: DelegationRequest) => Promise<string>;

/** Callback for recording delegation audit entries. */
export type AuditRecorder = (record: Omit<DelegationRecord, "id">) => void;

export class AgentBroker {
  private agents = new Map<string, DelegationHandler>();
  private maxDepth: number;
  private currentDepth = 0;
  private auditRecorder?: AuditRecorder;

  constructor(opts?: { maxDepth?: number; auditRecorder?: AuditRecorder }) {
    this.maxDepth = opts?.maxDepth ?? 3;
    this.auditRecorder = opts?.auditRecorder;
  }

  registerAgent(name: string, handler: DelegationHandler): void {
    this.agents.set(name, handler);
  }

  listAgents(): string[] {
    return [...this.agents.keys()];
  }

  async delegate(request: DelegationRequest): Promise<DelegationResponse> {
    // Guard against runaway delegation chains
    if (this.currentDepth >= this.maxDepth) {
      const result = `Delegation depth limit (${this.maxDepth}) reached. Cannot delegate from "${request.from}" to "${request.to}".`;
      this.recordAudit(request, "error", result, 0);
      return { from: request.to, to: request.from, status: "error", result };
    }

    const handler = this.agents.get(request.to);
    if (!handler) {
      const result = `Agent "${request.to}" not found. Available: ${this.listAgents().join(", ")}`;
      this.recordAudit(request, "error", result, 0);
      return { from: request.to, to: request.from, status: "error", result };
    }

    this.currentDepth++;
    const start = Date.now();
    try {
      const result = await handler(request);
      const duration = Date.now() - start;
      this.recordAudit(request, "completed", result, duration);
      return { from: request.to, to: request.from, status: "completed", result };
    } catch (err) {
      const duration = Date.now() - start;
      const result = `Delegation to "${request.to}" failed: ${(err as Error).message}`;
      this.recordAudit(request, "error", result, duration);
      return { from: request.to, to: request.from, status: "error", result };
    } finally {
      this.currentDepth--;
    }
  }

  private recordAudit(
    request: DelegationRequest,
    status: "completed" | "error",
    result: string,
    durationMs: number,
  ): void {
    if (!this.auditRecorder) return;
    this.auditRecorder({
      fromAgent: request.from,
      toAgent: request.to,
      task: request.task,
      status,
      result: result.substring(0, 10000), // cap stored result size
      timestamp: new Date().toISOString(),
      durationMs,
    });
  }
}
