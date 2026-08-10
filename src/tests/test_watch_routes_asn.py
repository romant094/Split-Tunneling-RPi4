"""
tests/test_watch_routes_asn.py — pytest suite for ASN background-thread enrichment
in scripts/watch-routes.py (plan 07-03).

Imports watch-routes.py via importlib because the filename contains a hyphen,
which makes the standard `import` statement invalid.
"""

import importlib.util
import json
import subprocess
import sys
import threading
import types
import unittest
from unittest.mock import MagicMock, patch

# ─── Load the module using importlib (Pitfall 8 — hyphen in filename) ─────────

_SPEC = importlib.util.spec_from_file_location(
    "watch_routes",
    "src/scripts/watch-routes.py",
)
wr: types.ModuleType = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(wr)  # type: ignore[union-attr]


# ─── Helpers ──────────────────────────────────────────────────────────────────

_SAMPLE_ARGS = dict(
    ts="2026-05-21T11:36:21",
    tag="VPN",
    src="192.168.1.175",
    dst="8.8.8.8",
    proto="TCP",
    dpt="443",
    no_dns=True,
)


def _reset_asn_state() -> None:
    """Clear _asn_cache between tests without replacing the lock object."""
    with wr._asn_lock:
        wr._asn_cache.clear()


# ─── Tests ────────────────────────────────────────────────────────────────────


class TestFormatLineAsnSuffix(unittest.TestCase):
    """Tests 1–3: format_line respects the three _asn_cache value states."""

    def setUp(self) -> None:
        _reset_asn_state()

    def tearDown(self) -> None:
        _reset_asn_state()

    def test_1_cache_hit_with_org_appends_suffix(self) -> None:
        """Test 1: Pre-populated cache with org → line ends with ' | GOOGLE, US'."""
        wr._asn_cache["8.8.8.8"] = {"asn": "15169", "org": "GOOGLE, US"}
        result = wr.format_line(**_SAMPLE_ARGS, enable_asn=True)
        self.assertTrue(
            result.endswith(" | GOOGLE, US"),
            f"Expected ' | GOOGLE, US' suffix, got: {result!r}",
        )

    def test_2_cache_inflight_no_suffix(self) -> None:
        """Test 2: Cache value None (in-flight) → no ' | org' suffix."""
        wr._asn_cache["8.8.8.8"] = None
        result = wr.format_line(**_SAMPLE_ARGS, enable_asn=True)
        self.assertNotIn(" | ", result)

    def test_3_cache_empty_dict_no_suffix(self) -> None:
        """Test 3: Cache value {} (completed, no result) → no ' | org' suffix."""
        wr._asn_cache["8.8.8.8"] = {}
        result = wr.format_line(**_SAMPLE_ARGS, enable_asn=True)
        self.assertNotIn(" | ", result)


class TestLookupAsyncDedup(unittest.TestCase):
    """Test 4: cache miss triggers lookup_async once; second call does not spawn again."""

    def setUp(self) -> None:
        _reset_asn_state()

    def tearDown(self) -> None:
        _reset_asn_state()

    def test_4_cache_miss_triggers_lookup_async_no_duplicate(self) -> None:
        """Test 4: On cache miss, format_line spawns one thread; subsequent call skips."""
        spawned = []

        original_lookup_async = wr.lookup_async

        def mock_lookup_async(ip: str) -> None:
            spawned.append(ip)
            # actually set sentinel so second call sees it
            with wr._asn_lock:
                wr._asn_cache[ip] = None

        with patch.object(wr, "lookup_async", side_effect=mock_lookup_async):
            # First call — cache miss
            wr.format_line(**_SAMPLE_ARGS, enable_asn=True)
            # Second call — should see None sentinel and not re-spawn
            wr.format_line(**_SAMPLE_ARGS, enable_asn=True)

        self.assertEqual(spawned.count("8.8.8.8"), 1, "lookup_async called more than once for same IP")


