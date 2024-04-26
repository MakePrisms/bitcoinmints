export type V0NutData = string[];
export type V1NutData = { [key: string]: { supported?: boolean } };

export type GetMintInfoResponse = {
  nuts: V0NutData | V1NutData;
  pubkey: string;
  name: string;
};

export type MintData = {
  url: string;
  v0: boolean;
  v1: boolean;
  supportedNuts: string;
  name: string;
  units: string[];
  pubkey?: string;
};
