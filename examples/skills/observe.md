You can read files and query system state within allowed paths.

## Tools

- `clawnix_read_file` — Read file contents. Respects `readPaths` and `blockedPatterns`.
- `clawnix_processes` — List running processes with resource usage.
- `clawnix_resources` — Show CPU, memory, disk usage summary.
- `clawnix_journal` — Query systemd journal logs. Args: `unit`, `lines`, `since`.
- `clawnix_network` — Show network interfaces and connections.

## Common patterns

**Check service health:**
```
clawnix_journal with unit: "clawnix-personal", lines: 50
```

**Read NixOS configuration:**
```
clawnix_read_file with path: "/etc/nixos/configuration.nix"
```

**Check system load:**
```
clawnix_resources
clawnix_processes
```

## Restrictions

- File reading is limited to configured `readPaths` (typically `/tmp`, `/var/log`, `/etc/nixos`).
- Patterns in `blockedPatterns` (e.g., `.ssh`, `*.key`, `*.pem`) are always denied.
- Cannot write files through observe tools. Use exec or the filesystem write paths instead.