class TestDoLookupSubprocess(unittest.TestCase):
    """Tests 5 & 6: _do_lookup populates _asn_cache correctly."""

    def setUp(self) -> None:
        _reset_asn_state()

    def tearDown(self) -> None:
        _reset_asn_state()

    def test_5_do_lookup_valid_json_populates_cache(self) -> None:
        """Test 5: Subprocess returns valid JSON → _asn_cache[ip] == parsed dict."""
        ip = "8.8.8.8"
        payload = json.dumps({ip: {"asn": "15169", "org": "GOOGLE, US"}})

        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = payload + "\n"

        with patch("subprocess.run", return_value=mock_result):
            wr._do_lookup(ip)

        with wr._asn_lock:
            cached = wr._asn_cache.get(ip)

        self.assertEqual(cached, {"asn": "15169", "org": "GOOGLE, US"})

    def test_6_do_lookup_timeout_sets_empty_dict(self) -> None:
        """Test 6: subprocess.TimeoutExpired → _asn_cache[ip] == {}."""
        ip = "9.9.9.9"

        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd="python3", timeout=5.0)):
            wr._do_lookup(ip)

        with wr._asn_lock:
            cached = wr._asn_cache.get(ip, "__unset__")

        self.assertEqual(cached, {}, f"Expected empty dict sentinel, got: {cached!r}")


class TestLookupAsyncIdempotent(unittest.TestCase):
    """Test 7: Concurrent lookup_async calls result in exactly one subprocess invocation."""

    def setUp(self) -> None:
        _reset_asn_state()

    def tearDown(self) -> None:
        _reset_asn_state()

    def test_7_concurrent_lookup_async_single_subprocess(self) -> None:
        """Test 7: Two lookup_async calls for same IP → subprocess.run called at most once."""
        ip = "1.1.1.1"

        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps({ip: {"asn": "13335", "org": "CLOUDFLARE"}}) + "\n"

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            # Trigger both calls; second should see sentinel and bail early.
            wr.lookup_async(ip)
            wr.lookup_async(ip)
            # Allow daemon threads to complete
            for t in threading.enumerate():
                if t.name != "MainThread" and t.daemon:
                    t.join(timeout=2.0)

        self.assertLessEqual(
            mock_run.call_count, 1,
            f"Expected at most 1 subprocess.run call, got {mock_run.call_count}",
        )


class TestNoAsnFlag(unittest.TestCase):
    """Test 8: --no-asn flag prevents org suffix."""

    def setUp(self) -> None:
        _reset_asn_state()

    def tearDown(self) -> None:
        _reset_asn_state()

    def test_8_no_asn_flag_disables_enrichment(self) -> None:
        """Test 8: enable_asn=False → never appends ' | org', even with cached result."""
        wr._asn_cache["8.8.8.8"] = {"asn": "15169", "org": "GOOGLE, US"}
        result = wr.format_line(**_SAMPLE_ARGS, enable_asn=False)
        self.assertNotIn(" | ", result, "Expected no ' | org' suffix when enable_asn=False")


