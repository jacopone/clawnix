import { CronJob } from "cron";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type {
  ClawNixPlugin,
  PluginContext,
  ClawNixMessage,
} from "../../core/types.js";
import type { StateStore } from "../../core/state.js";

interface StoredTask {
  id: string;
  cronExpression: string;
  message: string;
  channel: string;
}

interface RunningTask extends StoredTask {
  job: CronJob;
}

const NAMESPACE = "scheduler";
const TASKS_KEY = "tasks";

export class SchedulerPlugin implements ClawNixPlugin {
  name = "scheduler";
  version = "0.2.0";
  private tasks: RunningTask[] = [];
  private state!: StateStore;

  private persistTasks(): void {
    const stored: StoredTask[] = this.tasks.map(({ id, cronExpression, message, channel }) => ({
      id,
      cronExpression,
      message,
      channel,
    }));
    this.state.setJSON(NAMESPACE, TASKS_KEY, stored);
  }

  private startTask(
    task: StoredTask,
    eventBus: PluginContext["eventBus"],
    logger: PluginContext["logger"]
  ): RunningTask {
    const job = new CronJob(task.cronExpression, () => {
      const msg: ClawNixMessage = {
        id: randomUUID(),
        channel: task.channel,
        sender: "scheduler",
        text: task.message,
        timestamp: new Date(),
      };
      eventBus.emit("message:incoming", msg);
      logger.info(`Scheduler triggered: ${task.id} — "${task.message}"`);
    });
    job.start();
    return { ...task, job };
  }

  async init(ctx: PluginContext): Promise<void> {
    const { eventBus, logger } = ctx;
    this.state = ctx.state;

    // Restore persisted tasks
    const stored = this.state.getJSON<StoredTask[]>(NAMESPACE, TASKS_KEY) ?? [];
    for (const task of stored) {
      try {
        const running = this.startTask(task, eventBus, logger);
        this.tasks.push(running);
        logger.info(`Restored scheduled task ${task.id}: "${task.message}"`);
      } catch (err) {
        logger.warn(
          `Failed to restore task ${task.id} with cron "${task.cronExpression}": ${err}`
        );
      }
    }

    ctx.registerTool({
      name: "clawnix_schedule_task",
      description:
        "Schedule a recurring task using a cron expression. The message will be sent to the agent on each trigger (persisted).",
      inputSchema: z.object({
        cronExpression: z
          .string()
          .describe("Cron expression (e.g. '0 9 * * *' for daily at 9am)"),
        message: z
          .string()
          .describe("Message to send to the agent on each trigger"),
        channel: z
          .string()
          .optional()
          .describe(
            "Channel to attribute the message to (default: scheduler)"
          ),
      }),
      run: async (input) => {
        const { cronExpression, message, channel } = input as {
          cronExpression: string;
          message: string;
          channel?: string;
        };
        const id = randomUUID().slice(0, 8);
        const targetChannel = channel ?? "scheduler";

        const storedTask: StoredTask = {
          id,
          cronExpression,
          message,
          channel: targetChannel,
        };

        const running = this.startTask(storedTask, eventBus, logger);
        this.tasks.push(running);
        this.persistTasks();

        return `Scheduled task ${id}: "${message}" with cron "${cronExpression}"`;
      },
    });

    ctx.registerTool({
      name: "clawnix_list_scheduled",
      description: "List all currently scheduled tasks (persisted)",
      inputSchema: z.object({}),
      run: async () => {
        if (this.tasks.length === 0) return "No scheduled tasks.";
        return this.tasks
          .map(
            (t) =>
              `${t.id}: "${t.message}" [${t.cronExpression}] (channel: ${t.channel})`
          )
          .join("\n");
      },
    });

    ctx.registerTool({
      name: "clawnix_remove_scheduled",
      description: "Remove a scheduled task by its ID",
      inputSchema: z.object({
        taskId: z.string().describe("ID of the scheduled task to remove"),
      }),
      run: async (input) => {
        const { taskId } = input as { taskId: string };
        const idx = this.tasks.findIndex((t) => t.id === taskId);
        if (idx === -1) {
          return `No scheduled task found with ID "${taskId}"`;
        }
        const [removed] = this.tasks.splice(idx, 1);
        removed.job.stop();
        this.persistTasks();
        return `Removed scheduled task ${taskId}: "${removed.message}"`;
      },
    });

    logger.info("Scheduler plugin registered");
  }

  async shutdown(): Promise<void> {
    for (const task of this.tasks) {
      task.job.stop();
    }
    this.tasks = [];
  }
}
