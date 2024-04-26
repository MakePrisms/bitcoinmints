export type CreateMintRequest = {
  name: string;
  description: string;
  longDescription: string;
  backend: {
    data: {
      uri: string;
    };
  };
  units: string[];
};

export type CreateMintResponse = {
  id: string;
  ownerPubkey: string;
  contact: string[][];
  name: string;
  description: string;
  longDescription: string;
  createdAt: string;
  updatedAt: string;
  pegOutOnly: boolean;
  maxBalance: number;
  maxPegIn: number;
  maxPegOut: number;
  backendId: string;
  keysets?: {
    unit: string;
  }[];
};

export type FetchMintsResponse = CreateMintResponse[];