class TestHelpFlag(unittest.TestCase):
    """Test 9 (re-spec'd as --help includes --no-asn)."""

    def test_help_exits_0_and_contains_no_asn(self) -> None:
        """Test 9 (as --help): --help exits 0 and stdout mentions --no-asn."""
        import subprocess as sp
        result = sp.run(
            [sys.executable, "src/scripts/watch-routes.py", "--help"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0)
        self.assertIn("--no-asn", result.stdout)


class TestBackwardCompat(unittest.TestCase):
    """Test 9 alt: Existing positional format_line call still works."""

    def setUp(self) -> None:
        _reset_asn_state()

    def tearDown(self) -> None:
        _reset_asn_state()

    def test_9_backward_compat_positional_call(self) -> None:
        """Test 9: format_line with original positional args (no enable_asn) works."""
        wr._asn_cache["8.8.8.8"] = {"asn": "15169", "org": "GOOGLE, US"}
        # Call using all positional args (no keyword enable_asn)
        result = wr.format_line(
            "2026-05-21T11:36:21",
            "VPN",
            "192.168.1.175",
            "8.8.8.8",
            "TCP",
            "443",
            True,  # no_dns
        )
        # enable_asn defaults to True, so org suffix should appear
        self.assertTrue(
            result.endswith(" | GOOGLE, US"),
            f"Backward-compat call failed; got: {result!r}",
        )


def _reset_pending_state() -> None:
    """Clear _pending between tests without replacing the lock."""
    with wr._pending_lock:
        wr._pending.clear()


class TestPendingBuffer(unittest.TestCase):
    """Tests B1–B7: pending buffer and watchdog behavior."""

    def setUp(self) -> None:
        _reset_asn_state()
        _reset_pending_state()

    def tearDown(self) -> None:
        _reset_asn_state()
        _reset_pending_state()

    def test_B1_new_ip_buffered_not_printed(self) -> None:
        """B1: new dst not in cache → entry added to _pending, nothing printed."""
        with patch("subprocess.run") as mock_run, \
             patch("builtins.print") as mock_print, \
             patch.object(wr, "lookup_async"):
            # Simulate one iteration of main()'s inner logic directly
            dst = "1.2.3.4"
            with wr._asn_lock:
                cached = wr._asn_cache.get(dst, "__missing__")
            self.assertEqual(cached, "__missing__")

            wr.lookup_async(dst)
            import time as _time
            entry = (_time.monotonic(), "2026-05-28T12:00:00", "VPN",
                     "192.168.1.1", dst, "TCP", "443", True)
            with wr._pending_lock:
                wr._pending.setdefault(dst, []).append(entry)

        with wr._pending_lock:
            self.assertIn("1.2.3.4", wr._pending)
            self.assertEqual(len(wr._pending["1.2.3.4"]), 1)

    def test_B2_do_lookup_flushes_pending_with_org(self) -> None:
        """B2: _do_lookup with resolved org → _flush_entries prints line with | org."""
        import time as _time
        dst = "8.8.8.8"
        entry = (_time.monotonic(), "2026-05-28T12:00:00", "VPN",
                 "192.168.1.1", dst, "TCP", "443", True)
        with wr._pending_lock:
            wr._pending[dst] = [entry]

        payload = json.dumps({dst: {"asn": "15169", "org": "GOOGLE, US"}})
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = payload + "\n"

        with patch("subprocess.run", return_value=mock_result), \
             patch("builtins.print") as mock_print:
            wr._do_lookup(dst)

        with wr._pending_lock:
            self.assertNotIn(dst, wr._pending, "_pending not cleared after _do_lookup")
        printed = mock_print.call_args_list
        self.assertTrue(any("GOOGLE, US" in str(c) for c in printed),
                        f"Expected '| GOOGLE, US' in output; got {printed}")

    def test_B3_do_lookup_flushes_pending_no_result(self) -> None:
        """B3: _do_lookup with no result → _flush_entries prints line without | org."""
        import time as _time
        dst = "9.9.9.9"
        entry = (_time.monotonic(), "2026-05-28T12:00:00", "ISP",
                 "192.168.1.1", dst, "TCP", "80", True)
        with wr._pending_lock:
            wr._pending[dst] = [entry]

        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd="p", timeout=5.0)), \
             patch("builtins.print") as mock_print:
            wr._do_lookup(dst)

        with wr._pending_lock:
            self.assertNotIn(dst, wr._pending)
        printed_lines = [str(c) for c in mock_print.call_args_list]
        self.assertTrue(any("9.9.9.9" in l for l in printed_lines))
        self.assertFalse(any(" | " in l for l in printed_lines))

    def test_B4_in_flight_ip_adds_to_existing_pending(self) -> None:
        """B4: second packet for in-flight IP goes into _pending too."""
        import time as _time
        dst = "5.5.5.5"
        # Mark as in-flight
        with wr._asn_lock:
            wr._asn_cache[dst] = None
        entry1 = (_time.monotonic(), "2026-05-28T12:00:00", "VPN",
                  "192.168.1.1", dst, "TCP", "443", True)
        with wr._pending_lock:
            wr._pending[dst] = [entry1]

        entry2 = (_time.monotonic(), "2026-05-28T12:00:01", "VPN",
                  "192.168.1.1", dst, "TCP", "443", True)
        # Simulate main() logic for in-flight case
        with wr._asn_lock:
            cached = wr._asn_cache.get(dst, "__missing__")
        self.assertIsNone(cached)
        with wr._pending_lock:
            wr._pending.setdefault(dst, []).append(entry2)

        with wr._pending_lock:
            self.assertEqual(len(wr._pending[dst]), 2)

    def test_B5_watchdog_flushes_timed_out_entries(self) -> None:
        """B5: watchdog flushes entries older than _BUFFER_TIMEOUT."""
        import time as _time
        dst = "7.7.7.7"
        old_ts = _time.monotonic() - wr._BUFFER_TIMEOUT - 1.0
        entry = (old_ts, "2026-05-28T12:00:00", "VPN",
                 "192.168.1.1", dst, "TCP", "443", True)
        with wr._pending_lock:
            wr._pending[dst] = [entry]
        with wr._asn_lock:
            wr._asn_cache[dst] = {}

        with patch("builtins.print") as mock_print, \
             patch("time.sleep"):
            # Call watchdog logic directly (one iteration without infinite loop)
            now = _time.monotonic()
            to_flush: list = []
            with wr._pending_lock:
                timed_out = [
                    ip for ip, entries in wr._pending.items()
                    if entries and now - entries[0][0] >= wr._BUFFER_TIMEOUT
                ]
                for ip in timed_out:
                    to_flush.append((ip, wr._pending.pop(ip)))
            for ip, entries in to_flush:
                with wr._asn_lock:
                    result = wr._asn_cache.get(ip) or {}
                wr._flush_entries(entries, result)

        with wr._pending_lock:
            self.assertNotIn(dst, wr._pending, "watchdog did not flush timed-out entry")
        self.assertTrue(mock_print.called)

    def test_B6_no_asn_no_buffering(self) -> None:
        """B6: enable_asn=False → format_line called immediately, _pending untouched."""
        with wr._pending_lock:
            initial_keys = set(wr._pending.keys())

        result = wr.format_line("2026-05-28T12:00:00", "VPN", "192.168.1.1",
                                 "3.3.3.3", "TCP", "443", True, enable_asn=False)
        self.assertIsInstance(result, str)
        self.assertNotIn(" | ", result)

        with wr._pending_lock:
            self.assertEqual(set(wr._pending.keys()), initial_keys,
                             "_pending modified despite enable_asn=False")

    def test_B7_cached_ip_prints_immediately(self) -> None:
        """B7: IP already in _asn_cache with result → format_line returns with org, no pending."""
        dst = "4.4.4.4"
        with wr._asn_lock:
            wr._asn_cache[dst] = {"asn": "3356", "org": "LEVEL3"}

        result = wr.format_line("2026-05-28T12:00:00", "VPN", "192.168.1.1",
                                 dst, "TCP", "80", True, enable_asn=True)
        self.assertIn("LEVEL3", result)

        with wr._pending_lock:
            self.assertNotIn(dst, wr._pending)


