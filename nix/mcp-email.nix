# nix/mcp-email.nix
{ pkgs }:
let
  pythonEnv = pkgs.python3.withPackages (ps: with ps; [
    fastmcp
  ]);
in
pkgs.writeShellScriptBin "clawnix-mcp-email" ''
  exec ${pythonEnv}/bin/python ${../mcp-servers/email/server.py} "$@"
''
