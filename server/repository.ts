/**
 * 统一的数据访问层契约。
 *
 * 树木档案（trees）、异常反馈（reports）、巡检任务（inspections）三类资源
 * 共用同一个 Repository 接口，HTTP 层只依赖这里的抽象，
 * 底层可以从内存、SQLite 平滑替换为其他数据库。
 */

/** 业务记录：id 与 createdAt 由服务端生成，其余字段为任意业务数据。 */
export interface Item {
  id: string;
  createdAt: string;
  [key: string]: string;
}

/** 树木档案 */
export interface TreeItem extends Item {
  species: string;
  location: string;
  health: string;
  lastInspection: string;
}

/** 异常反馈 */
export interface ReportItem extends Item {
  tree: string;
  reporter: string;
  issue: string;
  status: string;
}

/** 巡检任务 */
export interface InspectionItem extends Item {
  tree: string;
  inspector: string;
  date: string;
  status: string;
}

export type ResourceKey = 'trees' | 'reports' | 'inspections';

export const resourceKeys: ResourceKey[] = ['trees', 'reports', 'inspections'];

/** 统一 Repository 接口：三类资源的读写契约完全一致。 */
export interface Repository<T extends Item = Item> {
  /** 按创建顺序返回全部记录。 */
  list(): T[];
  /** 按 id 查找，不存在时返回 undefined。 */
  findById(id: string): T | undefined;
  /** 创建记录；id 与 createdAt 由实现方生成，忽略入参中的同名字段。 */
  create(fields: Record<string, string>): T;
  /** 合并式更新；id 与 createdAt 不可被改写。记录不存在时返回 undefined。 */
  update(id: string, patch: Record<string, string>): T | undefined;
  /** 删除记录，返回是否确实删除了一条记录。 */
  remove(id: string): boolean;
}

/** 三类资源的 Repository 集合。 */
export interface Repositories {
  trees: Repository<TreeItem>;
  reports: Repository<ReportItem>;
  inspections: Repository<InspectionItem>;
}

/**
 * 存储层错误（数据库不可写、迁移失败、文件损坏等）。
 * HTTP 层捕获后返回明确的服务错误，绝不静默丢数据。
 */
export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageError';
  }
}
