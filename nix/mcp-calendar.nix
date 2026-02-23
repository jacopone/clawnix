# nix/mcp-calendar.nix
{ pkgs }:
let
  pythonEnv = pkgs.python3.withPackages (ps: with ps; [
    fastmcp
    google-api-python-client
    google-auth-oauthlib
    google-auth-httplib2
  ]);
in
pkgs.writeShellScriptBin "clawnix-mcp-calendar" ''
  exec ${pythonEnv}/bin/python ${../mcp-servers/calendar/server.py} "$@"
''
