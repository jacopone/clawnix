import Database from "better-sqlite3";

export class StateStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (namespace, key)
      )
    `);
  }

  get(namespace: string, key: string): string | undefined {
    const row = this.db
      .prepare("SELECT value FROM kv WHERE namespace = ? AND key = ?")
      .get(namespace, key) as { value: string } | undefined;
    return row?.value;
  }

  set(namespace: string, key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO kv (namespace, key, value, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT (namespace, key)
         DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(namespace, key, value);
  }

  delete(namespace: string, key: string): void {
    this.db
      .prepare("DELETE FROM kv WHERE namespace = ? AND key = ?")
      .run(namespace, key);
  }

  getJSON<T>(namespace: string, key: string): T | undefined {
    const raw = this.get(namespace, key);
    return raw ? JSON.parse(raw) : undefined;
  }

  setJSON(namespace: string, key: string, value: unknown): void {
    this.set(namespace, key, JSON.stringify(value));
  }

  close(): void {
    this.db.close();
  }
}
