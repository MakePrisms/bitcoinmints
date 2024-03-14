import {
  Nip87Kinds,
  Nip87MintInfo,
  Nip87MintReccomendation,
  Nip87MintTypes,
} from "@/types";
import { NostrEvent } from "@nostr-dev-kit/ndk";
import { createSlice } from "@reduxjs/toolkit";

interface Nip87State {
  mints: Nip87MintInfo[];
  endorsements: Nip87MintReccomendation[];
  loading: boolean;
  error?: null | string;
}

const initialState: Nip87State = {
  mints: [],
  endorsements: [],
  loading: false,
  error: null,
};

const nip87Slice = createSlice({
  name: "nip87",
  initialState: initialState,
  reducers: {
    addMint(state, action: { payload: { event: NostrEvent; relay?: string } }) {
      const mintUrls = action.payload.event.tags
        .filter((tag) => tag[0] === "u")
        .map((tag) => tag[1]);

      if (mintUrls.length === 0) return;

      mintUrls.forEach((mintUrl) => {
        const exists = state.mints.find(
          (mint) =>
            `${mint.mintUrl}${mint.appPubkey}` ===
            `${mintUrl}${action.payload.event.pubkey}`
        );

        if (!exists) {
          state.mints = [
            ...state.mints,
            {
              mintUrl,
              appPubkey: action.payload.event.pubkey,
              rawEvent: action.payload.event,
              supportedNuts: action.payload.event.tags.find(t => t[0] === "nuts")?.[1],
              relay: action.payload.relay,
            },
          ];
        }
      });
    },
    addMintEndorsement(
      state,
      action: { payload: { event: NostrEvent; infoEventRelay?: string } }
    ) {
      if (action.payload.event.kind !== Nip87Kinds.Reccomendation) return;

      const mintUrls = action.payload.event.tags
        .filter((tag) => tag[0] === "u" && tag[2] === "cashu")
        .map((tag) => tag[1]);

      const rating = action.payload.event.tags.find((tag) => tag[0] === "rating")?.[1];
      const review = action.payload.event.tags.find((tag) => tag[0] === "review")?.[1];

      if (mintUrls.length === 0) return;

      mintUrls.forEach((mintUrl) => {
        const exists = state.endorsements.find(
          (endorsement) =>
            `${endorsement.mintUrl}${endorsement.userPubkey}` ===
            `${mintUrl}${action.payload.event.pubkey}`
        );

        if (!exists) {
          state.endorsements = [
            ...state.endorsements,
            {
              mintType: Nip87MintTypes.Cashu,
              mintUrl,
              rating: rating ? parseInt(rating) : undefined,
              review,
              userPubkey: action.payload.event.pubkey,
              rawEvent: action.payload.event,
              mintInfoEventRelay: action.payload.infoEventRelay,
            },
          ];
        }
      });
    },
    deleteMintEndorsement(state, action: { payload: string }) {
      state.endorsements = state.endorsements.filter(
        (endorsement) =>
          `${endorsement.mintUrl}${endorsement.userPubkey}` !== action.payload
      );
    },
    deleteMintInfo(state, action: { payload: string }) {
      state.mints = state.mints.filter(
        (mint) => `${mint.mintUrl}${mint.appPubkey}` !== action.payload
      );
    },
  },
});

export default nip87Slice.reducer;
export const {
  addMint,
  addMintEndorsement,
  deleteMintEndorsement,
  deleteMintInfo,
} = nip87Slice.actions;
