import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDataStore } from './data/index.js';
import { STATUS_FLOW, isResourceKey } from './data/types.js';
import type { DataStore, Repository } from './data/repository.js';
import { DataInitError } from './data/sqlite-store.js';

const PORT = Number(process.env.PORT || 4001);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}

async function parseBody(req: IncomingMessage): Promise<Record<string, string>> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw Object.assign(new Error('请求体必须是 JSON 对象'), { statusCode: 400 });
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value !== undefined && value !== null) result[key] = String(value);
  }
  return result;
}

function parts(url: string): string[] {
  return new URL(url, 'http://localhost').pathname.split('/').filter(Boolean);
}

function createRequestHandler(store: DataStore) {
  const repo = (key: string): Repository | undefined =>
    isResourceKey(key) ? store.repository(key) : undefined;

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const p = parts(req.url || '/');

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        return res.end();
      }

      if (req.method === 'GET' && p[0] === 'api' && p[1] === 'health') {
        return json(res, 200, {
          status: 'ok',
          project: 'city-tree-care-collaboration',
          workflow: '建立树木档案 → 安排巡检 → 记录异常 → 派发养护 → 完成复核',
          storage: { kind: store.kind, location: store.location },
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

      const resource = p[1];
      const repository = repo(resource);
      if (!repository) return json(res, 404, { error: '未知业务模块' });

      // GET /api/:resource
      if (req.method === 'GET' && p.length === 2) {
        return json(res, 200, repository.list());
      }

      // POST /api/:resource
      if (req.method === 'POST' && p.length === 2) {
        const item = repository.create(await parseBody(req));
        return json(res, 201, item);
      }

      const item = repository.findById(p[2]);
      if (!item) return json(res, 404, { error: '记录不存在' });

      // POST /api/:resource/:id/transition
      if (req.method === 'POST' && p[3] === 'transition') {
        const next = (await parseBody(req)).status;
        if (!STATUS_FLOW.includes(next as (typeof STATUS_FLOW)[number])) {
          return json(res, 400, { error: '不支持的状态' });
        }
        const updated = repository.update(item.id, { status: next });
        return json(res, 200, updated);
      }

      // PATCH /api/:resource/:id
      if (req.method === 'PATCH' && p.length === 3) {
        const updated = repository.update(item.id, await parseBody(req));
        return json(res, 200, updated);
      }

      // DELETE /api/:resource/:id
      if (req.method === 'DELETE' && p.length === 3) {
        repository.delete(item.id);
        return json(res, 200, { ok: true });
      }

      return json(res, 405, { error: '不支持的操作' });
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode ?? 500;
      const message = error instanceof Error ? error.message : '服务器错误';
      return json(res, status, { error: message });
    }
  };
}

async function main(): Promise<void> {
  let store: DataStore;
  try {
    store = await createDataStore();
  } catch (error) {
    // 初始化失败属于致命错误：明确退出，绝不静默回退到内存数据。
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[fatal] 数据层初始化失败，服务终止：${detail}`);
    if (error instanceof DataInitError && error.cause instanceof Error) {
      console.error(`[fatal] 原因：${error.cause.message}`);
    }
    process.exit(1);
  }

  const server = createServer(createRequestHandler(store));

  const shutdown = () => {
    server.close(() => {
      try {
        store.close();
      } finally {
        process.exit(0);
      }
    });
    // 强制兜底：连接未及时结束也不阻塞退出。
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.listen(PORT, () => {
    console.log(`API server running at http://localhost:${PORT}`);
    console.log(`storage: ${store.kind} (${store.location})`);
  });
}

main().catch((error: unknown) => {
  console.error('[fatal] 服务启动失败：', error);
  process.exit(1);
});
