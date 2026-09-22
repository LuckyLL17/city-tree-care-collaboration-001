# 城市公共树木养护协作系统

用于维护城市公共树木档案、巡检任务和居民异常反馈的基础协作系统。

## 技术栈

- 前端：Vite + React + TypeScript
- 后端：Node.js + TypeScript，内置 HTTP 服务
- 数据：Repository 接口 + SQLite 文件持久化（`better-sqlite3`），服务重启后记录保留；另保留内存实现用于测试

## 基础流程

建立树木档案 → 安排巡检 → 记录异常 → 派发养护 → 完成复核

## 已实现

- 业务模块切换与基础列表展示
- 新增记录
- 基于状态的流程推进
- `/api/health` 健康检查（返回当前存储后端与位置）
- Vite 开发代理和前后端分离结构
- 统一的 `Repository` 接口与 SQLite 文件实现
- 首次启动自动建表、执行迁移并写入种子数据
- 数据库不可写或迁移失败时明确报错并终止进程，不静默回退内存、不丢数据

## 数据层

```
server/data/
├── types.ts          # 共享类型、资源白名单、状态枚举、种子数据
├── repository.ts     # Repository / DataStore 统一接口
├── memory-store.ts   # 内存实现（保留旧版行为，测试或 DATA_STORE=memory 时使用）
├── sqlite-store.ts   # SQLite 文件实现：建表、迁移、播种、可写性校验
└── index.ts          # createDataStore() 工厂，按环境变量选择后端
```

三类业务（`trees` / `reports` / `inspections`）共用同一张 `records` 表，
业务字段以 JSON 保存，固定列记录 `resource`、`id`、`created_at`、插入顺序与更新时间；
`schema_meta` 表记录迁移版本和种子标记。

### 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DATA_STORE` | `sqlite` | 存储后端，可选 `sqlite` / `memory` |
| `DB_PATH` | `data/app.db` | SQLite 文件路径，相对路径相对工作目录解析，目录不存在会自动创建 |
| `PORT` | `4001` | HTTP 端口 |

### 初始化行为

1. 自动创建数据库所在目录并打开（必要时创建）数据库文件；
2. 按 `schema_meta.schema_version` 顺序执行未应用的迁移，每个迁移独立事务；
3. 执行写入探针，目录或文件只读时立即失败；
4. 仅在空库且未播种时写入种子数据（与数据同事务），已使用的库重启不会重复播种、不会覆盖用户数据。

任何一步失败都会打印 `[fatal] 数据层初始化失败…` 并以非零码退出。

## 启动

```bash
npm install
npm run dev
```

前端：`http://localhost:5174`；后端：`http://localhost:4001`。

生产方式直接运行：

```bash
npm start                # 默认使用 ./data/app.db
DB_PATH=/srv/tree/app.db # 自定义数据库位置
DATA_STORE=memory        # 仅测试：内存存储，重启清空
```

## 扩展点

后续可增加用户认证、角色权限、分页检索、附件上传、通知、审计日志、PostgreSQL Repository 实现、领域事件和更细粒度的状态校验。
