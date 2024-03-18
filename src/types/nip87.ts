import { NDKUserProfile, NostrEvent } from "@nostr-dev-kit/ndk";

export enum Nip87Kinds {
  Reccomendation = 38000,
  CashuInfo = 38172,
  FediInfo = 38173,
}

export enum Nip87MintTypes {
  Cashu = "cashu",
  Fedimint = "fedimint",
}

export type Nip87MintInfo = {
  mintUrl: string;
  appPubkey: string;
  rawEvent: NostrEvent;
  mintName: string;
  relay?: string;
  mintPubkey?: string;
  supportedNuts?: string;
  kind0Metadata?: NDKUserProfile;
  numRecommendations: number;
  totalRatings: number;
  numRecsWithRatings: number;
};

export function isNip87MintInfo(mint: Nip87MintInfo | Nip87ReccomendationData): mint is Nip87MintInfo {
  return (mint as Nip87MintInfo).appPubkey !== undefined;
} 

export type Nip87MintReccomendation = {
  mintType: Nip87MintTypes.Cashu;
  mintUrl: string;
  userPubkey: string;
  rawEvent: NostrEvent;
  mintName: string;
  mintInfoEventRelay?: string;
  mintPubkey?: string;
  review?: string;
  rating?: number;
};

export type Nip87ReccomendationData = {
  mintUrl: string;
  supportedNuts: string;
  mintName: string;
  mintPubkey?: string;
}