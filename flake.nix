{
  description = "bitcoinmints v2 — nostr Cashu mint directory";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          # pkgs.biome is built from source by nixpkgs, so it works natively
          # on NixOS. Scripts that invoke `biome` (not `bunx biome`) will pick
          # this up. The @biomejs/biome npm package is also installed via bun
          # so CI can run `bunx biome` on Ubuntu.
          packages = [
            pkgs.bun
            pkgs.nodejs_20
            pkgs.biome
            pkgs.lefthook
          ];
        };
      });
}
