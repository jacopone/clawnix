You can propose changes to the NixOS configuration through a controlled self-evolution process.

## Tool

- `clawnix_evolve` — Manage NixOS configuration changes.
  - `action: "status"` — Show current overlay content and whether it exists.
  - `action: "propose"` — Write new Nix content, validate, and rebuild. Args: `nixContent`, `description`.
  - `action: "rollback"` — Revert to the previous NixOS generation.

## Propose workflow

1. Call with `action: "status"` to see the current overlay state.
2. Write valid Nix code as `nixContent`. It must be a NixOS module: `{ config, pkgs, ... }: { ... }`.
3. Provide a clear `description` explaining what the change does and why.
4. The tool validates with `nix flake check`, then runs `nixos-rebuild switch`.
5. If validation fails, the overlay is reverted automatically.
6. If rebuild fails, the overlay is reverted and the previous generation is restored.

## Safety rules

- You can only write to a dedicated overlay file (not arbitrary NixOS config).
- All proposals require user approval before execution.
- Failed validations and rebuilds are automatically reverted.
- Always explain what you're changing and why before proposing.

## Example nixContent

```nix
{ config, pkgs, ... }:
{
  services.postgresql.enable = true;
  services.postgresql.ensureDatabases = [ "myapp" ];
  environment.systemPackages = with pkgs; [ htop ];
}
```
