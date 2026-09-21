# 城市公共树木养护协作系统

用于维护城市公共树木档案、巡检任务和居民异常反馈的基础协作系统。

## 技术栈

- 前端：Vite + React + TypeScript
- 后端：Node.js + TypeScript，内置 HTTP 服务
- 数据：当前使用内存数据，方便后续替换为 Repository、SQLite 或 PostgreSQL

## 基础流程

建立树木档案 → 安排巡检 → 记录异常 → 派发养护 → 完成复核

## 已实现

- 业务模块切换与基础列表展示
- 新增记录
- 基于状态的流程推进
- `/api/health` 健康检查
- Vite 开发代理和前后端分离结构

## 启动

```bash
npm install
npm run dev
```

前端：`http://localhost:5174`；后端：`http://localhost:4001`。

## 扩展点

当前版本只实现基础功能和主流程，数据使用内存存储。后续可增加用户认证、角色权限、分页检索、附件上传、通知、审计日志、数据库 Repository、领域事件和更细粒度的状态校验。