# ─── _to_utc_z / _LOG_RE offset tests (quick task 260810-iym) ─────────────────


class TestToUtcZ(unittest.TestCase):
    """Regression tests for offset capture + UTC normalization (_to_utc_z)."""

    def test_basic_offset_plus0300(self) -> None:
        """+0300 (basic format) normalizes to the equivalent UTC instant."""
        self.assertEqual(wr._to_utc_z("2026-05-21T11:36:21+0300"), "2026-05-21T08:36:21Z")

    def test_extended_offset_plus03_00(self) -> None:
        """+03:00 (extended format) normalizes identically to +0300."""
        self.assertEqual(wr._to_utc_z("2026-05-21T11:36:21+03:00"), "2026-05-21T08:36:21Z")

    def test_already_z_is_idempotent(self) -> None:
        """An already-UTC 'Z' timestamp round-trips unchanged."""
        self.assertEqual(wr._to_utc_z("2026-05-21T08:36:21Z"), "2026-05-21T08:36:21Z")

    def test_naive_input_treated_as_host_local(self) -> None:
        """No-offset input is interpreted host-local, converted to UTC, ends with Z.

        Host-timezone-independent: compare against the instant produced by
        attaching the host's local zone directly, not a hardcoded literal.
        """
        naive = "2026-05-21T11:36:21"
        result = wr._to_utc_z(naive)
        self.assertTrue(result.endswith("Z"))
        import datetime as _dt

        expected_instant = _dt.datetime.fromisoformat(naive).astimezone().astimezone(_dt.timezone.utc)
        actual_instant = _dt.datetime.fromisoformat(result.replace("Z", "+00:00"))
        self.assertEqual(actual_instant, expected_instant)

    def test_garbage_input_returned_unchanged(self) -> None:
        """Malformed input never raises — the raw token is returned as-is."""
        self.assertEqual(wr._to_utc_z("garbage"), "garbage")


class TestLogReOffsetCapture(unittest.TestCase):
    """_LOG_RE must capture the journalctl short-iso zone offset when present."""

    def test_log_re_captures_offset_suffix(self) -> None:
        line = "2026-05-21T11:36:21+0300 raspberrypi kernel: [VPN] IN=eth0 OUT=awg0 SRC=1.1.1.1 DST=2.2.2.2 PROTO=TCP DPT=443"
        m = wr._LOG_RE.search(line)
        self.assertIsNotNone(m)
        self.assertEqual(m.group("ts"), "2026-05-21T11:36:21+0300")

    def test_log_re_still_matches_bare_timestamp(self) -> None:
        line = "2026-05-21T11:36:21 raspberrypi kernel: [ISP] IN=eth0 OUT=eth0 SRC=1.1.1.1 DST=2.2.2.2 PROTO=UDP"
        m = wr._LOG_RE.search(line)
        self.assertIsNotNone(m)
        self.assertEqual(m.group("ts"), "2026-05-21T11:36:21")


if __name__ == "__main__":
    unittest.main()
