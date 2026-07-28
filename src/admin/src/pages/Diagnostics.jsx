import { useState } from 'react'
import { apiFetch } from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { LogBox } from './Logs'

const IP_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

function IPForm({ label, placeholder, buttonLabel, loadingLabel, onSubmit, disabled }) {
  const [ip, setIp] = useState('')
  const [validationError, setValidationError] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    const trimmed = ip.trim()
    if (!IP_RE.test(trimmed)) {
      setValidationError('Enter a valid IPv4 address (e.g. 8.8.8.8)')
      return
    }
    setValidationError('')
    onSubmit(trimmed)
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3 flex-wrap">
      <div className="space-y-1.5">
        <Label htmlFor={`${label}-ip`}>{label}</Label>
        <Input
          id={`${label}-ip`}
          value={ip}
          onChange={e => setIp(e.target.value)}
          placeholder={placeholder || '8.8.8.8'}
          className="w-56 font-mono"
          disabled={disabled}
        />
      </div>
      <Button type="submit" size="sm" disabled={disabled}>
        {disabled ? (loadingLabel || 'Working…') : buttonLabel}
      </Button>
      {validationError && <span className="text-sm text-destructive self-center">{validationError}</span>}
    </form>
  )
}

export default function Diagnostics() {
  // Whois / ASN
  const [whoisResult, setWhoisResult] = useState(null)
  const [whoisError, setWhoisError] = useState('')
  const [whoisLoading, setWhoisLoading] = useState(false)

  async function runWhois(ip) {
    setWhoisLoading(true)
    setWhoisError('')
    setWhoisResult(null)
    try {
      const r = await apiFetch(`/api/diag/whois?ip=${encodeURIComponent(ip)}`)
      const d = await r.json()
      if (!r.ok) {
        setWhoisError(d.error || 'Lookup failed')
      } else {
        setWhoisResult(d)
      }
    } catch {
      setWhoisError('Connection error')
    }
    setWhoisLoading(false)
  }

  // Traceroute
  const [traceLines, setTraceLines] = useState([])
  const [traceError, setTraceError] = useState('')
  const [traceLoading, setTraceLoading] = useState(false)
  const [traceUnavailable, setTraceUnavailable] = useState(false)

  async function runTraceroute(ip) {
    setTraceLoading(true)
    setTraceError('')
    setTraceUnavailable(false)
    setTraceLines([])
    try {
      const r = await apiFetch(`/api/diag/traceroute?target=${encodeURIComponent(ip)}`)
      const d = await r.json()
      if (r.status === 503) {
        setTraceUnavailable(true)
        setTraceError(d.error || 'traceroute is not installed on the RPi — run deploy.sh to install it.')
      } else if (!r.ok) {
        setTraceError(d.error || 'Traceroute failed')
      } else {
        setTraceLines(d.lines || [])
      }
    } catch {
      setTraceError('Connection error')
    }
    setTraceLoading(false)
  }

  // Route-match
  const [matchResult, setMatchResult] = useState(null)
  const [matchError, setMatchError] = useState('')
  const [matchLoading, setMatchLoading] = useState(false)

  async function runRouteMatch(ip) {
    setMatchLoading(true)
    setMatchError('')
    setMatchResult(null)
    try {
      const r = await apiFetch(`/api/diag/route-match?ip=${encodeURIComponent(ip)}`)
      const d = await r.json()
      if (!r.ok) {
        setMatchError(d.error || 'Route-match failed')
      } else {
        setMatchResult(d)
      }
    } catch {
      setMatchError('Connection error')
    }
    setMatchLoading(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Diagnostics</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Inspect a destination IP — who owns it, the path to it, and whether it currently routes via VPN or ISP.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Whois / ASN Lookup</CardTitle>
          <CardDescription>Look up the organization and ASN that own an IP address.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <IPForm label="Whois" buttonLabel="Lookup" loadingLabel="Looking up…"
            onSubmit={runWhois} disabled={whoisLoading} />
          {whoisError && <p className="text-sm text-destructive">{whoisError}</p>}
          {whoisResult && (
            whoisResult.org || whoisResult.asn ? (
              <div className="text-sm space-y-1 font-mono">
                <div><span className="text-muted-foreground">Org:</span> {whoisResult.org || '—'}</div>
                <div><span className="text-muted-foreground">ASN:</span> {whoisResult.asn || '—'}</div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No data / lookup unavailable</p>
            )
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Traceroute</CardTitle>
          <CardDescription>Trace the network path to a destination IP. May take up to a minute.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <IPForm label="Traceroute" buttonLabel="Trace" loadingLabel="Tracing… (may take up to 60s)"
            onSubmit={runTraceroute} disabled={traceLoading} />
          {traceError && !traceLoading && (
            <p className="text-sm text-destructive">
              {traceUnavailable ? 'traceroute is not installed on the RPi — run deploy.sh to install it.' : traceError}
            </p>
          )}
          {traceLines.length > 0 && <LogBox lines={traceLines} colorize={false} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Route-Match Checker</CardTitle>
          <CardDescription>Check whether an IP currently routes via VPN or ISP, and what matched it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <IPForm label="Route-Match" buttonLabel="Check" loadingLabel="Checking…"
            onSubmit={runRouteMatch} disabled={matchLoading} />
          {matchError && <p className="text-sm text-destructive">{matchError}</p>}
          {matchResult && (
            <div className="text-sm space-y-1">
              <div>
                <span
                  className={`inline-block px-2 py-0.5 rounded text-xs font-mono font-medium ${
                    matchResult.decision === 'VPN' ? 'log-line-vpn bg-primary/10' : 'log-line-isp bg-accent'
                  }`}
                >
                  {matchResult.decision}
                </span>
              </div>
              <div className="font-mono text-muted-foreground">
                <span>Matched by:</span> {matchResult.matched_by || 'default route (dev awg0)'}
              </div>
              <div className="font-mono text-muted-foreground">
                <span>CIDR:</span> {matchResult.cidr || 'default route'}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
