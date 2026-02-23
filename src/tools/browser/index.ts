import { BrowserClaw, type CrawlPage } from "browserclaw";
import { z } from "zod";
import type { ClawNixPlugin, PluginContext } from "../../core/types.js";

interface BrowserConfig {
  headless?: boolean;
  executablePath?: string;
}

const MAX_SNAPSHOT_CHARS = 50000;

export class BrowserPlugin implements ClawNixPlugin {
  name = "browser";
  version = "0.1.0";

  private browser: BrowserClaw | null = null;
  private currentPage: CrawlPage | null = null;

  async init(ctx: PluginContext): Promise<void> {
    const config = ctx.config as unknown as BrowserConfig;

    const ensureBrowser = async (): Promise<BrowserClaw> => {
      if (!this.browser) {
        this.browser = await BrowserClaw.launch({
          headless: config.headless ?? true,
          executablePath: config.executablePath,
          noSandbox: true,
        });
      }
      return this.browser;
    };

    const ensurePage = (): CrawlPage => {
      if (!this.currentPage) {
        throw new Error("No page open. Use clawnix_browser_open first.");
      }
      return this.currentPage;
    };

    ctx.registerTool({
      name: "clawnix_browser_open",
      description:
        "Navigate to a URL and return an AI-readable page snapshot with numbered refs " +
        "(e.g., e1, e2) for interactive elements. Use refs with click/type/fill tools.",
      inputSchema: z.object({
        url: z.string().describe("URL to navigate to"),
        interactive: z
          .boolean()
          .optional()
          .describe("Only include interactive elements (default: false)"),
      }),
      run: async (input) => {
        const { url, interactive } = input as {
          url: string;
          interactive?: boolean;
        };
        try {
          const browser = await ensureBrowser();
          this.currentPage = await browser.open(url);
          const result = await this.currentPage.snapshot({
            interactive,
            maxChars: MAX_SNAPSHOT_CHARS,
          });
          const pageUrl = await this.currentPage.url();
          const title = await this.currentPage.title();
          return JSON.stringify({
            url: pageUrl,
            title,
            snapshot: result.snapshot,
            refs: Object.keys(result.refs).length,
            stats: result.stats,
          });
        } catch (err: unknown) {
          return `Error: ${(err as Error).message}`;
        }
      },
    });

    ctx.registerTool({
      name: "clawnix_browser_snapshot",
      description:
        "Re-snapshot the current page (e.g., after clicking a link or filling a form). " +
        "Returns updated snapshot text with fresh refs.",
      inputSchema: z.object({
        interactive: z
          .boolean()
          .optional()
          .describe("Only include interactive elements"),
        compact: z
          .boolean()
          .optional()
          .describe("Remove non-interactive containers"),
      }),
      run: async (input) => {
        const { interactive, compact } = input as {
          interactive?: boolean;
          compact?: boolean;
        };
        try {
          const page = ensurePage();
          const result = await page.snapshot({
            interactive,
            compact,
            maxChars: MAX_SNAPSHOT_CHARS,
          });
          const pageUrl = await page.url();
          return JSON.stringify({
            url: pageUrl,
            snapshot: result.snapshot,
            refs: Object.keys(result.refs).length,
            stats: result.stats,
          });
        } catch (err: unknown) {
          return `Error: ${(err as Error).message}`;
        }
      },
    });

    ctx.registerTool({
      name: "clawnix_browser_click",
      description:
        "Click an element by its ref ID from the most recent snapshot (e.g., 'e1', 'e5').",
      inputSchema: z.object({
        ref: z.string().describe("Ref ID from snapshot (e.g., 'e1')"),
        doubleClick: z.boolean().optional().describe("Double-click instead"),
      }),
      run: async (input) => {
        const { ref, doubleClick } = input as {
          ref: string;
          doubleClick?: boolean;
        };
        try {
          const page = ensurePage();
          await page.click(ref, { doubleClick });
          const url = await page.url();
          return `Clicked ${ref}. Current URL: ${url}`;
        } catch (err: unknown) {
          return `Error clicking ${ref}: ${(err as Error).message}`;
        }
      },
    });

    ctx.registerTool({
      name: "clawnix_browser_type",
      description:
        "Type text into an input element by ref. Optionally press Enter after.",
      inputSchema: z.object({
        ref: z.string().describe("Ref ID of the input element"),
        text: z.string().describe("Text to type"),
        submit: z
          .boolean()
          .optional()
          .describe("Press Enter after typing (default: false)"),
      }),
      run: async (input) => {
        const { ref, text, submit } = input as {
          ref: string;
          text: string;
          submit?: boolean;
        };
        try {
          const page = ensurePage();
          await page.type(ref, text, { submit });
          return `Typed into ${ref}${submit ? " and pressed Enter" : ""}`;
        } catch (err: unknown) {
          return `Error typing in ${ref}: ${(err as Error).message}`;
        }
      },
    });

    ctx.registerTool({
      name: "clawnix_browser_fill",
      description:
        "Fill multiple form fields at once. Each field needs a ref, type, and value.",
      inputSchema: z.object({
        fields: z
          .array(
            z.object({
              ref: z.string().describe("Ref ID of the form field"),
              type: z
                .string()
                .describe("Field type: 'text', 'checkbox', 'radio'"),
              value: z
                .union([z.string(), z.number(), z.boolean()])
                .optional()
                .describe("Value to set"),
            }),
          )
          .describe("Array of form fields to fill"),
      }),
      run: async (input) => {
        const { fields } = input as {
          fields: Array<{
            ref: string;
            type: string;
            value?: string | number | boolean;
          }>;
        };
        try {
          const page = ensurePage();
          await page.fill(fields);
          return `Filled ${fields.length} field(s)`;
        } catch (err: unknown) {
          return `Error filling form: ${(err as Error).message}`;
        }
      },
    });

    ctx.registerTool({
      name: "clawnix_browser_screenshot",
      description:
        "Take a screenshot of the current page. Returns base64-encoded PNG.",
      inputSchema: z.object({
        fullPage: z
          .boolean()
          .optional()
          .describe("Capture full scrollable page"),
        ref: z
          .string()
          .optional()
          .describe("Capture specific element by ref"),
      }),
      run: async (input) => {
        const { fullPage, ref } = input as {
          fullPage?: boolean;
          ref?: string;
        };
        try {
          const page = ensurePage();
          const buffer = await page.screenshot({ fullPage, ref });
          const base64 = buffer.toString("base64");
          return JSON.stringify({
            format: "png",
            size: buffer.length,
            base64: base64.slice(0, 200) + "...",
            fullBase64: base64,
          });
        } catch (err: unknown) {
          return `Error taking screenshot: ${(err as Error).message}`;
        }
      },
    });

    ctx.registerTool({
      name: "clawnix_browser_evaluate",
      description: "Run JavaScript in the browser page context. Returns the result.",
      inputSchema: z.object({
        code: z.string().describe("JavaScript to evaluate in the page"),
        ref: z
          .string()
          .optional()
          .describe("Scope evaluation to a specific element by ref"),
      }),
      run: async (input) => {
        const { code, ref } = input as { code: string; ref?: string };
        try {
          const page = ensurePage();
          const result = await page.evaluate(code, { ref });
          return JSON.stringify(result);
        } catch (err: unknown) {
          return `Error: ${(err as Error).message}`;
        }
      },
    });

    ctx.logger.info(
      `Browser plugin registered (headless: ${config.headless ?? true})`,
    );
  }

  async shutdown(): Promise<void> {
    if (this.browser) {
      await this.browser.stop();
      this.browser = null;
      this.currentPage = null;
    }
  }
}
