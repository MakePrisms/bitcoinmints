export type V0NutData = string[];
export type V1NutData = { [key: string]: { supported?: boolean } };

export type GetMintInfoResponse = {
  nuts: V0NutData | V1NutData;
  pubkey: string;
  name: string;
}