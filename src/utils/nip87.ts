import {
  Nip87Kinds,
  Nip87MintInfo,
  Nip87MintTypes,
  Nip87ReccomendationData,
  isNip87MintInfo,
} from "@/types";
import NDK, {
  NDKEvent,
  NDKTag,
  NDKUserProfile,
  NostrEvent,
} from "@nostr-dev-kit/ndk";

export type Nip87InfoEventOpts = {
  mintUrl?: string;
  supportedNuts?: string;
  mintPubkey?: string;
  kind0Metadata?: NDKUserProfile;
  inviteCodes?: string[];
};

export const nip87Info = async (
  ndk: NDK,
  mintType: Nip87MintTypes,
  {
    mintUrl,
    mintPubkey,
    kind0Metadata,
    supportedNuts,
    inviteCodes,
  }: Nip87InfoEventOpts
): Promise<NDKEvent> => {
  let tags: NDKTag[] = [];
  if (mintType === Nip87MintTypes.Fedimint) {
    if (inviteCodes && inviteCodes.length > 0) {
      tags.push(...inviteCodes.map((code) => ["u", code.trim(), mintType]));
    }
  } else if (mintType === Nip87MintTypes.Cashu) {
    mintUrl && tags.push(["u", mintUrl, mintType]);
    supportedNuts && tags.push(["nuts", supportedNuts]);
  }

  mintPubkey && tags.push(["d", mintPubkey]);
  console.log("TAGS", tags);

  const content = kind0Metadata ? JSON.stringify(kind0Metadata) : "";

  const event = new NDKEvent(ndk, {
    kind: mintType === Nip87MintTypes.Cashu ? Nip87Kinds.CashuInfo : Nip87Kinds.FediInfo,
    content: content,
    tags: tags,
  } as NostrEvent);

  try {
    const sig = await event.sign();
    event["sig"] = sig;
    return event;
  } catch (e) {
    alert("Make sure you're signed in to Nostr and try again");
    throw new Error("Failed to sign info event");
  }
};

/**
 * Creates a NIP-87 reccomendation event as described here https://github.com/benthecarman/nips/blob/ecash-mint-discover/87.md#recommendation-event
 * @param ndk
 * @param mint mint info
 * @returns An NDKEvent of kind 18173 (NIP-87 Reccomendation event)
 */

export const nip87Reccomendation = async (
  ndk: NDK,
  mint: Nip87MintInfo | Nip87ReccomendationData,
  mintType: Nip87MintTypes,
  rating?: number,
  review?: string
): Promise<NDKEvent> => {
  const infoKind =
    mintType === Nip87MintTypes.Cashu
      ? Nip87Kinds.CashuInfo
      : Nip87Kinds.FediInfo;
  let tags: NDKTag[] = [["k", infoKind.toString()]];

  if (mint.mintUrl) {
    tags.push(["u", mint.mintUrl, mintType]);
  }

  if (mint.inviteCodes) {
    tags.push(...mint.inviteCodes.map((code) => ["u", code.trim(), mintType]));
  }

  if (isNip87MintInfo(mint)) {
    const identifier =
      mint.rawEvent.tags.find((tag) => tag[0] === "d")?.[1] || mint.mintPubkey;
    if (!identifier) {
      throw new Error("Mint info event must have a mintPubkey or d tag");
    }
    const aTag = [
      "a",
      `${Nip87Kinds.CashuInfo}:cashu-mint-pubkey:${identifier}`,
      mint.relay || "",
      "cashu",
    ];
    const dTag = ["d", identifier];
    tags.push(aTag);
    tags.push(dTag);
  } else {
    if (mint.mintPubkey) {
      tags.push(["d", mint.mintPubkey]);
    }
  }

  let content = "";
  if (rating) {
    content += `[${rating}/5] `;
  }
  if (review) {
    content += review;
  }

  const event = new NDKEvent(ndk, {
    kind: Nip87Kinds.Reccomendation,
    content,
    tags: tags,
  } as NostrEvent);

  console.log("EVENT", event.rawEvent());

  try {
    const sig = await event.sign();
    event["sig"] = sig;
    return event;
  } catch (e) {
    console.error(e);
    alert("Make sure you're signed in to Nostr and try again");
    throw new Error("Failed to sign reccomendation event");
  }
};
