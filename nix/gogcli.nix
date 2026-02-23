# nix/gogcli.nix
# Google Workspace CLI (Gmail, Calendar, Drive, Contacts, Tasks, Sheets, Docs, Slides)
# https://github.com/steipete/gogcli
{ pkgs }:
pkgs.buildGoModule rec {
  pname = "gogcli";
  version = "0.11.0";

  src = pkgs.fetchFromGitHub {
    owner = "steipete";
    repo = "gogcli";
    rev = "v${version}";
    hash = "sha256-hJU40ysjRx4p9SWGmbhhpToYCpk3DcMAWCnKqxHRmh0=";
  };

  vendorHash = "sha256-WGRlv3UsK3SVBQySD7uZ8+FiRl03p0rzjBm9Se1iITs=";

  subPackages = [ "cmd/gog" ];

  meta = {
    description = "Google Workspace CLI: Gmail, Calendar, Drive, Contacts, Tasks, Sheets, Docs, Slides";
    homepage = "https://github.com/steipete/gogcli";
    license = pkgs.lib.licenses.mit;
  };
}
