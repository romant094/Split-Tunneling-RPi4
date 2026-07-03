import { useState, useEffect } from 'react';
import { apiFetch } from '../api';

function KVEditor({ title, endpoint, note }) {
  const [vars, setVars] = useState({});
  const [edited, setEdited] = useState({});
  const [revealed, setRevealed] = useState({});
  const [msg, setMsg] = useState('');

  useEffect(() => {
    apiFetch(endpoint).then(r => r.json()).then(d => { setVars(d.vars || {}); setEdited({}); }).catch(() => {});
  }, [endpoint]);

  function handleChange(k, v) {
    setEdited(e => ({ ...e, [k]: v }));
  }

  async function save() {
    const changed = {};
    for (const k in edited) {
      if (edited[k] !== '***') changed[k] = edited[k];
    }
    const r = await apiFetch(endpoint, { method: 'PUT', body: JSON.stringify({ vars: changed }) });
    setMsg(r.ok ? 'Saved' : 'Error saving');
  }

  return (
    <div className="card section">
      <h3>{title}</h3>
      {Object.entries(vars).map(([k, v]) => {
        const isMasked = v === '***';
        const val = edited[k] !== undefined ? edited[k] : v;
        const isRevealed = revealed[k];
        return (
          <div key={k} className="key-value-row">
            <input className="key-input" value={k} readOnly />
            <input
              type={isMasked && !isRevealed ? 'password' : 'text'}
              value={val}
              onChange={e => handleChange(k, e.target.value)}
            />
            {isMasked && (
              <button className="btn-gray" style={{ fontSize: 11 }}
                onClick={() => setRevealed(r => ({ ...r, [k]: !r[k] }))}>
                {isRevealed ? 'Hide' : 'Show'}
              </button>
            )}
          </div>
        );
      })}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn-green" onClick={save}>Save</button>
        {msg && <span className={msg === 'Saved' ? 'msg-ok' : 'msg-err'}>{msg}</span>}
      </div>
      {note && <div style={{ color: '#888', fontSize: 12, marginTop: 8 }}>{note}</div>}
    </div>
  );
}

function PasswordChange() {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState('');

  async function change() {
    if (pw !== pw2) { setMsg('Passwords do not match'); return; }
    if (!pw) { setMsg('Password required'); return; }
    const r = await apiFetch('/api/settings/password', { method: 'POST', body: JSON.stringify({ password: pw }) });
    setMsg(r.ok ? 'Password changed' : 'Error');
    if (r.ok) { setPw(''); setPw2(''); }
  }

  return (
    <div className="card section">
      <h3>Admin Password</h3>
      <div className="row">
        <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="New password" style={{ maxWidth: 200 }} />
        <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Confirm" style={{ maxWidth: 200 }} />
        <button className="btn-green" onClick={change}>Change Password</button>
        {msg && <span className={msg === 'Password changed' ? 'msg-ok' : 'msg-err'}>{msg}</span>}
      </div>
    </div>
  );
}

function RollbackSection() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');

  async function doRollback() {
    const r = await apiFetch('/api/settings/rollback', { method: 'POST', body: JSON.stringify({ confirmation: 'ROLLBACK' }) });
    const d = await r.json();
    setMsg(r.ok ? d.message : `Error: ${d.error}`);
    setOpen(false);
  }

  return (
    <div className="card section">
      <h3 style={{ color: '#f44336' }}>Danger Zone</h3>
      <button className="btn-red" onClick={() => setOpen(true)}>Rollback VPN Gateway</button>
      {msg && <div className="msg-err" style={{ marginTop: 8 }}>{msg}</div>}
      {open && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Confirm Rollback</h3>
            <p>This will tear down the entire VPN gateway and is NOT reversible without re-running deploy.sh. The connection to this admin panel will drop.</p>
            <input type="text" value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder='Type ROLLBACK to confirm' />
            <div className="modal-buttons">
              <button className="btn-gray" onClick={() => { setOpen(false); setConfirm(''); }}>Cancel</button>
              <button className="btn-red" disabled={confirm !== 'ROLLBACK'} onClick={doRollback}>Confirm Rollback</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  return (
    <div>
      <h2>Settings</h2>
      <KVEditor title="Environment Variables (vpn-gateway.env)" endpoint="/api/settings/env" />
      <KVEditor title="AWG Secrets (awg0.conf)" endpoint="/api/settings/secrets"
        note="Changes take effect after restarting awg0 service" />
      <PasswordChange />
      <RollbackSection />
    </div>
  );
}
