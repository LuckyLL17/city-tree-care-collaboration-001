import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import BetterSqlite3, { type Database } from 'better-sqlite3';
import {
  ALLOWED_RESOURCES,
  SEED_DATA,
  type RecordItem,
  type ResourceKey,
} from './types.js';
import type { DataStore, Repository } from './repository.js';

/** 初始化 / 迁移阶段的错误：数据库不可写、迁移失败等，必须中断服务启动。 */
export class DataInitError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'DataInitError';
  }
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS records (
  resource   TEXT NOT NULL,
  id         TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_seq INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (resource, id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_records_resource_seq
  ON records (resource, created_seq);
`;

/** 版本登记表由启动引导逻辑直接创建，不依赖任何迁移，保证“先读版本再迁移”可行。 */
const META_BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
`;

/**
 * 迁移记录：数组顺序即应用顺序，version 单调递增。
 * 每个迁移在独立事务中执行，失败即抛出并中止启动，绝不静默回退到内存数据。
 */
interface Migration {
  version: number;
  name: string;
  up(db: Database): void;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    up(db) {
      db.exec(SCHEMA_SQL);
    },
  },
];

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'SQLITE_READONLY' || code === 'SQLITE_CANTOPEN') {
      return `数据库文件不可写或无法打开（${code}）`;
    }
    return error.message;
  }
  return String(error);
}

class SqliteRepository implements Repository {
  constructor(
    private readonly db: Database,
    private readonly resource: ResourceKey,
  ) {}

