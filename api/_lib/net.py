"""Outbound-request safety helpers (SSRF guard).

Any code that fetches a URL whose value can be influenced by a client must
run it through `assert_safe_url()` first. It blocks non-HTTP(S) schemes and
any host that resolves to a private, loopback, link-local, or otherwise
internal address — the ranges an attacker would use to reach the cloud
metadata endpoint (169.254.169.254), localhost services, or the private LAN.

Note: this validates at call time. A hostile DNS server could still rebind
between this check and the actual request (TOCTOU); for the fully robust
version you also pin the resolved IP when making the request. This guard
covers the common cases and is a large improvement over no validation.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse


class UnsafeURLError(ValueError):
    """Raised when a URL is not safe to fetch (bad scheme or internal host)."""


def _ip_is_blocked(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True  # not a parseable IP → treat as unsafe
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    )


def assert_safe_url(url: str) -> str:
    """Return the URL unchanged if safe to fetch, else raise UnsafeURLError."""
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in ("http", "https"):
        raise UnsafeURLError("Only http/https URLs are allowed")
    host = parsed.hostname
    if not host:
        raise UnsafeURLError("URL has no host")

    # Resolve every address the host maps to and block if any is internal.
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise UnsafeURLError("Host could not be resolved")

    for info in infos:
        ip = info[4][0]
        if _ip_is_blocked(ip):
            raise UnsafeURLError("URL resolves to a private or internal address")

    return url


def safe_get(url: str, *, headers: dict | None = None, timeout: float = 20.0,
             max_redirects: int = 3):
    """GET a URL, re-validating every redirect hop against the SSRF guard.

    httpx's transparent redirect handling would let a safe public URL bounce
    to an internal one, so we follow redirects manually and check each hop.
    """
    import httpx

    current = url
    for _ in range(max_redirects + 1):
        assert_safe_url(current)
        with httpx.Client(timeout=timeout, follow_redirects=False) as client:
            resp = client.get(current, headers=headers)
        location = resp.headers.get("location")
        if resp.is_redirect and location:
            current = str(httpx.URL(resp.url).join(location))
            continue
        return resp
    raise UnsafeURLError("Too many redirects")
