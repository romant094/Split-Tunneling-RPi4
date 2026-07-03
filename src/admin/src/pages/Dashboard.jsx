import { useState, useEffect } from 'react';
import { apiFetch } from '../api';

export default function Dashboard() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    function load() {
      apiFetch('/api/status').then(r => r.json()).then(setStatus).catch(() => {});
    }
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  if (!status) return <div>Loading...</div>;

  return (
    <div>
      <h2>Dashboard</h2>
      <div className="card-grid">
        <div className="stat-card">
          <div className="stat-label">VPN Tunnel</div>
          <span className={`badge ${status.tunnel_up ? 'badge-green' : 'badge-red'}`}>
            {status.tunnel_up ? 'UP' : 'DOWN'}
          </span>
        </div>
        <div className="stat-card">
          <div className="stat-label">Watch Daemon</div>
          <span className={`badge ${status.daemon_up ? 'badge-green' : 'badge-red'}`}>
            {status.daemon_up ? 'running' : 'stopped'}
          </span>
        </div>
        <div className="stat-card">
          <div className="stat-label">RU List Updated</div>
          <div className="stat-value" style={{ fontSize: '14px' }}>{status.ru_list_updated || 'unknown'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">VPN Routes</div>
          <div className="stat-value">{status.vpn_route_count}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">ISP Routes</div>
          <div className="stat-value">{status.isp_route_count}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">RU Routes</div>
          <div className="stat-value">{status.ru_route_count}</div>
        </div>
      </div>
    </div>
  );
}
