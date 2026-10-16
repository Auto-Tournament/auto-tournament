# Connect probe: let the browser test which address reaches the server

Status: design. A browser spike of the core trick works (see "Verified so far").
Nothing is built in the platform or csm yet.

## The problem

A match server on a csm machine has two addresses: its LAN address
(`192.168.1.20:27015`) and the machine's public one (`203.0.113.7:27015`).
`api/src/integrations/cs2/fleet/connectChoice.ts` picks one per viewer by
comparing the viewer's IP with the machine's public IP. Behind Cloudflare that
guess fails. At a LAN event on 2026-10-16 the players at the venue reached the
site over another address (IPv6, most likely), were sent to the public address,
and the router did not forward the new servers' ports. Some could not join.

Two workarounds shipped the same night: the `connect_prefer_lan` site setting
(LAN for everyone) and a "Didn't get in? Connect via LAN" hint after 10 s
(`MatchServerPanel.tsx`). Both make the admin or the player do the work.

What we want instead: before showing Connect, the browser tests each candidate
address and the page recommends the one that answered, the faster one if both
did.

## What a useful probe has to test

The probe has to cross the same path as the game: **the same IP, the same UDP
port**. A probe on any other port can lie. At the event, the older servers'
ports were forwarded and the new ones were not, so a probe on a fixed "probe
port", or on Ready Up's status port (270x2, TCP), would have said "public works"
for exactly the servers where it did not. csm's docs don't tell admins to forward
a whole port block, so we can't assume a neighbouring port is forwarded.

The browser constraints:

- The site is HTTPS. `fetch`/WebSocket to `http://<ip>:<port>` is blocked as
  mixed content before anything leaves the browser.
- Mixed-content images are auto-upgraded to `https://`. The upgraded request
  fails either way, and only the timing differs (a fast error means TCP got
  through, a timeout means it did not).
- Chrome's Local Network Access asks the user for permission before a public
  site can make requests to private IPs.
- Browsers can't send raw UDP. The only UDP a page can make is WebRTC: ICE
  connectivity checks, which are STUN binding requests.

## Options

