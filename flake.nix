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
        mcp-browser = import ./nix/mcp-browser.nix { inherit pkgs; };
        mcp-documents = import ./nix/mcp-documents.nix { inherit pkgs; };
        mcp-email = import ./nix/mcp-email.nix { inherit pkgs; };
        mcp-calendar = import ./nix/mcp-calendar.nix { inherit pkgs; };
        mcp-playwright = import ./nix/mcp-playwright.nix { inherit pkgs; };
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
