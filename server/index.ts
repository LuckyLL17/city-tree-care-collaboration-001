import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqliteRepositories } from './sqlite-repository.js';
import { StorageError, resourceKeys, type Repositories, type ResourceKey } from './repository.js';

const PORT = Number(process.env.PORT || 4001);
const states = ['待派单', '待执行', '处理中', '已完成'];
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dbPath = process.env.DATABASE_PATH || join(root, 'data', 'tree-care.db');

// 启动时初始化 SQLite 持久层：建表、播种、写盘探测。
// 失败不静默降级为内存模式，而是进入故障状态，所有数据接口返回明确的服务错误。
let repos: Repositories | undefined;
let storageFailure: StorageError | undefined;
try {
  repos = await createSqliteRepositories(dbPath);
  console.log(`SQLite 数据库已就绪：${dbPath}`);
} catch (error) {
  storageFailure =
    error instanceof StorageError ? error : new StorageError(`数据库初始化失败：${String(error)}`);
  console.error(`数据库初始化失败，服务进入只读故障模式：${storageFailure.message}`);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

async function body(req: IncomingMessage) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function parts(url: string) {
  return new URL(url, 'http://localhost').pathname.split('/').filter(Boolean);
}

const server = createServer(async (req, res) => {
  try {
    const p = parts(req.url || '/');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
      return res.end();
    }
    if (req.method === 'GET' && p[0] === 'api' && p[1] === 'health') {
      if (storageFailure) {
        return json(res, 503, { status: 'error', project: 'city-tree-care-collaboration', error: storageFailure.message });
      }
      return json(res, 200, {
        status: 'ok',
        project: 'city-tree-care-collaboration',
        storage: 'sqlite',
        workflow: '建立树木档案 → 安排巡检 → 记录异常 → 派发养护 → 完成复核',
      });
    }
    if (p[0] !== 'api') {
      if (req.method === 'GET') {
        const html = await readFile(join(root, 'index.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }
      return json(res, 404, { error: 'Not found' });
    }
    const resource = p[1] as ResourceKey | undefined;
    if (!resource || !resourceKeys.includes(resource)) return json(res, 404, { error: '未知业务模块' });
    // 数据库不可用：明确返回服务错误，绝不静默丢数据
    if (!repos) return json(res, 503, { error: `数据库不可用：${storageFailure!.message}` });
    const repo = repos[resource];
    if (req.method === 'GET' && p.length === 2) return json(res, 200, repo.list());
    if (req.method === 'POST' && p.length === 2) return json(res, 201, repo.create(await body(req)));
    const item = repo.findById(p[2] ?? '');
    if (!item) return json(res, 404, { error: '记录不存在' });
    if (req.method === 'POST' && p[3] === 'transition') {
      const next = (await body(req)).status;
      if (!states.includes(next)) return json(res, 400, { error: '不支持的状态' });
      return json(res, 200, repo.update(item.id, { status: next }));
    }
    if (req.method === 'PATCH' && p.length === 3) return json(res, 200, repo.update(item.id, await body(req)));
    if (req.method === 'DELETE' && p.length === 3) {
      repo.remove(item.id);
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: '不支持的操作' });
  } catch (error) {
    if (error instanceof StorageError) return json(res, 503, { error: error.message });
    return json(res, 500, { error: error instanceof Error ? error.message : '服务器错误' });
  }
});

server.listen(PORT, () => console.log(`API server running at http://localhost:${PORT}`));
