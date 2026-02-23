import Database from "better-sqlite3";

export interface UsageRecord {
  id: number;
  agent: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  timestamp: string;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
  byAgent: Record<string, { inputTokens: number; outputTokens: number; calls: number }>;
}

export class UsageTracker {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  record(agent: string, model: string, inputTokens: number, outputTokens: number): void {
    this.db
      .prepare("INSERT INTO usage (agent, model, input_tokens, output_tokens) VALUES (?, ?, ?, ?)")
      .run(agent, model, inputTokens, outputTokens);
  }

  /** Get usage summary for the last N days (default 30). */
  summary(days = 30): UsageSummary {
    const rows = this.db
      .prepare(
        `SELECT agent, model, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, COUNT(*) as calls
         FROM usage WHERE timestamp >= datetime('now', ?)
         GROUP BY agent, model`,
      )
      .all(`-${days} days`) as Array<{
      agent: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      calls: number;
    }>;

    const byAgent: UsageSummary["byAgent"] = {};
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCalls = 0;

    for (const row of rows) {
      totalInputTokens += row.input_tokens;
      totalOutputTokens += row.output_tokens;
      totalCalls += row.calls;

      if (!byAgent[row.agent]) {
        byAgent[row.agent] = { inputTokens: 0, outputTokens: 0, calls: 0 };
      }
      byAgent[row.agent].inputTokens += row.input_tokens;
      byAgent[row.agent].outputTokens += row.output_tokens;
      byAgent[row.agent].calls += row.calls;
    }

    return { totalInputTokens, totalOutputTokens, totalCalls, byAgent };
  }

  /** Get recent usage records (most recent first). */
  recent(limit = 50): UsageRecord[] {
    return this.db
      .prepare(
        "SELECT id, agent, model, input_tokens as inputTokens, output_tokens as outputTokens, timestamp FROM usage ORDER BY id DESC LIMIT ?",
      )
      .all(limit) as UsageRecord[];
  }
}
