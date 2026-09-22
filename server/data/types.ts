/**
 * 持久化数据层的共享类型与种子数据。
 *
 * 三类业务记录（树木档案 trees / 异常反馈 reports / 巡检任务 inspections）
 * 都遵循同一种「动态字段记录」结构：固定的 id、createdAt 以及若干业务字段，
 * 前端按资源配置（fields）渲染，后端不做领域列约束。
 */

export type ResourceKey = 'trees' | 'reports' | 'inspections';

export type RecordItem = {
  id: string;
  createdAt: string;
  [key: string]: string;
};

export const ALLOWED_RESOURCES: readonly ResourceKey[] = ['trees', 'reports', 'inspections'];

export const STATUS_FLOW = ['待派单', '待执行', '处理中', '已完成'] as const;

/**
 * 首次启动写入的种子数据，结构与旧版内存实现保持一致：
 * 仅包含业务字段，id 与 createdAt 由数据层统一补齐。
 */
export const SEED_DATA: Record<ResourceKey, Array<Record<string, string>>> = {
  trees: [
    { species: '香樟', location: '青松路18号', health: '良好', lastInspection: '2026-09-10' },
    { species: '银杏', location: '滨河公园东门', health: '需关注', lastInspection: '2026-09-12' },
  ],
  reports: [
    { tree: '银杏', reporter: '周宁', issue: '树冠部分枝条枯黄', status: '待派单' },
  ],
  inspections: [
    { tree: '香樟', inspector: '养护一组', date: '2026-09-23', status: '待执行' },
  ],
};

export function isResourceKey(value: string): value is ResourceKey {
  return (ALLOWED_RESOURCES as readonly string[]).includes(value);
}