  list(): RecordItem[] {
    const rows = this.db
      .prepare('SELECT data FROM records WHERE resource = ? ORDER BY created_seq ASC')
      .all(this.resource) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data) as RecordItem);
  }

  findById(id: string): RecordItem | undefined {
    const row = this.db
      .prepare('SELECT data FROM records WHERE resource = ? AND id = ?')
      .get(this.resource, id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as RecordItem) : undefined;
  }

  create(input: Record<string, string>): RecordItem {
    const now = new Date().toISOString();
    const item: RecordItem = {
      ...input,
      id: randomUUID(),
      createdAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO records (resource, id, created_at, data, created_seq, updated_at)
         VALUES (@resource, @id, @createdAt, @data,
                 COALESCE((SELECT MAX(created_seq) + 1 FROM records WHERE resource = @resource), 0),
                 @createdAt)`,
      )
      .run({
        resource: this.resource,
        id: item.id,
        createdAt: item.createdAt,
        data: JSON.stringify(item),
      });
    return item;
  }

  update(id: string, patch: Record<string, string>): RecordItem | undefined {
    const current = this.findById(id);
    if (!current) return undefined;

    // id / createdAt 属于持久标识，PATCH 不允许修改。
    const next: RecordItem = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'id' || key === 'createdAt') continue;
      next[key] = value;
    }

    const now = new Date().toISOString();
    const result = this.db
      .prepare('UPDATE records SET data = ?, updated_at = ? WHERE resource = ? AND id = ?')
      .run(JSON.stringify(next), now, this.resource, id);
    if (result.changes === 0) return undefined;
    return next;
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM records WHERE resource = ? AND id = ?')
      .run(this.resource, id);
    return result.changes > 0;
  }
}

export interface SqliteDataStoreOptions {
  /** 数据库文件路径，相对路径相对于进程当前工作目录解析。 */
  filePath: string;
}

/**
 * 基于 SQLite 文件的数据存储。
 *
 * 调用 createSqliteDataStore 即完成：目录创建 → 打开/创建库文件 →
 * 元信息表引导 → 可写性校验 → 表结构迁移 → 首次启动种子数据写入。
 * 任一环节失败都会抛出 DataInitError，调用方应中止进程，避免静默丢数据。
 */
export class SqliteDataStore implements DataStore {
  readonly kind = 'sqlite' as const;
  readonly location: string;
  private readonly repos: Record<ResourceKey, Repository>;

  private constructor(private readonly db: Database, filePath: string) {
    this.location = filePath;
    this.repos = ALLOWED_RESOURCES.reduce(
      (acc, key) => {
        acc[key] = new SqliteRepository(db, key);
        return acc;
      },
      {} as Record<ResourceKey, Repository>,
    );
  }

  static async create(options: SqliteDataStoreOptions): Promise<SqliteDataStore> {
    const filePath = isAbsolute(options.filePath)
      ? options.filePath
      : resolve(process.cwd(), options.filePath);

    try {
      await mkdir(dirname(filePath), { recursive: true });
    } catch (error) {
      throw new DataInitError(
        `无法创建数据库目录：${dirname(filePath)}（${describeError(error)}）`,
        error,
      );
    }

    let db: Database;
    try {
      db = new BetterSqlite3(filePath, { fileMustExist: false, timeout: 5000 });
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      // busy_timeout 与驱动 timeout 配合，降低并发写入时的锁冲突误报。
      db.pragma('busy_timeout = 5000');
    } catch (error) {
      throw new DataInitError(
        `无法打开 SQLite 数据库文件：${filePath}（${describeError(error)}）`,
        error,
      );
    }

    const store = new SqliteDataStore(db, filePath);

    try {
      store.bootstrapMeta();
      await store.verifyWritable();
      store.migrate();
      store.seedIfEmpty();
    } catch (error) {
      db.close();
      if (error instanceof DataInitError) throw error;
      throw new DataInitError(
        `数据库迁移或初始化失败：${describeError(error)}`,
        error,
      );
    }

    return store;
  }

  repository(resource: ResourceKey): Repository {
    return this.repos[resource];
  }

  close(): void {
    this.db.close();
  }

  /** 先确保版本登记表存在，之后所有迁移与播种状态都记录在这张表中。 */
  private bootstrapMeta(): void {
    try {
      this.db.exec(META_BOOTSTRAP_SQL);
    } catch (error) {
      throw new DataInitError(
        `无法初始化数据库元信息表：${describeError(error)}`,
        error,
      );
    }
  }

  private getVersion(): number {
    const row = this.db
      .prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;
    return row ? Number(row.value) : 0;
  }

  private migrate(): void {
    const current = this.getVersion();
    const pending = migrations.filter((m) => m.version > current);
    if (pending.length === 0) return;

    for (const migration of pending) {
      const apply = this.db.transaction(() => {
        migration.up(this.db);
        this.db
          .prepare(
            `INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          )
          .run(String(migration.version));
      });
      try {
        apply.immediate();
      } catch (error) {
        throw new DataInitError(
          `数据库迁移 v${migration.version}（${migration.name}）失败：${describeError(error)}`,
          error,
        );
      }
    }
  }

  /** 显式写入探针：文件存在但目录/文件只读时，在这里快速、明确地失败。 */
  private async verifyWritable(): Promise<void> {
    const probe = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO schema_meta (key, value) VALUES ('write_probe', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(new Date().toISOString());
      this.db.prepare("DELETE FROM schema_meta WHERE key = 'write_probe'").run();
    });
    try {
      probe.immediate();
    } catch (error) {
      throw new DataInitError(
        `数据库不可写，请检查文件与目录权限：${this.location}（${describeError(error)}）`,
        error,
      );
    }
  }

  private isSeeded(): boolean {
    const row = this.db
      .prepare("SELECT value FROM schema_meta WHERE key = 'seeded'")
      .get() as { value: string } | undefined;
    return row?.value === '1';
  }

  /**
   * 首次启动（空库且未标记 seeded）时写入种子数据。
   * 标记与数据在同一事务内提交：中途失败则整体回滚并报错，不会留下半份数据。
   * 已经有记录或已播种的库不会重复插入，避免重启后覆盖用户新增/删除的结果。
   */
  private seedIfEmpty(): void {
    if (this.isSeeded()) return;

    const countRow = this.db.prepare('SELECT COUNT(*) AS n FROM records').get() as { n: number };
    if (countRow.n > 0) {
      // 库中已有业务数据（例如外部导入），仅补标记，不重复播种。
      this.db
        .prepare("INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('seeded', '1')")
        .run();
      return;
    }

    const insert = this.db.prepare(
      `INSERT INTO records (resource, id, created_at, data, created_seq, updated_at)
       VALUES (@resource, @id, @createdAt, @data, @seq, @createdAt)`,
    );

    const seed = this.db.transaction(() => {
      for (const resource of ALLOWED_RESOURCES) {
        SEED_DATA[resource].forEach((fields, index) => {
          const now = new Date().toISOString();
          const item: RecordItem = {
            ...fields,
            id: randomUUID(),
            createdAt: now,
          };
          insert.run({
            resource,
            id: item.id,
            createdAt: now,
            data: JSON.stringify(item),
            seq: index,
          });
        });
      }
      this.db
        .prepare("INSERT INTO schema_meta (key, value) VALUES ('seeded', '1')")
        .run();
    });

    try {
      seed.immediate();
    } catch (error) {
      throw new DataInitError(
        `种子数据初始化失败：${describeError(error)}`,
        error,
      );
    }
  }
}
