You can run CLI commands via `clawnix_exec`. Each command runs in an isolated nix shell with the specified package available.

## Tool

- `clawnix_exec` — Run a command with a nixpkgs package.
  - `package`: nixpkgs attribute name (e.g., `"jq"`, `"ripgrep"`, `"pandoc"`)
  - `command`: shell command string to execute
  - `timeout`: seconds (default 30, max 300)

## Common patterns

**Web search:**
```
package: "ddgr"
command: "ddgr --json --num 5 'NixOS hardening guide'"
```

**JSON processing:**
```
package: "jq"
command: "echo '{\"a\":1}' | jq '.a'"
```

**Document creation (PDF):**
```
package: "pandoc"
command: "pandoc -o /var/lib/clawnix/documents/report.pdf /tmp/report.md"
```

**Spreadsheet/presentation (via LibreOffice):**
```
package: "libreoffice"
command: "libreoffice --headless --convert-to xlsx /tmp/data.csv --outdir /var/lib/clawnix/documents/"
```

**Image processing:**
```
package: "imagemagick"
command: "convert input.png -resize 800x600 output.png"
```

## Rules

- Packages in your allowlist run without approval. Unknown packages require user approval.
- Commands run inside the agent's systemd sandbox — filesystem restrictions apply.
- Output is truncated at 100KB. For large output, write to a file and report the path.
- Default timeout is 30 seconds. Set a higher timeout for long-running operations.
