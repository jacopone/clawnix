{
  description = "ClawNix - Personal AI agent platform for NixOS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      packages.${system} = {
        default = pkgs.buildNpmPackage {
          pname = "clawnix";
          version = "0.2.0";
          src = ./.;
          npmDepsHash = "sha256-a76JqfEuYk7UkNk2CtM5ORgNJr/hFwmfidI6AMKi1LE=";
          nodejs = pkgs.nodejs_22;
          meta.license = pkgs.lib.licenses.mit;
          installPhase = ''
            runHook preInstall
            mkdir -p $out/bin $out/lib/clawnix
            cp -r dist/* $out/lib/clawnix/
            cp -r node_modules $out/lib/clawnix/
            cat > $out/bin/clawnix <<EOF
            #!/bin/sh
            exec ${pkgs.nodejs_22}/bin/node $out/lib/clawnix/index.js "\$@"
            EOF
            chmod +x $out/bin/clawnix
            runHook postInstall
          '';
        };
        # All MCP servers removed — replaced by native plugins:
        # exec (pandoc/libreoffice) | google (gogcli) | browser (BrowserClaw)
        gogcli = import ./nix/gogcli.nix { inherit pkgs; };
      };

      nixosModules.default = import ./nix/module.nix { inherit self; };

      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          nodejs_22
          nodePackages.typescript
          nodePackages.typescript-language-server
        ];
      };
    };
}
