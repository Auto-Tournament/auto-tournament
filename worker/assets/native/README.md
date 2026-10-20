# CS:DM native capture plugin

`libserver.so` is the unmodified Linux x86-64 plugin from
[akiver/cs-demo-manager](https://github.com/akiver/cs-demo-manager), checked out
at `eaffbbfa0114ddc9c24ae474c54afea686f51d10`. The binary was last updated in
upstream commit `b7f9dc77487f543c5ff2b5251dba00a92b3b70d8`.

SHA-256: `c6bab67a072f83d7ec8e57c1fe243179e267bd9631cb4ee2d9cbf192cea86780`.

The upstream MIT license is included in `LICENSE`. Source and build instructions:

- `cs2-server-plugin/cs2-server-plugin/main.cpp`
- `cs2-server-plugin/cs2-server-plugin/cdll_interfaces.h`
- `cs2-server-plugin/cs2-server-plugin/Makefile`
- Initialize that checkout's git submodules, then run `make build` in the
  plugin directory. The resulting binary is written to `static/cs2/libserver.so`.

The plugin exposes hidden movie commands and executes tick-based JSON actions.
The Go worker supplies its own loopback WebSocket endpoint and editor; the
CS:DM application and PostgreSQL are not required. CS2 updates can break the
plugin's engine interfaces. `AT_CSDM_PLUGIN=/absolute/path/libserver.so` selects
a compatible replacement without rebuilding the worker.

The source checkout pins these plugin dependencies:

- easywsclient: `afc1d8cfc584e0f1f4a77e8c0ce3e979d9fe7ce2`
- HL2SDK: `dc8e7324b1e7f3cb115b1a861280a30ba5ce72a2`
- nlohmann/json: `a03e65420ca9a14c97080b67036859aaac06700d`

See [dependency notices](THIRD_PARTY_NOTICES.md), including the SDK
redistribution review item for maintainers before official distribution.
