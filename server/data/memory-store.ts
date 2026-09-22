import { randomUUID } from 'node:crypto';
import {
  ALLOWED_RESOURCES,
  SEED_DATA,
  type RecordItem,
  type ResourceKey,
} from './types.js';
import type { DataStore, Repository } from './repository.js';

class MemoryRepository implements Repository {
  private readonly rows: RecordItem[];

  constructor(seed: Array<Record<string, string>>) {
    // 与旧版内存实现一致：进程启动时生成 id / createdAt。
    this.rows = seed.map((item) => ({
      ...item,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    }));
  }

  list(): RecordItem[] {
    return this.rows;
  }

  findById(id: string): RecordItem | undefined {
    return this.rows.find((item) => item.id === id);
  }

  create(input: Record<string, string>): RecordItem {
    const item: RecordItem = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.rows.push(item);
    return item;
  }

  update(id: string, patch: Record<string, string>): RecordItem | undefined {
    const item = this.findById(id);
    if (!item) return undefined;
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'id' || key === 'createdAt') continue;
      item[key] = value;
    }
    return item;
  }

  delete(id: string): boolean {
    const index = this.rows.findIndex((item) => item.id === id);
    if (index === -1) return false;
    this.rows.splice(index, 1);
    return true;
  }
}

/**
 * 内存数据存储：保留服务最初版本的行为，主要用于测试，
 * 以及在显式选择（DATA_STORE=memory）时使用。
 */
export class MemoryDataStore implements DataStore {
  readonly kind = 'memory' as const;
  readonly location = 'memory';
  private readonly repos: Record<ResourceKey, Repository>;

  constructor() {
    this.repos = ALLOWED_RESOURCES.reduce(
      (acc, key) => {
        acc[key] = new MemoryRepository(SEED_DATA[key]);
        return acc;
      },
      {} as Record<ResourceKey, Repository>,
    );
  }

  repository(resource: ResourceKey): Repository {
    return this.repos[resource];
  }

  close(): void {
    // 内存存储无需释放资源。
  }
}
