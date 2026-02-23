import { z } from "zod";
import { randomUUID } from "node:crypto";
import { CronJob } from "cron";
import type { ClawNixPlugin, PluginContext, ClawNixMessage } from "../../core/types.js";
import type { EventBus } from "../../core/event-bus.js";
import type { StateStore } from "../../core/state.js";
import type { Logger } from "../../core/types.js";

interface Directive {
  id: string;
  trigger: string;      // "cron:0 9 * * *" or "interval:30"
  action: string;       // What the agent should do
  enabled: boolean;
  createdAt: string;
  lastFiredAt?: string;
}

const NAMESPACE = "directives";
const ALL_KEY = "all";

export class DirectivesPlugin implements ClawNixPlugin {
  name = "directives";
  version = "0.1.0";
  private state?: StateStore;
  private eventBus?: EventBus;
  private logger?: Logger;
  private cronJobs: Map<string, CronJob> = new Map();
  private evaluationInterval?: ReturnType<typeof setInterval>;

  private loadDirectives(): Directive[] {
    return this.state?.getJSON<Directive[]>(NAMESPACE, ALL_KEY) ?? [];
  }

  private saveDirectives(directives: Directive[]): void {
    this.state?.setJSON(NAMESPACE, ALL_KEY, directives);
  }

  // Public so tests can call it directly
  evaluateDirectives(): void {
    const directives = this.loadDirectives();
    const now = new Date();

    for (const directive of directives) {
      if (!directive.enabled) continue;

      if (directive.trigger.startsWith("interval:")) {
        const minutes = parseInt(directive.trigger.split(":")[1], 10);
        const lastFired = directive.lastFiredAt ? new Date(directive.lastFiredAt) : null;
        const shouldFire = !lastFired || (now.getTime() - lastFired.getTime()) >= minutes * 60 * 1000;

        if (shouldFire) {
          this.fireDirective(directive);
          directive.lastFiredAt = now.toISOString();
        }
      }
    }

    this.saveDirectives(directives);
  }

  private fireDirective(directive: Directive): void {
    const msg: ClawNixMessage = {
      id: randomUUID(),
      channel: "directive",
      sender: "directive",
      text: `[Standing Directive ${directive.id}] ${directive.action}`,
      timestamp: new Date(),
    };
    this.eventBus?.emit("message:incoming", msg);
    this.logger?.info(`Directive fired: ${directive.id}`);
  }

  private setupCronDirective(directive: Directive): void {
    if (!directive.trigger.startsWith("cron:")) return;
    const cronExpr = directive.trigger.slice(5);

    try {
      const job = new CronJob(cronExpr, () => {
        this.fireDirective(directive);
        const all = this.loadDirectives();
        const d = all.find((d) => d.id === directive.id);
        if (d) {
          d.lastFiredAt = new Date().toISOString();
          this.saveDirectives(all);
        }
      });
      job.start();
      this.cronJobs.set(directive.id, job);
    } catch (err) {
      this.logger?.warn(`Invalid cron for directive ${directive.id}: ${err}`);
    }
  }

  async init(ctx: PluginContext): Promise<void> {
    this.state = ctx.state;
    this.eventBus = ctx.eventBus;
    this.logger = ctx.logger;

    // Restore cron-based directives
    const directives = this.loadDirectives();
    for (const d of directives) {
      if (d.enabled && d.trigger.startsWith("cron:")) {
        this.setupCronDirective(d);
      }
    }

    // Evaluate interval-based directives every minute
    this.evaluationInterval = setInterval(() => this.evaluateDirectives(), 60_000);

    ctx.registerTool({
      name: "clawnix_directive_create",
      description:
        "Create a standing directive — a persistent instruction that triggers automatically. " +
        "Trigger formats: 'cron:EXPRESSION' (e.g. 'cron:0 9 * * *' for daily at 9am), " +
        "'interval:MINUTES' (e.g. 'interval:30' for every 30 minutes).",
      inputSchema: z.object({
        trigger: z.string().describe("Trigger expression (e.g. 'cron:0 9 * * *' or 'interval:30')"),
        action: z.string().describe("What the agent should do when triggered"),
      }),
      run: async (input) => {
        const { trigger, action } = input as { trigger: string; action: string };
        const directive: Directive = {
          id: randomUUID().slice(0, 8),
          trigger,
          action,
          enabled: true,
          createdAt: new Date().toISOString(),
        };
        const all = this.loadDirectives();
        all.push(directive);
        this.saveDirectives(all);

        if (trigger.startsWith("cron:")) {
          this.setupCronDirective(directive);
        }

        return JSON.stringify({ status: "created", id: directive.id, trigger, action });
      },
    });

    ctx.registerTool({
      name: "clawnix_directive_list",
      description: "List all standing directives",
      inputSchema: z.object({}),
      run: async () => {
        const all = this.loadDirectives();
        if (all.length === 0) return "No standing directives.";
        return all
          .map((d) => `${d.id}: [${d.trigger}] ${d.action} (${d.enabled ? "enabled" : "disabled"}, last: ${d.lastFiredAt ?? "never"})`)
          .join("\n");
      },
    });

    ctx.registerTool({
      name: "clawnix_directive_remove",
      description: "Remove a standing directive by ID",
      inputSchema: z.object({
        directiveId: z.string().describe("ID of the directive to remove"),
      }),
      run: async (input) => {
        const { directiveId } = input as { directiveId: string };
        const all = this.loadDirectives();
        const idx = all.findIndex((d) => d.id === directiveId);
        if (idx === -1) return `Directive ${directiveId} not found.`;

        all.splice(idx, 1);
        this.saveDirectives(all);

        const job = this.cronJobs.get(directiveId);
        if (job) {
          job.stop();
          this.cronJobs.delete(directiveId);
        }

        return JSON.stringify({ status: "removed", id: directiveId });
      },
    });

    ctx.logger.info(`Directives plugin registered (${directives.length} restored)`);
  }

  async shutdown(): Promise<void> {
    if (this.evaluationInterval) clearInterval(this.evaluationInterval);
    for (const job of this.cronJobs.values()) {
      job.stop();
    }
    this.cronJobs.clear();
  }
}
