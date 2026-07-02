#!/usr/bin/env python3
"""
splitgate-admin — Flask admin backend for the splitgate web admin interface.
Decisions: D-08 single-file Flask, D-09 Basic Auth via /etc/splitgate/admin.secret,
           D-10 ADMIN_PORT, D-11 root
"""

import os, re, hmac, time, json, secrets, subprocess, functools, threading
from datetime import date
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
        # 1. Check cookie first
        cookie_token = request.cookies.get('sg_session')
        if cookie_token and cookie_token in _sessions:
            return f(*args, **kwargs)
        # 2. Read stored password
        try:
            with open(ADMIN_SECRET_PATH) as fh:
                stored_pw = fh.read().strip()
        except FileNotFoundError:
            return Response('Unauthorized', 401, {'WWW-Authenticate': 'Basic realm="splitgate"'})
        # 3. Check for Basic Auth header
        auth = request.authorization
        if not auth:
            return Response('Unauthorized', 401, {'WWW-Authenticate': 'Basic realm="splitgate"'})
        # 4. Constant-time comparison
        if not secrets.compare_digest(auth.password.encode(), stored_pw.encode()):
            return Response('Unauthorized', 401, {'WWW-Authenticate': 'Basic realm="splitgate"'})
        # 5. Issue session cookie
        session_token = secrets.token_hex(16)
        _sessions.add(session_token)
        inner_result = f(*args, **kwargs)
        resp = make_response(inner_result)
        resp.set_cookie('sg_session', session_token, httponly=True, samesite='Strict', path='/')
        return resp
    return decorated


def read_routes_file(path):
    try:
        with open(path) as fh:
            return [line.strip() for line in fh if line.strip() and not line.startswith('#')]
    except FileNotFoundError:
        return []

def write_routes_file(path, entries):
    with open(path, 'w') as fh:
        for entry in entries:
            fh.write(entry + '\n')

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
                    result[k] = v
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
            return [line.strip() for line in deque(fh, maxlen=n)]
    except FileNotFoundError:
        return []


@app.route('/api/status')
@require_auth
def api_status():
    r = subprocess.run(['systemctl', 'is-active', 'awg-quick@awg0'], capture_output=True, text=True, timeout=5)
    tunnel_up = r.returncode == 0
    r2 = subprocess.run(['systemctl', 'is-active', 'splitgate-watch.service'], capture_output=True, text=True, timeout=5)
    daemon_up = r2.returncode == 0
    try:
        mtime = os.path.getmtime('/etc/splitgate/white-list.txt')
        ru_list_updated = str(date.fromtimestamp(mtime))
    except FileNotFoundError:
        ru_list_updated = None
    r3 = subprocess.run(['ip', 'route', 'show', 'dev', 'awg0'], capture_output=True, text=True, timeout=5)
    vpn_route_count = len([l for l in r3.stdout.splitlines() if l.strip()])
    isp_route_count = len(read_routes_file(ISP_CUSTOM_ROUTES))
    try:
        with open('/etc/splitgate/white-list.txt') as fh:
            ru_route_count = sum(1 for l in fh if l.strip() and not l.startswith('#'))
    except FileNotFoundError:
        ru_route_count = 0
    return jsonify({'tunnel_up': tunnel_up, 'daemon_up': daemon_up, 'ru_list_updated': ru_list_updated,
                    'vpn_route_count': vpn_route_count, 'isp_route_count': isp_route_count, 'ru_route_count': ru_route_count})

@app.route('/api/services')
@require_auth
def api_services():
    result = []
    for name in MANAGED_SERVICES:
        unit = SERVICE_UNIT_MAP[name]
        r = subprocess.run(['systemctl', 'is-active', unit], capture_output=True, text=True, timeout=5)
        status = r.stdout.strip() if r.stdout.strip() else 'unknown'
        result.append({'name': name, 'status': status})
    return jsonify(result)

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

@app.route('/api/routes/vpn')
@require_auth
def api_routes_vpn_get():
    return jsonify({'routes': read_routes_file(VPN_CUSTOM_ROUTES)})

@app.route('/api/routes/vpn', methods=['POST'])
@require_auth
def api_routes_vpn_post():
    body = request.get_json(silent=True) or {}
    cidr = body.get('cidr', '').strip()
    if not CIDR_RE.match(cidr):
        return jsonify({'error': 'Invalid CIDR'}), 400
    routes = read_routes_file(VPN_CUSTOM_ROUTES)
    if cidr in routes:
        return jsonify({'error': 'Already exists'}), 409
    routes.append(cidr)
    write_routes_file(VPN_CUSTOM_ROUTES, routes)
    return jsonify({'ok': True}), 201

@app.route('/api/routes/vpn', methods=['DELETE'])
@require_auth
def api_routes_vpn_delete():
    body = request.get_json(silent=True) or {}
    cidr = body.get('cidr', '').strip()
    if not CIDR_RE.match(cidr):
        return jsonify({'error': 'Invalid CIDR'}), 400
    routes = read_routes_file(VPN_CUSTOM_ROUTES)
    write_routes_file(VPN_CUSTOM_ROUTES, [r for r in routes if r != cidr])
    return jsonify({'ok': True})

@app.route('/api/routes/isp')
@require_auth
def api_routes_isp_get():
    return jsonify({'routes': read_routes_file(ISP_CUSTOM_ROUTES)})

@app.route('/api/routes/isp', methods=['POST'])
@require_auth
def api_routes_isp_post():
    body = request.get_json(silent=True) or {}
    cidr = body.get('cidr', '').strip()
    if not CIDR_RE.match(cidr):
        return jsonify({'error': 'Invalid CIDR'}), 400
    routes = read_routes_file(ISP_CUSTOM_ROUTES)
    if cidr in routes:
        return jsonify({'error': 'Already exists'}), 409
    routes.append(cidr)
    write_routes_file(ISP_CUSTOM_ROUTES, routes)
    return jsonify({'ok': True}), 201

@app.route('/api/routes/isp', methods=['DELETE'])
@require_auth
def api_routes_isp_delete():
    body = request.get_json(silent=True) or {}
    cidr = body.get('cidr', '').strip()
    if not CIDR_RE.match(cidr):
        return jsonify({'error': 'Invalid CIDR'}), 400
    routes = read_routes_file(ISP_CUSTOM_ROUTES)
    write_routes_file(ISP_CUSTOM_ROUTES, [r for r in routes if r != cidr])
    return jsonify({'ok': True})

@app.route('/api/config/apply', methods=['POST'])
@require_auth
def api_config_apply():
    r = subprocess.run([ROUTING_SH, '--no-update'], capture_output=True, text=True, timeout=120)
    if r.returncode == 0:
        return jsonify({'ok': True})
    return jsonify({'error': r.stderr.strip()}), 500

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
@require_auth
def index():
    return send_from_directory(ADMIN_DIST_DIR, 'index.html')

@app.route('/<path:path>')
@require_auth
def static_files(path):
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
