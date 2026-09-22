import type { RecordItem, ResourceKey } from './types.js';

/**
 * 统一的记录仓储接口。树木、反馈、巡检三类资源共用同一套接口，
 * 资源类型在获取仓储时确定，调用方不再直接操作具体存储。
 */
export interface Repository {
  /** 返回该资源下的全部记录，顺序与插入顺序一致。 */
  list(): RecordItem[];
  findById(id: string): RecordItem | undefined;
  create(input: Record<string, string>): RecordItem;
  /** 按 PATCH 语义合并更新；id 与 createdAt 不允许被修改。 */
  update(id: string, patch: Record<string, string>): RecordItem | undefined;
  delete(id: string): boolean;
}

/**
 * 数据存储：按业务模块提供仓储，并负责底层连接的生命周期。
 */
export interface DataStore {
  /** 存储后端描述，用于启动日志与健康检查。 */
  readonly kind: 'memory' | 'sqlite';
  /** 存储位置（SQLite 为数据库文件路径，内存存储为内存标识）。 */
  readonly location: string;
  repository(resource: ResourceKey): Repository;
  close(): void;
}
