/**
 * 基于 SQLite 文件（sql.js / WASM）的 Repository 实现。
 *
 * 设计要点：
 * - 每个资源一张表：id TEXT PRIMARY KEY、created_at TEXT、data TEXT（业务字段 JSON），
 *   与 API 的无模式响应结构一一对应，字段增减无需改表。
 * - 每次写操作提交后立即把数据库导出并原子写回 SQLite 文件（临时文件 + rename），
 *   服务重启后数据仍在；写盘失败时回滚内存状态并抛出 StorageError，绝不静默丢数据。
 * - 首次启动执行迁移建表并写入种子数据，通过 PRAGMA user_version 记录版本，
 *   已有数据的库文件不会重复播种。
 */
import initSqlJs from 'sql.js';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  StorageError,
  resourceKeys,
  type Item,
  type Repositories,
  type Repository,
  type ResourceKey,
} from './repository.js';

/** 当前 schema 版本；新增迁移时递增并在 migrate() 中追加步骤。 */
const SCHEMA_VERSION = 1;

/** 首次启动时写入的种子数据（与此前内存版本的初始数据一致）。 */
const seed: Record<ResourceKey, Record<string, string>[]> = {
  trees: [
    { species: '香樟', location: '青松路18号', health: '良好', lastInspection: '2026-09-10' },
    { species: '银杏', location: '滨河公园东门', health: '需关注', lastInspection: '2026-09-12' },
  ],
  reports: [{ tree: '银杏', reporter: '周宁', issue: '树冠部分枝条枯黄', status: '待派单' }],
  inspections: [{ tree: '香樟', inspector: '养护一组', date: '2026-09-23', status: '待执行' }],
};

type Row = Record<string, unknown>;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 定位 sql.js 的 wasm 资源文件。 */
function wasmDirectory(): string {
  const require = createRequire(import.meta.url);
  return dirname(require.resolve('sql.js/dist/sql-wasm.js'));
}

let sqlJsPromise: Promise<initSqlJs.SqlJsStatic> | undefined;

function loadSqlJs(): Promise<initSqlJs.SqlJsStatic> {
  sqlJsPromise ??= initSqlJs({ locateFile: (file: string) => join(wasmDirectory(), file) }).catch(
    (error: unknown) => {
      sqlJsPromise = undefined;
      throw new StorageError(`SQLite 引擎初始化失败：${messageOf(error)}`, { cause: error });
    },
  );
  return sqlJsPromise;
}

/** 单个 SQLite 文件的读写与迁移。 */
class SqliteStore {
  private constructor(
    private readonly sql: initSqlJs.SqlJsStatic,
    private db: initSqlJs.Database,
    readonly path: string,
  ) {}

  /**
   * 打开（或创建）数据库文件，执行迁移，并做一次写盘探测。
   * 任何一步失败都会抛出 StorageError，调用方据此进入明确的故障状态。
   */
  static async open(path: string): Promise<SqliteStore> {
    const sql = await loadSqlJs();
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch (error) {
      throw new StorageError(`无法创建数据库目录 ${dirname(path)}：${messageOf(error)}`, { cause: error });
    }
    let db: initSqlJs.Database;
    if (existsSync(path)) {
      try {
        db = new sql.Database(readFileSync(path));
      } catch (error) {
        throw new StorageError(`数据库文件无法读取或已损坏：${path}（${messageOf(error)}）`, { cause: error });
      }
    } else {
      db = new sql.Database();
    }
    const store = new SqliteStore(sql, db, path);
    store.migrate();
    store.persist(); // 写盘探测：数据库文件不可写时在启动阶段就暴露，而不是等丢数据
    return store;
  }

  /** 结构迁移：建表 + 空库播种，全部在一个事务内完成。 */
  private migrate(): void {
    let version: number;
    try {
      version = Number(this.scalar('PRAGMA user_version'));
    } catch (error) {
      throw new StorageError(`数据库文件无法读取或已损坏：${this.path}（${messageOf(error)}）`, { cause: error });
    }
    if (version >= SCHEMA_VERSION) return;
    this.db.run('BEGIN');
    try {
      for (const table of resourceKeys) {
        this.db.run(
          `CREATE TABLE IF NOT EXISTS ${table} (
             id TEXT PRIMARY KEY,
             created_at TEXT NOT NULL,
             data TEXT NOT NULL
           )`,
        );
      }
      // 仅在全新空库时播种，避免覆盖用户已清空的数据
      if (resourceKeys.every((table) => this.count(table) === 0)) {
        for (const table of resourceKeys) {
          for (const fields of seed[table]) {
            const { id, createdAt, data } = buildItem(fields);
            this.db.run(`INSERT INTO ${table} (id, created_at, data) VALUES (?, ?, ?)`, [
              id,
              createdAt,
              JSON.stringify(data),
            ]);
          }
        }
      }
      this.db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      this.db.run('COMMIT');
    } catch (error) {
      try {
        this.db.run('ROLLBACK');
      } catch {
        // 回滚失败时仍抛出原始迁移错误
      }
      throw new StorageError(
        `数据库迁移失败（schema 版本 ${version} → ${SCHEMA_VERSION}）：${messageOf(error)}`,
        { cause: error },
      );
    }
  }

