import { DatabaseSync } from "node:sqlite";

class PreparedStatement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new PreparedStatement(this.database, this.sql, values);
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }

  async all() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.values), meta: { changes: 0 } };
  }

  async first(column) {
    const row = this.database.prepare(this.sql).get(...this.values) ?? null;
    return column && row ? row[column] ?? null : row;
  }
}

export class D1SQLite {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec("PRAGMA foreign_keys = ON");
  }

  prepare(sql) {
    return new PreparedStatement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}
