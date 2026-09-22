# 城市公共树木养护协作系统

用于维护城市公共树木档案、巡检任务和居民异常反馈的基础协作系统。

## 技术栈

- 前端：Vite + React + TypeScript
- 后端：Node.js + TypeScript，内置 HTTP 服务
- 数据：SQLite 文件持久化（sql.js / WASM），通过统一 Repository 接口访问，可替换为 PostgreSQL 等其他实现

## 基础流程

建立树木档案 → 安排巡检 → 记录异常 → 派发养护 → 完成复核

## 已实现

- 业务模块切换与基础列表展示
- 新增记录
- 基于状态的流程推进
- `/api/health` 健康检查
- Vite 开发代理和前后端分离结构
- SQLite 文件持久化：统一 Repository 接口（`server/repository.ts`）+ SQLite 实现（`server/sqlite-repository.ts`）

## 数据持久化

- 树木档案、异常反馈、巡检任务三类资源共用同一个 `Repository` 接口，HTTP 层只依赖抽象。
- 数据库文件默认位于 `data/tree-care.db`（已加入 `.gitignore`），可用环境变量 `DATABASE_PATH` 覆盖。
- 首次启动自动执行迁移：建表（`trees` / `reports` / `inspections`）并写入种子数据，版本记录在 `PRAGMA user_version`；已有数据的库文件不会重复播种。
- 每次写操作提交后原子写回数据库文件（临时文件 + rename），服务重启后数据保留。
- 故障行为：数据库不可写、文件损坏或迁移失败时，服务进入故障模式——`/api/health` 与所有数据接口返回 `503` 及明确错误信息，绝不静默丢数据；运行期写盘失败同样返回 `503`，并将内存状态回滚到磁盘上的最后一致状态。

## 启动

```bash
npm install
npm run dev
```

前端：`http://localhost:5174`；后端：`http://localhost:4001`。

## 扩展点

当前版本实现基础功能、主流程和 SQLite 持久化。后续可增加用户认证、角色权限、分页检索、附件上传、通知、审计日志、领域事件和更细粒度的状态校验；如需更换数据库，实现 `Repository` 接口即可（如 PostgreSQL）。
