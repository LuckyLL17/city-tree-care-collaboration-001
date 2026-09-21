import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.PORT ?? 3002);
type CareRequest = { id: string; tree: string; neighborhood: string; need: 'Watering' | 'Mulching' | 'Pruning' | 'Inspection'; urgency: 'Routine' | 'Soon' | 'Urgent'; notes: string; status: 'open' | 'claimed'; volunteer?: string };
const requests: CareRequest[] = [
  { id: 'tree-1', tree: 'Old oak by the library', neighborhood: 'Riverside', need: 'Watering', urgency: 'Urgent', notes: 'Leaves are curling after a dry week.', status: 'open' },
  { id: 'tree-2', tree: 'Row of young maples on 4th', neighborhood: 'North Market', need: 'Mulching', urgency: 'Soon', notes: 'Fresh mulch would help retain moisture.', status: 'open' },
  { id: 'tree-3', tree: 'Linden outside the co-op', neighborhood: 'East Commons', need: 'Inspection', urgency: 'Routine', notes: 'One low branch looks stressed.', status: 'claimed', volunteer: 'Samira' },
  { id: 'tree-4', tree: 'Pocket park plum tree', neighborhood: 'Hillview', need: 'Pruning', urgency: 'Routine', notes: 'Coordinate after the next community picnic.', status: 'claimed', volunteer: 'Leo' },
];
function send(response: ServerResponse, status: number, payload: unknown) { response.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); response.end(JSON.stringify(payload)); }
function body(request: IncomingMessage): Promise<Record<string, string>> { return new Promise((resolve, reject) => { let raw = ''; request.on('data', (chunk) => raw += chunk); request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); } }); request.on('error', reject); }); }
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (request.method === 'OPTIONS') { response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }); return response.end(); }
  if (request.method === 'GET' && url.pathname === '/api/health') return send(response, 200, { ok: true, service: 'city-tree-care-api' });
  if (request.method === 'GET' && url.pathname === '/api/requests') return send(response, 200, requests);
  if (request.method === 'POST' && url.pathname === '/api/requests') { const input = await body(request); const item: CareRequest = { id: randomUUID(), tree: input.tree?.trim() || 'Unnamed tree', neighborhood: input.neighborhood || 'Unassigned', need: (input.need as CareRequest['need']) || 'Inspection', urgency: (input.urgency as CareRequest['urgency']) || 'Routine', notes: input.notes?.trim() || '', status: 'open' }; requests.unshift(item); return send(response, 201, item); }
  const claimMatch = url.pathname.match(/^\/api\/requests\/([^/]+)\/claim$/);
  if (request.method === 'POST' && claimMatch) { const item = requests.find((entry) => entry.id === claimMatch[1]); if (!item) return send(response, 404, { error: 'Care request not found' }); if (item.status === 'claimed') return send(response, 409, { error: 'Care request is already claimed' }); const input = await body(request); item.status = 'claimed'; item.volunteer = input.volunteer || 'Community volunteer'; return send(response, 200, item); }
  return send(response, 404, { error: 'Route not found' });
});
server.listen(port, () => console.log(`City tree care API listening on http://localhost:${port}`));
