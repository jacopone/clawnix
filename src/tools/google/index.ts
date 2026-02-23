import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { ClawNixPlugin, PluginContext } from "../../core/types.js";

const exec = promisify(execFile);

const MAX_OUTPUT_BYTES = 102400;
const DEFAULT_TIMEOUT = 30;

interface GoogleConfig {
  gogcliBin?: string;
  account?: string;
  defaultTimeout?: number;
}

async function runGog(
  bin: string,
  args: string[],
  timeout: number,
): Promise<string> {
  try {
    const { stdout, stderr } = await exec(bin, args, {
      timeout: timeout * 1000,
    });
    let output = stdout + (stderr ? `\nSTDERR: ${stderr}` : "");
    if (output.length > MAX_OUTPUT_BYTES) {
      output =
        output.slice(0, MAX_OUTPUT_BYTES) +
        `\n... (truncated at ${MAX_OUTPUT_BYTES} bytes)`;
    }
    return output || "(no output)";
  } catch (err: unknown) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      message: string;
      killed?: boolean;
    };
    if (e.killed) {
      return `Error: Command timed out after ${timeout} seconds.`;
    }
    return `Error: ${e.message}\n${e.stdout ?? ""}\n${e.stderr ?? ""}`.trim();
  }
}

export class GooglePlugin implements ClawNixPlugin {
  name = "google";
  version = "0.1.0";

