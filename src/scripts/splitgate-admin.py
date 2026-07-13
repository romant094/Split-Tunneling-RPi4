#!/usr/bin/env python3
"""
splitgate-admin — Flask admin backend for the splitgate web admin interface.
Decisions: D-08 single-file Flask, D-09 Basic Auth via /etc/splitgate/admin.secret,
           D-10 ADMIN_PORT, D-11 root
"""

import os, re, hmac, time, json, secrets, subprocess, functools, threading
from datetime import date, datetime, timedelta
from collections import deque
from flask import Flask, request, jsonify, send_from_directory, Response, stream_with_context, make_response

ADMIN_SECRET_PATH = '/etc/splitgate/admin.secret'
ADMIN_DIST_DIR = '/etc/splitgate/admin'
ADMIN_PORT = int(os.environ.get('ADMIN_PORT', 8080))
VPN_CUSTOM_ROUTES = '/etc/splitgate/vpn-routes-custom.txt'
ISP_CUSTOM_ROUTES = '/etc/splitgate/isp-routes-custom.txt'
RU_EXCLUDE_PATH = '/etc/splitgate/ru-list-exclude.txt'
ENV_PATH = '/etc/splitgate/vpn-gateway.env'
AWG_CONF_PATH = '/etc/amnezia/amneziawg/awg0.conf'
LOG_DIR = '/etc/splitgate/logs'
ROUTING_SH = '/etc/splitgate/routing.sh'
UPDATE_ROUTES = '/etc/splitgate/update-vpn-routes'
ROLLBACK_SH = '/etc/splitgate/vpn-rollback.sh'
SERVICE_UNIT_MAP = {
    'awg0': 'awg-quick@awg0',
    'splitgate-watch': 'splitgate-watch.service',
    'splitgate-admin': 'splitgate-admin.service',
    'networking': 'networking.service',
    'dnsmasq': 'dnsmasq.service',
}
MANAGED_SERVICES = ['awg0', 'splitgate-watch', 'splitgate-admin', 'networking', 'dnsmasq']
CIDR_RE = re.compile(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/\d{1,2}$')
SECRET_KEY_RE = re.compile(r'(KEY|SECRET|PASS|TOKEN|PRIVATE)', re.IGNORECASE)

app = Flask(__name__)
_sessions = set()  # in-memory session tokens; resets on service restart


def require_auth(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        cookie_token = request.cookies.get('sg_session')
        if cookie_token and cookie_token in _sessions:
            return f(*args, **kwargs)
        try:
            with open(ADMIN_SECRET_PATH) as fh:
                stored_pw = fh.read().strip()
        except FileNotFoundError:
            return Response('Unauthorized', 401)
        auth = request.authorization
        if not auth:
            return Response('Unauthorized', 401)
        if not secrets.compare_digest(auth.password.encode(), stored_pw.encode()):
            return Response('Unauthorized', 401)
        session_token = secrets.token_hex(16)
        _sessions.add(session_token)
        inner_result = f(*args, **kwargs)
        resp = make_response(inner_result)
        # 30-day Max-Age so the cookie survives browser restarts (D-01: Phase 15 D-09
        # cookie had no expiry, forcing re-auth on every new tab/restart).
        resp.set_cookie('sg_session', session_token, httponly=True, samesite='Strict',
                         path='/', max_age=60*60*24*30)
        return resp
    return decorated


@app.route('/api/auth/check')
def api_auth_check():
    # _sessions is in-memory and resets on service restart (Pitfall 5) — this endpoint
    # reports current validity only, not a guarantee of persistence across restarts.
    # Intentionally does NOT use @require_auth: must not trigger a Basic Auth challenge.
    token = request.cookies.get('sg_session')
    if token and token in _sessions:
        return jsonify({'authenticated': True})
    return jsonify({'authenticated': False}), 401


def strip_env_quotes(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in ('"', "'"):
        return v[1:-1]
    return v

def read_routes_file(path):
    """Return list of CIDRs only (handles both inline and leading-comment formats)."""
    result = []
    try:
        with open(path) as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if '#' in line:
                    line = line.split('#', 1)[0].strip()
                if line:
                    result.append(line)
    except FileNotFoundError:
        pass
    return result

def read_routes_with_desc(path):
    """Return list of {cidr, description} dicts. Handles inline and leading-comment formats."""
    result = []
    pending_comment = ''
    try:
        with open(path) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    pending_comment = ''
                    continue
                if line.startswith('#'):
                    comment = line.lstrip('#').strip()
                    pending_comment = (pending_comment + ' ' + comment).strip() if pending_comment else comment
                    continue
                if '#' in line:
                    cidr_part, desc_part = line.split('#', 1)
                    cidr = cidr_part.strip()
                    desc = desc_part.strip() or pending_comment
                else:
                    cidr = line
                    desc = pending_comment
                if CIDR_RE.match(cidr):
                    result.append({'cidr': cidr, 'description': desc})
                pending_comment = ''
    except FileNotFoundError:
        pass
    return result

def write_routes_with_desc(path, entries):
    """Write routes in inline format: cidr # description (or just cidr if no description)."""
    with open(path, 'w') as fh:
        for e in entries:
            desc = e.get('description', '').strip()
            if desc:
                fh.write(f"{e['cidr']} # {desc}\n")
            else:
                fh.write(f"{e['cidr']}\n")

def parse_env_file(path):
    result = {}
    try:
        with open(path) as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if '=' in line:
                    k, v = line.split('=', 1)
                    result[k.strip()] = strip_env_quotes(v)
    except FileNotFoundError:
        pass
    return result

def write_env_file(path, data):
    with open(path, 'w') as fh:
        for k, v in data.items():
            fh.write(f'{k}={v}\n')

def mask_value(key, value):
    if SECRET_KEY_RE.search(key):
        return '***'
    return value

def tail_file(path, n=200):
    try:
        with open(path) as fh:
            return [line.rstrip() for line in deque(fh, maxlen=n)]
    except FileNotFoundError:
        return []


@app.route('/api/status')
@require_auth
def api_status():
    return jsonify(_collect_status())

def _collect_status():
    svc_statuses = {}
    for name in MANAGED_SERVICES:
        unit = SERVICE_UNIT_MAP[name]
        r = subprocess.run(['systemctl', 'is-active', unit], capture_output=True, text=True, timeout=5)
        svc_statuses[name] = r.stdout.strip() or 'unknown'
    services = [{'name': n, 'status': s} for n, s in svc_statuses.items()]
    try:
        mtime = os.path.getmtime('/etc/splitgate/white-list.txt')
        ru_list_updated = datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M')
    except FileNotFoundError:
        ru_list_updated = None
    r3 = subprocess.run(['ip', 'route', 'show', 'dev', 'awg0'], capture_output=True, text=True, timeout=5)
    vpn_route_count = len([l for l in r3.stdout.splitlines() if l.strip()])
    vpn_custom_count = len(read_routes_file(VPN_CUSTOM_ROUTES))
    isp_route_count = len(read_routes_file(ISP_CUSTOM_ROUTES))
    try:
        with open('/etc/splitgate/white-list.txt') as fh:
            ru_route_count = sum(1 for l in fh if l.strip() and not l.startswith('#'))
    except FileNotFoundError:
        ru_route_count = 0
    return {
        'tunnel_up': svc_statuses.get('awg0') == 'active',
        'daemon_up': svc_statuses.get('splitgate-watch') == 'active',
        'ru_list_updated': ru_list_updated,
        'vpn_route_count': vpn_route_count, 'vpn_custom_count': vpn_custom_count,
        'isp_route_count': isp_route_count, 'ru_route_count': ru_route_count,
        'services': services,
    }

def _collect_services():
    result = []
    for name in MANAGED_SERVICES:
        unit = SERVICE_UNIT_MAP[name]
        r = subprocess.run(['systemctl', 'is-active', unit], capture_output=True, text=True, timeout=5)
        result.append({'name': name, 'status': r.stdout.strip() or 'unknown'})
    return result

@app.route('/api/status/watch')
@require_auth
def api_status_watch():
    def generate():
        while True:
            try:
                yield f'data: {json.dumps(_collect_status())}\n\n'
            except Exception as e:
                yield f'data: {json.dumps({"error": str(e)})}\n\n'
            time.sleep(10)
    return Response(stream_with_context(generate()), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

@app.route('/api/services/watch')
@require_auth
def api_services_watch():
    def generate():
        while True:
            try:
                yield f'data: {json.dumps(_collect_services())}\n\n'
            except Exception as e:
                yield f'data: {json.dumps({"error": str(e)})}\n\n'
            time.sleep(5)
    return Response(stream_with_context(generate()), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

@app.route('/api/services')
@require_auth
def api_services():
    return jsonify(_collect_services())

@app.route('/api/services/<name>/<action>', methods=['POST'])
@require_auth
def api_service_action(name, action):
    if name not in MANAGED_SERVICES:
        return jsonify({'error': 'Unknown service'}), 400
    if action not in ('start', 'stop', 'restart'):
        return jsonify({'error': 'Unknown action'}), 400
    unit = SERVICE_UNIT_MAP[name]
    r = subprocess.run(['systemctl', action, unit], capture_output=True, text=True, timeout=30)
    if r.returncode == 0:
        return jsonify({'ok': True})
    return jsonify({'error': r.stderr.strip()}), 500

@app.route('/api/services/bulk/<action>', methods=['POST'])
@require_auth
def api_services_bulk(action):
    if action not in ('start', 'stop', 'restart'):
        return jsonify({'error': 'Unknown action'}), 400
    targets = [n for n in MANAGED_SERVICES if n != 'splitgate-admin']
    errors = []
    for name in targets:
        unit = SERVICE_UNIT_MAP[name]
        r = subprocess.run(['systemctl', action, unit], capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            errors.append(f'{name}: {r.stderr.strip()}')
    if errors:
        return jsonify({'ok': False, 'errors': errors}), 500
    return jsonify({'ok': True})

# ── Routes: VPN ──────────────────────────────────────────────────────────────

@app.route('/api/routes/vpn')
@require_auth
def api_routes_vpn_get():
    return jsonify({'routes': read_routes_with_desc(VPN_CUSTOM_ROUTES)})

@app.route('/api/routes/vpn', methods=['POST'])
@require_auth
def api_routes_vpn_post():
    body = request.get_json(silent=True) or {}
    cidr = body.get('cidr', '').strip()
    description = body.get('description', '').strip()
    if not CIDR_RE.match(cidr):
        return jsonify({'error': 'Invalid CIDR'}), 400
    entries = read_routes_with_desc(VPN_CUSTOM_ROUTES)
    if any(e['cidr'] == cidr for e in entries):
        return jsonify({'error': 'Already exists'}), 409
    entries.append({'cidr': cidr, 'description': description})
    write_routes_with_desc(VPN_CUSTOM_ROUTES, entries)
    return jsonify({'ok': True}), 201

@app.route('/api/routes/vpn', methods=['PUT'])
@require_auth
def api_routes_vpn_put():
    body = request.get_json(silent=True) or {}
    old_cidr = body.get('old_cidr', '').strip()
    new_cidr = body.get('cidr', '').strip()
    description = body.get('description', '').strip()
    if not CIDR_RE.match(old_cidr) or not CIDR_RE.match(new_cidr):
        return jsonify({'error': 'Invalid CIDR'}), 400
    entries = read_routes_with_desc(VPN_CUSTOM_ROUTES)
    if not any(e['cidr'] == old_cidr for e in entries):
        return jsonify({'error': 'Route not found'}), 404
    if new_cidr != old_cidr and any(e['cidr'] == new_cidr for e in entries):
        return jsonify({'error': 'Already exists'}), 409
    entries = [{'cidr': new_cidr, 'description': description} if e['cidr'] == old_cidr else e for e in entries]
    write_routes_with_desc(VPN_CUSTOM_ROUTES, entries)
    return jsonify({'ok': True})

@app.route('/api/routes/vpn', methods=['DELETE'])
@require_auth
def api_routes_vpn_delete():
    body = request.get_json(silent=True) or {}
    cidr = body.get('cidr', '').strip()
    if not CIDR_RE.match(cidr):
        return jsonify({'error': 'Invalid CIDR'}), 400
    entries = read_routes_with_desc(VPN_CUSTOM_ROUTES)
    write_routes_with_desc(VPN_CUSTOM_ROUTES, [e for e in entries if e['cidr'] != cidr])
    return jsonify({'ok': True})

@app.route('/api/routes/vpn/bulk', methods=['POST'])
@require_auth
def api_routes_vpn_bulk():
    body = request.get_json(silent=True) or {}
    new_entries = body.get('entries', [])
    if not isinstance(new_entries, list):
        return jsonify({'error': 'entries must be a list'}), 400
    existing = read_routes_with_desc(VPN_CUSTOM_ROUTES)
    existing_cidrs = {e['cidr'] for e in existing}
    added = 0
    for entry in new_entries:
        cidr = entry.get('cidr', '').strip()
        if not CIDR_RE.match(cidr) or cidr in existing_cidrs:
            continue
        existing.append({'cidr': cidr, 'description': entry.get('description', '').strip()})
        existing_cidrs.add(cidr)
        added += 1
    write_routes_with_desc(VPN_CUSTOM_ROUTES, existing)
    return jsonify({'ok': True, 'added': added})

# ── Routes: ISP ──────────────────────────────────────────────────────────────

@app.route('/api/routes/isp')
@require_auth
def api_routes_isp_get():
    return jsonify({'routes': read_routes_with_desc(ISP_CUSTOM_ROUTES)})

@app.route('/api/routes/isp', methods=['POST'])
@require_auth
def api_routes_isp_post():
    body = request.get_json(silent=True) or {}
    cidr = body.get('cidr', '').strip()
    description = body.get('description', '').strip()
    if not CIDR_RE.match(cidr):
        return jsonify({'error': 'Invalid CIDR'}), 400
    entries = read_routes_with_desc(ISP_CUSTOM_ROUTES)
    if any(e['cidr'] == cidr for e in entries):
        return jsonify({'error': 'Already exists'}), 409
    entries.append({'cidr': cidr, 'description': description})
    write_routes_with_desc(ISP_CUSTOM_ROUTES, entries)
    return jsonify({'ok': True}), 201

@app.route('/api/routes/isp', methods=['PUT'])
@require_auth
def api_routes_isp_put():
    body = request.get_json(silent=True) or {}
    old_cidr = body.get('old_cidr', '').strip()
    new_cidr = body.get('cidr', '').strip()
    description = body.get('description', '').strip()
    if not CIDR_RE.match(old_cidr) or not CIDR_RE.match(new_cidr):
        return jsonify({'error': 'Invalid CIDR'}), 400
    entries = read_routes_with_desc(ISP_CUSTOM_ROUTES)
    if not any(e['cidr'] == old_cidr for e in entries):
        return jsonify({'error': 'Route not found'}), 404
    if new_cidr != old_cidr and any(e['cidr'] == new_cidr for e in entries):
        return jsonify({'error': 'Already exists'}), 409
    entries = [{'cidr': new_cidr, 'description': description} if e['cidr'] == old_cidr else e for e in entries]
    write_routes_with_desc(ISP_CUSTOM_ROUTES, entries)
    return jsonify({'ok': True})

@app.route('/api/routes/isp', methods=['DELETE'])
@require_auth
def api_routes_isp_delete():
    body = request.get_json(silent=True) or {}
    cidr = body.get('cidr', '').strip()
    if not CIDR_RE.match(cidr):
        return jsonify({'error': 'Invalid CIDR'}), 400
    entries = read_routes_with_desc(ISP_CUSTOM_ROUTES)
    write_routes_with_desc(ISP_CUSTOM_ROUTES, [e for e in entries if e['cidr'] != cidr])
    return jsonify({'ok': True})

@app.route('/api/routes/isp/bulk', methods=['POST'])
@require_auth
def api_routes_isp_bulk():
    body = request.get_json(silent=True) or {}
    new_entries = body.get('entries', [])
    if not isinstance(new_entries, list):
        return jsonify({'error': 'entries must be a list'}), 400
    existing = read_routes_with_desc(ISP_CUSTOM_ROUTES)
    existing_cidrs = {e['cidr'] for e in existing}
    added = 0
    for entry in new_entries:
        cidr = entry.get('cidr', '').strip()
        if not CIDR_RE.match(cidr) or cidr in existing_cidrs:
            continue
        existing.append({'cidr': cidr, 'description': entry.get('description', '').strip()})
        existing_cidrs.add(cidr)
        added += 1
    write_routes_with_desc(ISP_CUSTOM_ROUTES, existing)
    return jsonify({'ok': True, 'added': added})

# ── Config: apply / exclude / update ─────────────────────────────────────────

@app.route('/api/config/apply', methods=['POST'])
@require_auth
def api_config_apply():
    r = subprocess.run([ROUTING_SH, '--no-update'], capture_output=True, text=True, timeout=120)
    if r.returncode == 0:
        return jsonify({'ok': True})
    return jsonify({'error': r.stderr.strip()}), 500

@app.route('/api/config/exclude')
@require_auth
def api_config_exclude_get():
    try:
        with open(RU_EXCLUDE_PATH) as fh:
            content = fh.read()
    except FileNotFoundError:
        content = ''
    return jsonify({'content': content})

@app.route('/api/config/exclude', methods=['PUT'])
@require_auth
def api_config_exclude_put():
    body = request.get_json(silent=True) or {}
    content = body.get('content', '')
    with open(RU_EXCLUDE_PATH, 'w') as fh:
        fh.write(content)
    return jsonify({'ok': True})

@app.route('/api/config/update', methods=['POST'])
@require_auth
def api_config_update():
    r = subprocess.run([UPDATE_ROUTES], capture_output=True, text=True, timeout=120)
    if r.returncode == 0:
        return jsonify({'ok': True, 'output': r.stdout})
    return jsonify({'error': r.stderr.strip()}), 500

# ── Logs ─────────────────────────────────────────────────────────────────────

@app.route('/api/logs/watch')
@require_auth
def api_logs_watch():
    def generate():
        current_date = date.today()
        while True:
            log_path = f"{LOG_DIR}/watch-{current_date.strftime('%Y-%m-%d')}.log"
            try:
                with open(log_path, 'r') as fh:
                    fh.seek(0, 2)
                    while True:
                        today = date.today()
                        if today != current_date:
                            current_date = today
                            break
                        line = fh.readline()
                        if line:
                            yield f"data: {line.rstrip()}\n\n"
                        else:
                            time.sleep(0.1)
            except FileNotFoundError:
                yield f"data: [waiting for {log_path}]\n\n"
                time.sleep(2)
    return Response(stream_with_context(generate()), content_type='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

@app.route('/api/logs/history')
@require_auth
def api_logs_history():
    from_str = request.args.get('from', '')
    to_str = request.args.get('to', from_str)
    try:
        from_date = datetime.strptime(from_str, '%Y-%m-%d').date()
        to_date = datetime.strptime(to_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({'error': 'Invalid date format, use YYYY-MM-DD'}), 400
    if to_date < from_date:
        return jsonify({'error': 'End date must be >= start date'}), 400
    if (to_date - from_date).days > 30:
        return jsonify({'error': 'Date range too large (max 30 days)'}), 400
    all_lines = []
    current = from_date
    while current <= to_date:
        log_path = f'{LOG_DIR}/watch-{current.strftime("%Y-%m-%d")}.log'
        all_lines.extend(tail_file(log_path, n=5000))
        current += timedelta(days=1)
    return jsonify({'lines': all_lines, 'count': len(all_lines)})

@app.route('/api/logs/install')
@require_auth
def api_logs_install():
    return jsonify({'lines': tail_file(f'{LOG_DIR}/install.log', n=500)})

@app.route('/api/logs/watch-errors')
@require_auth
def api_logs_watch_errors():
    return jsonify({'lines': tail_file(f'{LOG_DIR}/watch-error.log', n=200)})

@app.route('/api/logs/journal')
@require_auth
def api_logs_journal():
    r = subprocess.run(['journalctl', '-u', 'splitgate-watch', '-u', 'awg0', '--no-pager', '-n', '200'],
                       capture_output=True, text=True, timeout=15)
    return jsonify({'lines': r.stdout.splitlines()})

@app.route('/api/routes/backup')
@require_auth
def api_routes_backup():
    parts = []
    parts.append('# splitgate route backup — ' + date.today().isoformat())
    parts.append('# --- VPN routes (vpn-routes-custom.txt) ---')
    for e in read_routes_with_desc(VPN_CUSTOM_ROUTES):
        parts.append(f"{e['cidr']} # {e['description']}" if e['description'] else e['cidr'])
    parts.append('# --- ISP routes (isp-routes-custom.txt) ---')
    for e in read_routes_with_desc(ISP_CUSTOM_ROUTES):
        parts.append(f"{e['cidr']} # {e['description']}" if e['description'] else e['cidr'])
    content = '\n'.join(parts) + '\n'
    filename = f"splitgate-routes-backup-{date.today().isoformat()}.txt"
    return Response(content, mimetype='text/plain',
                     headers={'Content-Disposition': f'attachment; filename={filename}'})

# ── Settings: env / AWG config / password / rollback ─────────────────────────

@app.route('/api/settings/env')
@require_auth
def api_settings_env_get():
    data = parse_env_file(ENV_PATH)
    return jsonify({'vars': {k: mask_value(k, v) for k, v in data.items()}})

@app.route('/api/settings/env', methods=['PUT'])
@require_auth
def api_settings_env_put():
    body = request.get_json(silent=True) or {}
    new_vars = body.get('vars', {})
    KEY_RE = re.compile(r'^[A-Z][A-Z0-9_]*$')
    if any(not KEY_RE.match(k) for k in new_vars):
        return jsonify({'error': 'Invalid key format'}), 400
    current = parse_env_file(ENV_PATH)
    current.update(new_vars)
    write_env_file(ENV_PATH, current)
    return jsonify({'ok': True})

@app.route('/api/settings/awg-config')
@require_auth
def api_settings_awg_config_get():
    try:
        with open(AWG_CONF_PATH) as fh:
            content = fh.read()
        sections = []
        current = None
        for line in content.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith('#'):
                continue
            if stripped.startswith('[') and stripped.endswith(']'):
                current = {'name': stripped[1:-1], 'keys': []}
                sections.append(current)
            elif '=' in stripped and current is not None:
                k, v = stripped.split('=', 1)
                k = k.strip()
                v = v.strip()
                masked = bool(SECRET_KEY_RE.search(k))
                current['keys'].append({'key': k, 'value': '***' if masked else v, 'masked': masked})
        return jsonify({'sections': sections})
    except FileNotFoundError:
        return jsonify({'sections': []})

@app.route('/api/settings/awg-config', methods=['PUT'])
@require_auth
def api_settings_awg_config_put():
    body = request.get_json(silent=True) or {}
    content = body.get('content', '').strip()
    if '[Interface]' not in content:
        return jsonify({'error': 'Invalid AWG config: missing [Interface]'}), 400
    with open(AWG_CONF_PATH, 'w') as fh:
        fh.write(content + '\n')
    os.chmod(AWG_CONF_PATH, 0o600)
    return jsonify({'ok': True})

@app.route('/api/settings/secrets')
@require_auth
def api_settings_secrets_get():
    try:
        with open(AWG_CONF_PATH) as fh:
            content = fh.read()
        pairs = re.findall(r'^\s*(\w+)\s*=\s*(.+)$', content, re.MULTILINE)
        return jsonify({'vars': {k: mask_value(k, v.strip()) for k, v in pairs}})
    except FileNotFoundError:
        return jsonify({'vars': {}})

@app.route('/api/settings/secrets', methods=['PUT'])
@require_auth
def api_settings_secrets_put():
    body = request.get_json(silent=True) or {}
    new_vars = body.get('vars', {})
    with open(AWG_CONF_PATH) as fh:
        content = fh.read()
    for key, val in new_vars.items():
        content = re.sub(rf'^(\s*{re.escape(key)}\s*=\s*)(.+)$', rf'\g<1>{val}', content, flags=re.MULTILINE)
    with open(AWG_CONF_PATH, 'w') as fh:
        fh.write(content)
    os.chmod(AWG_CONF_PATH, 0o600)
    return jsonify({'ok': True})

def _collect_resources():
    def read_stat():
        with open('/proc/stat') as f:
            parts = f.readline().split()[1:8]
        return list(map(int, parts))
    s1 = read_stat()
    time.sleep(0.3)
    s2 = read_stat()
    idle1, total1 = s1[3], sum(s1)
    idle2, total2 = s2[3], sum(s2)
    cpu_pct = round(100.0 * (1 - (idle2 - idle1) / max(total2 - total1, 1)), 1)

    meminfo = {}
    with open('/proc/meminfo') as f:
        for line in f:
            parts = line.split()
            if len(parts) >= 2:
                meminfo[parts[0].rstrip(':')] = int(parts[1])
    mem_total = meminfo.get('MemTotal', 0) * 1024
    mem_available = meminfo.get('MemAvailable', 0) * 1024
    mem_used = mem_total - mem_available

    st = os.statvfs('/')
    disk_total = st.f_blocks * st.f_frsize
    disk_used = (st.f_blocks - st.f_bavail) * st.f_frsize

    svcs = []
    for name in ['awg0', 'splitgate-watch', 'splitgate-admin', 'networking', 'dnsmasq']:
        try:
            pid_r = subprocess.run(
                ['systemctl', 'show', name, '--property=MainPID', '--value'],
                capture_output=True, text=True, timeout=3)
            pid = int(pid_r.stdout.strip() or '0')
            if pid > 0:
                ps_r = subprocess.run(
                    ['ps', '-p', str(pid), '-o', '%cpu,rss', '--no-headers'],
                    capture_output=True, text=True, timeout=3)
                cols = ps_r.stdout.strip().split()
                svc_cpu = float(cols[0]) if cols else 0.0
                svc_mem = int(cols[1]) * 1024 if len(cols) > 1 else 0
            else:
                svc_cpu, svc_mem = 0.0, 0
        except Exception:
            svc_cpu, svc_mem = 0.0, 0
        svcs.append({'name': name, 'cpu': svc_cpu, 'mem': svc_mem})

    return {
        'cpu_percent': cpu_pct,
        'mem_total': mem_total,
        'mem_used': mem_used,
        'disk_total': disk_total,
        'disk_used': disk_used,
        'services': svcs,
    }

@app.route('/api/status/resources')
@require_auth
def api_status_resources():
    return jsonify(_collect_resources())

@app.route('/api/resources/watch')
@require_auth
def api_resources_watch():
    def generate():
        while True:
            try:
                data = _collect_resources()
                yield f'data: {json.dumps(data)}\n\n'
            except Exception as e:
                yield f'data: {json.dumps({"error": str(e)})}\n\n'
            time.sleep(5)
    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )

@app.route('/api/settings/restart-admin', methods=['POST'])
@require_auth
def api_settings_restart_admin():
    def do_restart():
        time.sleep(1)
        subprocess.run(['systemctl', 'restart', 'splitgate-admin.service'], timeout=10)
    threading.Thread(target=do_restart, daemon=True).start()
    return jsonify({'ok': True, 'message': 'Admin service restarting…'})

@app.route('/api/settings/password', methods=['POST'])
@require_auth
def api_settings_password():
    body = request.get_json(silent=True) or {}
    new_pw = body.get('password', '').strip()
    if not new_pw:
        return jsonify({'error': 'Password required'}), 400
    with open(ADMIN_SECRET_PATH, 'w') as fh:
        fh.write(new_pw + '\n')
    os.chmod(ADMIN_SECRET_PATH, 0o600)
    return jsonify({'ok': True})

@app.route('/api/auth/logout', methods=['POST'])
def api_auth_logout():
    token = request.cookies.get('sg_session')
    if token:
        _sessions.discard(token)
    resp = make_response(jsonify({'ok': True}))
    resp.set_cookie('sg_session', '', expires=0, httponly=True, samesite='Strict', path='/')
    return resp

@app.route('/api/settings/rollback', methods=['POST'])
@require_auth
def api_settings_rollback():
    body = request.get_json(silent=True) or {}
    if body.get('confirmation') != 'ROLLBACK':
        return jsonify({'error': 'Send body: {"confirmation": "ROLLBACK"}'}), 400
    def do_rollback():
        subprocess.run([ROLLBACK_SH], timeout=60)
    threading.Thread(target=do_rollback, daemon=True).start()
    return jsonify({'message': 'Rollback initiated — service will stop'}), 200


@app.route('/')
def index():
    return send_from_directory(ADMIN_DIST_DIR, 'index.html')

@app.route('/<path:path>')
def static_files(path):
    file_path = os.path.join(ADMIN_DIST_DIR, path)
    if os.path.isfile(file_path):
        return send_from_directory(ADMIN_DIST_DIR, path)
    return send_from_directory(ADMIN_DIST_DIR, 'index.html')


@app.errorhandler(400)
def bad_request(e):
    return jsonify({'error': 'Bad Request'}), 400

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not Found'}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal Server Error'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=ADMIN_PORT, debug=False, threaded=True)
