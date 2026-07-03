import { useState, useEffect } from 'react';
import { apiFetch } from '../api';

export default function Services() {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState({});
  const [msg, setMsg] = useState('');

  function load() {
    apiFetch('/api/services').then(r => r.json()).then(setServices).catch(() => {});
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  async function action(name, act) {
    setLoading(l => ({ ...l, [name]: act }));
    setMsg('');
    const r = await apiFetch(`/api/services/${name}/${act}`, { method: 'POST' });
    if (!r.ok) {
      const d = await r.json();
      setMsg(`Error: ${d.error}`);
    }
    setLoading(l => ({ ...l, [name]: null }));
    load();
  }

  function badgeClass(status) {
    if (status === 'active') return 'badge badge-green';
    if (status === 'failed') return 'badge badge-red';
    if (status === 'inactive') return 'badge badge-gray';
    return 'badge badge-yellow';
  }

  return (
    <div>
      <h2>Services</h2>
      {msg && <div className="msg-err" style={{ marginBottom: 12 }}>{msg}</div>}
      <table>
        <thead><tr><th>Service</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {services.map(svc => {
            const busy = loading[svc.name];
            const isActive = svc.status === 'active';
            const isInactive = svc.status === 'inactive' || svc.status === 'unknown';
            return (
              <tr key={svc.name}>
                <td>{svc.name}</td>
                <td><span className={badgeClass(svc.status)}>{busy || svc.status}</span></td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="btn-green" disabled={isActive || !!busy} onClick={() => action(svc.name, 'start')}>Start</button>
                  <button className="btn-red" disabled={isInactive || !!busy} onClick={() => action(svc.name, 'stop')}>Stop</button>
                  <button className="btn-gray" disabled={isInactive || !!busy} onClick={() => action(svc.name, 'restart')}>Restart</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