| Option | Same path as the game? | New infra | Verdict |
| --- | --- | --- | --- |
| HTTPS on the host with a real cert (per-host DNS name such as `192-168-1-20.<id>.example.com`, cert via DNS-01) | No: TCP, own port | Wildcard DNS service, cert issuance, a port per host | Rejected: heavy, and tests the wrong port |
| `<img>` / no-cors timing probe to `http://ip:270x2` | No: TCP, status port | None | Rejected. A router that answers RST for an unforwarded port gives a fast error, which reads as "reachable". Also hits the LNA prompt |
| Probe through Ready Up's status server (270x2) | No: TCP | None | Rejected: same port problem, and blocked as mixed content |
| CS2 client reports what worked (server sees the joining player's source IP: private means LAN) | Yes, it's the real join | Ready Up sends `address` on `player_connect` (the game event has it) | Good **after** someone gets in. Can't help the first player, and needs matching venue networks across viewers. Kept as a follow-up |
| **WebRTC ICE check to the game's own IP:port, answered by csm** | **Yes: UDP, same IP and port** | csm release + one root step on the host | **Picked** |

## The pick: an ICE check against the game port

1. The browser creates an `RTCPeerConnection` with a data channel. It sets a
   hand-written remote answer: `a=ice-lite`, a fixed `ice-ufrag`/`ice-pwd`, a
   dummy DTLS fingerprint, `a=setup:active` (so the browser waits for a DTLS
   hello and sends no DTLS itself), and one `typ host` candidate per address
   (LAN `ip:gameport`, public `ip:gameport`). One peer connection per candidate,
   so each gets its own result.
2. The browser sends STUN binding requests to each candidate. They cross the
   real path: the venue router, hairpin NAT, port forwards, the host firewall.
3. On the game host, one static nftables rule sends only STUN to csm, and
   leaves the game alone:
   `udp dport <csm port range> @th,64,16 0x0001 @th,96,32 0x2112a442 redirect to :<probe port>`
   (type "binding request" and the STUN magic cookie in the first 8 payload
   bytes). Conntrack rewrites the reply so it comes from the game port, which
   is what ICE checks.
4. The csm agent (non-root, ordinary UDP socket on the probe port) runs a
   stateless ICE-lite responder. It checks MESSAGE-INTEGRITY with the known
   password and answers with XOR-MAPPED-ADDRESS, MESSAGE-INTEGRITY and
   FINGERPRINT. That's about 150 lines of Go and needs no dependency.
5. The browser polls `getStats()`. The first `candidate-pair` in state
   `succeeded` gives the result and `currentRoundTripTime`. Each peer connection
   is closed after it succeeds, or after 2.5 s.
6. The page recommends the address that succeeded, the lower RTT if both did,
   and LAN on a tie. If neither succeeded (no probe on this host, or a browser
   that blocks it), the current server-side guess stands. The result is kept
   per match in `sessionStorage`. The 10 s "Didn't get in?" hint stays as the
   last fallback.

Platform side: the connect endpoints already return `options` (LAN and public).
They add `probe: { ufrag, pwd }` when the machine's inventory says csm runs the
responder (`inventory.connect_probe = { port }`). The ufrag and password can be
a published constant. They only stop strangers' STUN traffic from looking like
a success, and are not a secret. The responder never replies with more bytes
than it got, so it can't be used for amplification.

### Trade-offs and risks

- **Root, once per host.** The nft rule needs CAP_NET_ADMIN, and the csm agent
  runs as the CS2 user. `sudo csm setup-host` and `sudo csm self-update` would
  install the rule idempotently. A host without the rule just doesn't advertise
  `connect_probe`, so the page falls back to today's guess.
- **Host firewalls.** After the redirect, the INPUT chain sees the probe port,
  not the game port. If ufw or firewalld is active, setup-host must open the
  probe port too, or the probe fails closed (no result, so the fallback applies,
  and it never wrongly recommends an address).
- **False "unreachable" makes it only as bad as today.** When nothing answers,
  the server guess stands. A false "reachable" would need the router itself to
  answer STUN on that port, which routers don't do.
- **Stray packets to CS2.** With `a=setup:active` the browser sends no DTLS. It
  only sends STUN, and the rule catches all of it. A game packet that matches
  both the type and the 32-bit cookie by chance (about 1 in 2⁴⁸) would go to
  the responder, which drops it.
- **Local Network Access.** Chrome's permission prompt is defined for
  fetch/subresources. WebRTC is listed as future work in its explainer. If
  Chrome later covers ICE to private IPs, the LAN probe would prompt or fail,
  and the fallback still applies. Untested from a public HTTPS origin so far.
- **IPv4 only**, like the game.

### Verified so far

A spike on macOS Chrome: a Node STUN responder (ICE-lite, integrity +
fingerprint) on UDP 27015 and the page above. The ICE pair `succeeded` in about
420 ms with an RTT of 1–2 ms, both over loopback and over the machine's LAN IP.
A dead address (`10.255.255.1`) gave no success within 2.5 s. Not yet verified:
the nft redirect on a Linux host (conntrack source-port rewrite, ufw), a public
HTTPS origin, Firefox and Safari, and a real hairpin router.

## What it takes to build

1. **csm**: an ICE-lite responder in the agent (probe port, for example 27014,
   which is below the first game port). setup-host/self-update install the nft
   rule for the csm port range and open the probe port in ufw/firewalld. The
   agent reports `connect_probe: { port }` in its inventory only when the rule
   is present (`nft list table inet csm_probe`). Plus tests for STUN encoding.
2. **Platform**: `probe` on both connect endpoints (`matchConnect.ts`,
   `events/routes.ts`). A `useConnectProbe` hook in the client that runs the
   checks and reorders `options`. `MatchServerPanel` shows the chosen address
   and the measured ping.
3. **Hosts**: `sudo csm self-update` (or `setup-host`) once per game host after
   the csm release. That's the only step an admin takes.
4. **Follow-up**: Ready Up adds `address` to the `player_connect` webhook, so
   the platform learns from real joins too (for example by marking the venue's
   site-visible IPv4 address or IPv6 /64 as "LAN").
