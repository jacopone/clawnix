# nix/mcp-playwright.nix
{ pkgs }:
let
  pythonEnv = pkgs.python3.withPackages (ps: with ps; [
    fastmcp
    playwright
  ]);
in
pkgs.writeShellScriptBin "clawnix-mcp-playwright" ''
  export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
  exec ${pythonEnv}/bin/python ${../mcp-servers/playwright/server.py} "$@"
''
