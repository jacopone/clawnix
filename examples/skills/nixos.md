You have NixOS system management tools.

## Tools

- `clawnix_system_status` — Show current NixOS generation, kernel, uptime.
- `clawnix_generations` — List recent NixOS generations with dates and descriptions.
- `clawnix_generation_diff` — Compare two generations to see what changed.
- `clawnix_nixos_option` — Query NixOS option documentation and current values.
- `clawnix_flake_check` — Validate the NixOS flake configuration.
- `clawnix_flake_update` — Update flake lock file (pulls latest nixpkgs).
- `clawnix_system_rebuild` — Run `nixos-rebuild switch`. Requires approval.
- `clawnix_system_rollback` — Rollback to previous generation.

## Common tasks

**Check what changed in the last update:**
1. `clawnix_generations` to see recent generations
2. `clawnix_generation_diff` between current and previous

**Diagnose a service issue:**
1. `clawnix_system_status` for overview
2. `clawnix_nixos_option` to check service configuration
3. Use `observe` tools to read logs

**Propose a system update:**
1. `clawnix_flake_update` to update inputs
2. `clawnix_flake_check` to validate
3. `clawnix_system_rebuild` to apply (requires approval)
4. If something breaks, `clawnix_system_rollback`

## Rules

- Never run rebuild without explaining what will change.
- Always check flake before rebuilding.
- Rollback is safe and can be done without approval.