  /** 把内存中的数据库原子写回 SQLite 文件；失败时回滚内存到磁盘上的最后状态。 */
  persist(): void {
    let bytes: Uint8Array;
    try {
      bytes = this.db.export();
    } catch (error) {
      throw new StorageError(`导出数据库内容失败：${messageOf(error)}`, { cause: error });
    }
    const tmp = `${this.path}.tmp`;
    try {
      writeFileSync(tmp, bytes);
      renameSync(tmp, this.path);
    } catch (error) {
      this.reloadFromDisk();
      throw new StorageError(
        `数据库文件不可写：${this.path}（${messageOf(error)}）。本次变更未保存，请检查磁盘权限与剩余空间。`,
        { cause: error },
      );
    }
  }

  /** 写盘失败后，用磁盘上的最后一致状态覆盖内存，保证后续读到的就是真实落盘的数据。 */
  private reloadFromDisk(): void {
    try {
      if (!existsSync(this.path)) return;
      const restored = new this.sql.Database(readFileSync(this.path));
      this.db.close();
      this.db = restored;
    } catch {
      // 磁盘文件也不可读时保留当前内存状态；错误已经向上抛出
    }
  }

  run(sql: string, params: (string | number | null)[] = []): void {
    try {
      this.db.run(sql, params);
    } catch (error) {
      throw new StorageError(`数据库写入失败：${messageOf(error)}`, { cause: error });
    }
  }

  query(sql: string, params: (string | number | null)[] = []): Row[] {
    let stmt: initSqlJs.Statement;
    try {
      stmt = this.db.prepare(sql);
    } catch (error) {
      throw new StorageError(`数据库查询失败：${messageOf(error)}`, { cause: error });
    }
    try {
      stmt.bind(params);
      const rows: Row[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } catch (error) {
      throw new StorageError(`数据库查询失败：${messageOf(error)}`, { cause: error });
    } finally {
      stmt.free();
    }
  }

  /** 最近一条语句修改的行数（用于删除结果判断）。 */
  rowsModified(): number {
    return this.db.getRowsModified();
  }

  private scalar(sql: string): unknown {
    const rows = this.query(sql);
    const row = rows[0];
    return row ? Object.values(row)[0] : undefined;
  }

  private count(table: string): number {
    return Number(this.scalar(`SELECT COUNT(*) AS n FROM ${table}`));
  }
}

/** 由存储字段（id、createdAt）与业务字段组装完整记录。 */
function buildItem(fields: Record<string, string>): { id: string; createdAt: string; data: Record<string, string> } {
  const { id: _clientId, createdAt: _clientCreatedAt, ...data } = fields;
  return { id: randomUUID(), createdAt: new Date().toISOString(), data };
}

function rowToItem(row: Row): Item {
  const data = JSON.parse(String(row.data)) as Record<string, string>;
  return { ...data, id: String(row.id), createdAt: String(row.created_at) };
}

/** 单张资源表的 Repository 实现。 */
class SqliteRepository<T extends Item = Item> implements Repository<T> {
  constructor(
    private readonly store: SqliteStore,
    private readonly table: ResourceKey,
  ) {}

  list(): T[] {
    // rowid 顺序即插入顺序，与原内存实现的行为一致
    return this.store.query(`SELECT id, created_at, data FROM ${this.table} ORDER BY rowid`).map((row) => rowToItem(row) as T);
  }

  findById(id: string): T | undefined {
    const rows = this.store.query(`SELECT id, created_at, data FROM ${this.table} WHERE id = ?`, [id]);
    const row = rows[0];
    return row ? (rowToItem(row) as T) : undefined;
  }

  create(fields: Record<string, string>): T {
    const { id, createdAt, data } = buildItem(fields);
    this.store.run(`INSERT INTO ${this.table} (id, created_at, data) VALUES (?, ?, ?)`, [
      id,
      createdAt,
      JSON.stringify(data),
    ]);
    this.store.persist();
    return { ...data, id, createdAt } as T;
  }

  update(id: string, patch: Record<string, string>): T | undefined {
    const existing = this.findById(id);
    if (!existing) return undefined;
    const { id: _id, createdAt, ...rest } = existing;
    const { id: _patchId, createdAt: _patchCreatedAt, ...changes } = patch; // id/createdAt 由服务端管理
    const data = { ...rest, ...changes };
    this.store.run(`UPDATE ${this.table} SET data = ? WHERE id = ?`, [JSON.stringify(data), id]);
    this.store.persist();
    return { ...data, id, createdAt } as T;
  }

  remove(id: string): boolean {
    this.store.run(`DELETE FROM ${this.table} WHERE id = ?`, [id]);
    const removed = this.store.rowsModified() > 0;
    if (removed) this.store.persist();
    return removed;
  }
}

/**
 * 打开 SQLite 文件并为三类资源创建 Repository。
 * 数据库不可写、文件损坏或迁移失败时抛出 StorageError。
 */
export async function createSqliteRepositories(path: string): Promise<Repositories> {
  const store = await SqliteStore.open(path);
  return {
    trees: new SqliteRepository(store, 'trees'),
    reports: new SqliteRepository(store, 'reports'),
    inspections: new SqliteRepository(store, 'inspections'),
  };
}
