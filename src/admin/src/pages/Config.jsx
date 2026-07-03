import { useState, useEffect } from 'react';
import { apiFetch } from '../api';

export default function Config() {
  const [content, setContent] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [updateMsg, setUpdateMsg] = useState('');
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    apiFetch('/api/config/exclude').then(r => r.json()).then(d => setContent(d.content || '')).catch(() => {});
  }, []);

  async function save() {
    const r = await apiFetch('/api/config/exclude', { method: 'PUT', body: JSON.stringify({ content }) });
    setSaveMsg(r.ok ? 'Saved' : 'Error saving');
  }

  async function refreshRUList() {
    setUpdating(true);
    setUpdateMsg('Updating...');
    const r = await apiFetch('/api/config/update', { method: 'POST' });
    const d = await r.json();
    setUpdateMsg(r.ok ? `Done: ${d.output || 'OK'}` : `Error: ${d.error}`);
    setUpdating(false);
  }

  return (
    <div>
      <h2>Config</h2>
      <div className="card">
        <h3>ru-list-exclude.txt — one CIDR per line to exclude from RU routes</h3>
        <textarea rows={12} value={content} onChange={e => setContent(e.target.value)} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn-green" onClick={save}>Save</button>
          {saveMsg && <span className={saveMsg === 'Saved' ? 'msg-ok' : 'msg-err'}>{saveMsg}</span>}
        </div>
      </div>
      <div className="card">
        <h3>RU List</h3>
        <div className="row">
          <button className="btn-blue" onClick={refreshRUList} disabled={updating}>Refresh RU List</button>
          {updateMsg && <span className={updateMsg.startsWith('Error') ? 'msg-err' : 'msg-ok'} style={{ fontSize: 12 }}>{updateMsg}</span>}
        </div>
      </div>
    </div>
  );
}
