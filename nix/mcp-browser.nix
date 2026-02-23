# nix/mcp-browser.nix
{ pkgs }:
let
  pythonEnv = pkgs.python3.withPackages (ps: with ps; [
    fastmcp
    httpx
    beautifulsoup4
    ddgs
  ]);
in
pkgs.writeShellScriptBin "clawnix-mcp-browser" ''
  exec ${pythonEnv}/bin/python ${../mcp-servers/browser/server.py} "$@"
''
