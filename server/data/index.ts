import { isAbsolute, resolve } from 'node:path';
import { MemoryDataStore } from './memory-store.js';
import { SqliteDataStore } from './sqlite-store.js';
import type { DataStore } from './repository.js';

export interface CreateStoreOptions {
  /**
   * 存储后端：
   * - sqlite（默认）：使用 DB_PATH 指定的 SQLite 文件，进程重启数据保留；
   * - memory：进程内存储，仅用于测试或明确不需要持久化的场景。
   */
  backend?: string;
  /** SQLite 数据库文件路径，默认 data/app.db（相对进程工作目录）。 */
  dbPath?: string;
}

export const DEFAULT_DB_PATH = 'data/app.db';

export async function createDataStore(options: CreateStoreOptions = {}): Promise<DataStore> {
  const backend = (options.backend ?? process.env.DATA_STORE ?? 'sqlite').toLowerCase();

  if (backend === 'memory') {
    return new MemoryDataStore();
  }

  if (backend !== 'sqlite') {
    throw new Error(`不支持的数据存储后端：${backend}（可选值：sqlite、memory）`);
  }

  const configured = options.dbPath ?? process.env.DB_PATH ?? DEFAULT_DB_PATH;
  const filePath = isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
  return SqliteDataStore.create({ filePath });
}
