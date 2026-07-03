import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../api';

function LogContainer({ lines, colorize }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  return (
    <div className="log-container" ref={ref}>
      {lines.map((line, i) => {
        let cls = '';
        if (colorize) {
          if (line.includes('[VPN]')) cls = 'log-line-vpn';
          else if (line.includes('[ISP]')) cls = 'log-line-isp';
        }
        return <div key={i} className={cls}>{line}</div>;
      })}
    </div>
  );
}

function WatchLive() {
  const [lines, setLines] = useState([]);
  const [filter, setFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('both');
  const esRef = useRef(null);

  useEffect(() => {
    const es = new EventSource('/api/logs/watch', { withCredentials: true });
    esRef.current = es;
    es.onmessage = e => {
      setLines(prev => [...prev, e.data].slice(-1000));
    };
    return () => es.close();
  }, []);

  const visible = lines.filter(l => {
    if (filter && !l.includes(filter)) return false;
    if (tagFilter === 'vpn' && !l.includes('[VPN]')) return false;
    if (tagFilter === 'isp' && !l.includes('[ISP]')) return false;
    return true;
  });

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input type="text" value={filter} onChange={e => setFilter(e.target.value)}
          placeholder="Filter..." style={{ maxWidth: 200 }} />
        {['both', 'vpn', 'isp'].map(t => (
          <button key={t} className={tagFilter === t ? 'btn-blue' : 'btn-gray'}
            style={{ textTransform: 'uppercase', fontSize: 12 }}
            onClick={() => setTagFilter(t)}>{t}</button>
        ))}
        <button className="btn-gray" onClick={() => setLines([])}>Clear</button>
      </div>
      <LogContainer lines={visible} colorize />
    </div>
  );
}

function StaticLog({ endpoint }) {
  const [lines, setLines] = useState([]);
  function load() {
    apiFetch(endpoint).then(r => r.json()).then(d => setLines(d.lines || [])).catch(() => {});
  }
  useEffect(() => { load(); }, [endpoint]);
  return (
    <div>
      <button className="btn-gray" style={{ marginBottom: 12 }} onClick={load}>Refresh</button>
      <LogContainer lines={lines} colorize={false} />
    </div>
  );
}

const TABS = [
  { id: 'live', label: 'Watch Live' },
  { id: 'install', label: 'Install Log' },
  { id: 'errors', label: 'Watch Errors' },
  { id: 'journal', label: 'System Journal' },
];

export default function Logs() {
  const [tab, setTab] = useState('live');

  return (
    <div>
      <h2>Logs</h2>
      <div className="tabs">
        {TABS.map(t => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'live' && <WatchLive />}
      {tab === 'install' && <StaticLog endpoint="/api/logs/install" />}
      {tab === 'errors' && <StaticLog endpoint="/api/logs/watch-errors" />}
      {tab === 'journal' && <StaticLog endpoint="/api/logs/journal" />}
    </div>
  );
}
