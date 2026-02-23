# nix/mcp-documents.nix
{ pkgs }:
let
  pythonEnv = pkgs.python3.withPackages (ps: with ps; [
    fastmcp
    python-pptx
    openpyxl
    reportlab
  ]);
in
pkgs.writeShellScriptBin "clawnix-mcp-documents" ''
  exec ${pythonEnv}/bin/python ${../mcp-servers/documents/server.py} "$@"
''
