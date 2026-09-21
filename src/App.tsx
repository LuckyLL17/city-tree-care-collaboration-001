import { FormEvent, useEffect, useMemo, useState } from 'react';

type CareRequest = {
  id: string;
  tree: string;
  neighborhood: string;
  need: 'Watering' | 'Mulching' | 'Pruning' | 'Inspection';
  urgency: 'Routine' | 'Soon' | 'Urgent';
  notes: string;
  status: 'open' | 'claimed';
  volunteer?: string;
};

type NewRequest = Pick<CareRequest, 'tree' | 'neighborhood' | 'need' | 'urgency' | 'notes'>;
const initialForm: NewRequest = { tree: '', neighborhood: 'Riverside', need: 'Watering', urgency: 'Routine', notes: '' };

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export default function App() {
  const [requests, setRequests] = useState<CareRequest[]>([]);
  const [form, setForm] = useState(initialForm);
  const [view, setView] = useState<'all' | 'open'>('all');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const loadRequests = () => request<CareRequest[]>('/api/requests').then(setRequests).finally(() => setLoading(false));
  useEffect(() => { void loadRequests(); }, []);
  const openCount = requests.filter((item) => item.status === 'open').length;
  const claimedCount = requests.length - openCount;
  const urgentCount = requests.filter((item) => item.urgency === 'Urgent' && item.status === 'open').length;
  const visibleRequests = useMemo(() => view === 'open' ? requests.filter((item) => item.status === 'open') : requests, [requests, view]);

  async function submitRequest(event: FormEvent) {
    event.preventDefault();
    if (!form.tree.trim()) return;
    await request<CareRequest>('/api/requests', { method: 'POST', body: JSON.stringify(form) });
    setForm(initialForm); setNotice('Care request posted for the neighborhood.'); await loadRequests();
  }

  async function claim(id: string) {
    await request<CareRequest>(`/api/requests/${id}/claim`, { method: 'POST', body: JSON.stringify({ volunteer: 'You' }) });
    setNotice('Thanks for stepping up. The request is now on your care list.'); await loadRequests();
  }

  return (
    <main className="page-shell">
      <header className="topbar"><div className="brand"><span className="brand-symbol">✦</span><span>CANOPY<br /><b>COMMONS</b></span></div><span className="season">SPRING / SUMMER FIELD BOARD</span></header>
      <section className="intro"><div><p className="eyebrow">CITY TREE CARE COLLABORATION</p><h1>Small acts.<br /><em>Long shade.</em></h1></div><p className="intro-copy">A shared field board for noticing, coordinating, and caring for the trees that make our neighborhoods livable.</p></section>

      <section className="overview"><div><span>Open care loops</span><strong>{openCount}</strong><small>Neighbors waiting for a hand</small></div><div><span>In good hands</span><strong>{claimedCount}</strong><small>Requests claimed by volunteers</small></div><div><span>Needs attention</span><strong className="red">{urgentCount}</strong><small>Open requests marked urgent</small></div><div className="quote">“The city is not just what we build.<br />It is what we tend.”</div></section>

      <div className="layout"><section className="board"><div className="section-title"><div><p className="kicker">THE FIELD BOARD</p><h2>Care requests</h2></div><div className="tabs"><button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>All activity</button><button className={view === 'open' ? 'active' : ''} onClick={() => setView('open')}>Needs a volunteer</button></div></div>{notice && <div className="notice">{notice}</div>}
        {loading ? <p className="empty">Reading the field notes…</p> : <div className="request-list">{visibleRequests.map((item) => <article className="request-card" key={item.id}><div className="tree-glyph">{item.need === 'Watering' ? '◒' : item.need === 'Mulching' ? '⌁' : item.need === 'Pruning' ? '✣' : '⌖'}</div><div className="request-main"><div className="request-heading"><h3>{item.tree}</h3><span className={`urgency ${item.urgency.toLowerCase()}`}>{item.urgency}</span></div><p>{item.neighborhood} <span>·</span> {item.need}</p>{item.notes && <small>{item.notes}</small>}{item.volunteer && <div className="claimed">✓ Claimed by {item.volunteer}</div>}</div>{item.status === 'open' ? <button className="claim-button" onClick={() => void claim(item.id)}>I can help <span>→</span></button> : <span className="done-label">in motion</span>}</article>)}</div>}
      </section>

      <aside className="request-panel"><p className="kicker">NOTICE SOMETHING?</p><h2>Start a care loop</h2><p className="muted">Add a tree or task that could use a little collective attention.</p><form onSubmit={submitRequest}><label>Tree or location<input value={form.tree} onChange={(event) => setForm({ ...form, tree: event.target.value })} placeholder="e.g. Old oak by the library" /></label><label>Neighborhood<select value={form.neighborhood} onChange={(event) => setForm({ ...form, neighborhood: event.target.value })}><option>Riverside</option><option>North Market</option><option>Hillview</option><option>East Commons</option></select></label><div className="two-fields"><label>Need<select value={form.need} onChange={(event) => setForm({ ...form, need: event.target.value as NewRequest['need'] })}><option>Watering</option><option>Mulching</option><option>Pruning</option><option>Inspection</option></select></label><label>Urgency<select value={form.urgency} onChange={(event) => setForm({ ...form, urgency: event.target.value as NewRequest['urgency'] })}><option>Routine</option><option>Soon</option><option>Urgent</option></select></label></div><label>Field notes<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="What did you notice?" rows={3} /></label><button className="primary-button" type="submit">Post to the board <span>↗</span></button></form><div className="extension-note"><strong>Future branch</strong><span>Invite city arborists, map tree health, and coordinate recurring care days.</span></div></aside></div>
      <footer><span>CANOPY COMMONS</span> · Community-powered stewardship · In-memory demo data</footer>
    </main>
  );
}