  async init(ctx: PluginContext): Promise<void> {
    const config = ctx.config as unknown as GoogleConfig;
    const bin = config.gogcliBin ?? "gog";
    const account = config.account;
    const timeout = config.defaultTimeout ?? DEFAULT_TIMEOUT;

    const baseArgs = (extra: string[]): string[] => {
      const args = ["--json", "--results-only", ...extra];
      if (account) args.unshift("--account", account);
      return args;
    };

    // --- Gmail ---

    ctx.registerTool({
      name: "clawnix_gmail_search",
      description:
        "Search Gmail messages. Returns JSON array of matching messages with id, subject, from, date.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "Gmail search query (e.g., 'from:john is:unread', 'subject:invoice')",
          ),
        limit: z
          .number()
          .optional()
          .describe("Max results to return (default: 20)"),
      }),
      run: async (input) => {
        const { query, limit } = input as { query: string; limit?: number };
        const args = baseArgs([
          "gmail",
          "search",
          query,
          "--max",
          String(limit ?? 20),
        ]);
        return runGog(bin, args, timeout);
      },
    });

    ctx.registerTool({
      name: "clawnix_gmail_read",
      description:
        "Read a specific Gmail message by ID. Returns full message content including body.",
      inputSchema: z.object({
        messageId: z.string().describe("Gmail message ID"),
      }),
      run: async (input) => {
        const { messageId } = input as { messageId: string };
        return runGog(bin, baseArgs(["gmail", "get", messageId]), timeout);
      },
    });

    ctx.registerTool({
      name: "clawnix_gmail_send",
      description:
        "Send an email via Gmail. Requires approval policy. Use --to, --subject, --body flags.",
      inputSchema: z.object({
        to: z.string().describe("Recipient email address"),
        subject: z.string().describe("Email subject"),
        body: z.string().describe("Email body text"),
        cc: z.string().optional().describe("CC recipients (comma-separated)"),
      }),
      run: async (input) => {
        const { to, subject, body, cc } = input as {
          to: string;
          subject: string;
          body: string;
          cc?: string;
        };
        const args = baseArgs([
          "gmail",
          "send",
          "--to",
          to,
          "--subject",
          subject,
          "--body",
          body,
          "--force",
        ]);
        if (cc) args.push("--cc", cc);
        return runGog(bin, args, timeout);
      },
    });

    ctx.registerTool({
      name: "clawnix_gmail_draft",
      description: "Create a Gmail draft (does not send).",
      inputSchema: z.object({
        to: z.string().describe("Recipient email address"),
        subject: z.string().describe("Email subject"),
        body: z.string().describe("Email body text"),
      }),
      run: async (input) => {
        const { to, subject, body } = input as {
          to: string;
          subject: string;
          body: string;
        };
        return runGog(
          bin,
          baseArgs([
            "gmail",
            "drafts",
            "create",
            "--to",
            to,
            "--subject",
            subject,
            "--body",
            body,
          ]),
          timeout,
        );
      },
    });

    // --- Calendar ---

    ctx.registerTool({
      name: "clawnix_calendar_list",
      description:
        "List upcoming calendar events. Returns JSON array with event id, summary, start, end.",
      inputSchema: z.object({
        days: z
          .number()
          .optional()
          .describe("Number of days ahead to list (default: 7)"),
        calendarId: z
          .string()
          .optional()
          .describe("Calendar ID (default: primary)"),
      }),
      run: async (input) => {
        const { days, calendarId } = input as {
          days?: number;
          calendarId?: string;
        };
        const args = baseArgs([
          "calendar",
          "events",
          calendarId ?? "primary",
          "--from",
          "now",
          "--to",
          `+${days ?? 7}d`,
        ]);
        return runGog(bin, args, timeout);
      },
    });

    ctx.registerTool({
      name: "clawnix_calendar_create",
      description:
        "Create a calendar event. Requires approval policy. Times are ISO 8601.",
      inputSchema: z.object({
        summary: z.string().describe("Event title"),
        start: z
          .string()
          .describe("Start time (ISO 8601, e.g., '2026-02-24T10:00:00')"),
        end: z
          .string()
          .describe("End time (ISO 8601, e.g., '2026-02-24T11:00:00')"),
        description: z
          .string()
          .optional()
          .describe("Event description"),
        calendarId: z
          .string()
          .optional()
          .describe("Calendar ID (default: primary)"),
      }),
      run: async (input) => {
        const { summary, start, end, description, calendarId } = input as {
          summary: string;
          start: string;
          end: string;
          description?: string;
          calendarId?: string;
        };
        const args = baseArgs([
          "calendar",
          "create",
          calendarId ?? "primary",
          "--title",
          summary,
          "--from",
          start,
          "--to",
          end,
          "--force",
        ]);
        if (description) args.push("--description", description);
        return runGog(bin, args, timeout);
      },
    });

    ctx.registerTool({
      name: "clawnix_calendar_freebusy",
      description:
        "Find free/busy time slots for a date range. Useful for scheduling.",
      inputSchema: z.object({
        from: z
          .string()
          .describe("Start date (ISO 8601 or 'today', 'tomorrow')"),
        to: z.string().describe("End date (ISO 8601 or '+7d')"),
        calendarId: z
          .string()
          .optional()
          .describe("Calendar ID (default: primary)"),
      }),
      run: async (input) => {
        const { from, to, calendarId } = input as {
          from: string;
          to: string;
          calendarId?: string;
        };
        return runGog(
          bin,
          baseArgs([
            "calendar",
            "freebusy",
            calendarId ?? "primary",
            "--from",
            from,
            "--to",
            to,
          ]),
          timeout,
        );
      },
    });

    // --- Drive ---

    ctx.registerTool({
      name: "clawnix_drive_search",
      description:
        "Search Google Drive files. Returns JSON array with file id, name, mimeType.",
      inputSchema: z.object({
        query: z.string().describe("Search query for Drive files"),
        limit: z
          .number()
          .optional()
          .describe("Max results (default: 20)"),
      }),
      run: async (input) => {
        const { query, limit } = input as { query: string; limit?: number };
        return runGog(
          bin,
          baseArgs([
            "drive",
            "search",
            query,
            "--max",
            String(limit ?? 20),
          ]),
          timeout,
        );
      },
    });

    ctx.logger.info(
      `Google plugin registered (gogcli bin: ${bin}, account: ${account ?? "default"})`,
    );
  }

  async shutdown(): Promise<void> {}
}
