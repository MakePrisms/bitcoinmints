import {
  MintData,
  Nip87Kinds,
  Nip87MintInfo,
  Nip87MintReccomendation,
  Nip87MintTypes,
} from "@/types";
import { getMintInfo } from "@/utils/cashu";
import { NostrEvent } from "@nostr-dev-kit/ndk";
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { RootState } from "../store";

interface Nip87State {
  mints: MintData[];
  mintInfos: Nip87MintInfo[];
  endorsements: Nip87MintReccomendation[];
  loading: boolean;
  error?: null | string;
}

const initialState: Nip87State = {
  mints: [],
  mintInfos: [],
  endorsements: [],
  loading: false,
  error: null,
};

export const addMintInfosAsync = createAsyncThunk(
  'nip87/addMint',
  async ({ event, relay }: { event: NostrEvent; relay?: string }, {getState, dispatch }) => {
    const mintUrls = event.tags.filter((tag) => tag[0] === "u").map((tag) => tag[1]);

    if (mintUrls.length > 1) throw new Error("Multiple mint urls in one mint info event");

    const state = getState() as RootState;
    const fetchedMint = state.nip87.mints.find((mint) => mint.url === mintUrls[0]);

    let mintName = "";
    if (fetchedMint) {
      mintName = fetchedMint.name;
    } else {
      const mintData = await getMintInfo(mintUrls[0])
      const {name} = mintData;
      dispatch(addMintData(mintData));
      mintName = name;
    }


    dispatch(addMint({ event, relay, mintName }));
  })

export const addMintEndorsementAsync = createAsyncThunk(
  'nip87/addMintEndorsement',
  async ({ event, infoEventRelay }: { event: NostrEvent; infoEventRelay?: string }, {getState, dispatch }) => {
    const mintUrls = event.tags.filter((tag) => tag[0] === "u" && tag[2] === "cashu").map((tag) => tag[1]);

    const state = getState() as RootState;
    const fetchedMints = state.nip87.mints.filter((mint) => mintUrls.includes(mint.url));

    const mintNameMap = [];
    for (const mintUrl of mintUrls) {
      const fetchedMint = fetchedMints.find((mint) => mint.url === mintUrl); 
      let mintName = "";
      if (fetchedMint) {
        mintName = fetchedMint.name;
      } else {
        const mintData = await getMintInfo(mintUrls[0])
        const {name} = mintData;
        dispatch(addMintData(mintData));
        mintName = name;
      }
      
      mintNameMap.push({mintUrl, mintName});
    }

    dispatch(addMintEndorsement({ event, infoEventRelay, mintNameMap }));
  }

)

const nip87Slice = createSlice({
  name: "nip87",
  initialState: initialState,
  reducers: {
    addMintData(state, action: { payload: MintData }) {
      if (state.mints.find((mint) => mint.url === action.payload.url)) return;
      state.mints = [...state.mints, action.payload];
    },
    addMint(state, action: { payload: { event: NostrEvent; relay?: string, mintName: string  } }) {
      const mintUrls = action.payload.event.tags
        .filter((tag) => tag[0] === "u")
        .map((tag) => tag[1]);

      if (mintUrls.length === 0) return;

      mintUrls.forEach((mintUrl) => {
        const exists = state.mintInfos.find(
          (mint) =>
            `${mint.mintUrl}` ===
            `${mintUrl}`
        );

        if (!exists) {
          state.mintInfos = [
            ...state.mintInfos,
            {
              mintUrl,
              mintName: action.payload.mintName,
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
      action: { payload: { event: NostrEvent; mintNameMap: {mintUrl: string; mintName: string;}[], infoEventRelay?: string } }
    ) {
      if (action.payload.event.kind !== Nip87Kinds.Reccomendation) return;

      const mintUrls = action.payload.event.tags
        .filter((tag) => tag[0] === "u" && tag[2] === "cashu")
        .map((tag) => tag[1]);

      const rating = action.payload.event.content.match(/\[(\d)\/5\]/)?.[1];
      const review = action.payload.event.content.replace(/\[(\d)\/5\]/, "");

      if (mintUrls.length === 0) return;

      mintUrls.forEach((mintUrl) => {
        const exists = state.endorsements.find(
          (endorsement) =>
            `${endorsement.mintUrl}${endorsement.userPubkey}` ===
            `${mintUrl}${action.payload.event.pubkey}`
        );

        const mintName = action.payload.mintNameMap.find(m => m.mintUrl === mintUrl)?.mintName!;

        if (!exists) {
          state.endorsements = [
            ...state.endorsements,
            {
              mintType: Nip87MintTypes.Cashu,
              mintUrl,
              mintName,
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
      state.mintInfos = state.mintInfos.filter(
        (mint) => `${mint.mintUrl}${mint.appPubkey}` !== action.payload
      );
    },
  },
});

export default nip87Slice.reducer;
export const {
  addMintData,
  addMint,
  addMintEndorsement,
  deleteMintEndorsement,
  deleteMintInfo,
} = nip87Slice.actions;
