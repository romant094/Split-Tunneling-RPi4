import { useState, useEffect } from 'react';
import { apiFetch } from '../api';

const CIDR_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/;

function RouteSection({ title, endpoint }) {
  const [routes, setRoutes] = useState([]);
  const [input, setInput] = useState('');
  const [msg, setMsg] = useState('');

  function load() {
    apiFetch(`/api/routes/${endpoint}`).then(r => r.json()).then(d => setRoutes(d.routes || [])).catch(() => {});
  }

  useEffect(() => { load(); }, [endpoint]);

  async function addRoute() {
    const cidr = input.trim();
    if (!CIDR_RE.test(cidr)) { setMsg('Invalid CIDR'); return; }
    setMsg('');
    const r = await apiFetch(`/api/routes/${endpoint}`, { method: 'POST', body: JSON.stringify({ cidr }) });
    const d = await r.json();
    if (!r.ok) { setMsg(d.error); return; }
    setInput('');
    load();
  }

  async function removeRoute(cidr) {
    await apiFetch(`/api/routes/${endpoint}`, { method: 'DELETE', body: JSON.stringify({ cidr }) });
    load();
  }

  return (
    <div className="card section">
      <h3>{title}</h3>
      <div className="row">
        <input type="text" value={input} onChange={e => setInput(e.target.value)}
          placeholder="x.x.x.x/n" style={{ maxWidth: 200 }}
          onKeyDown={e => e.key === 'Enter' && addRoute()} />
        <button className="btn-green" onClick={addRoute}>Add</button>
        {msg && <span className="msg-err">{msg}</span>}
      </div>
      {routes.length === 0 ? <div style={{ color: '#666', fontSize: 13 }}>No routes</div> : (
        <table>
          <thead><tr><th>CIDR</th><th>Action</th></tr></thead>
          <tbody>
            {routes.map(cidr => (
              <tr key={cidr}>
                <td style={{ fontFamily: 'monospace' }}>{cidr}</td>
                <td><button className="btn-red" onClick={() => removeRoute(cidr)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function RoutesPage() {
  const [applyMsg, setApplyMsg] = useState('');
  const [applying, setApplying] = useState(false);

  async function applyRoutes() {
    setApplying(true);
    setApplyMsg('Applying...');
    const r = await apiFetch('/api/config/apply', { method: 'POST' });
    const d = await r.json();
    setApplyMsg(r.ok ? 'Applied OK' : `Error: ${d.error}`);
    setApplying(false);
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Routes</h2>
        <button className="btn-blue" onClick={applyRoutes} disabled={applying}>Apply Changes</button>
        {applyMsg && <span className={applyMsg.startsWith('Error') ? 'msg-err' : 'msg-ok'}>{applyMsg}</span>}
      </div>
      <RouteSection title="VPN Force-Routes (vpn-routes-custom.txt)" endpoint="vpn" />
      <RouteSection title="ISP Exception Routes (isp-routes-custom.txt)" endpoint="isp" />
    </div>
  );
}
