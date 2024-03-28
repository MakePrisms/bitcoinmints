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
  reviews: Nip87MintReccomendation[];
  loading: boolean;
  error?: null | string;
}

const initialState: Nip87State = {
  mints: [],
  mintInfos: [],
  reviews: [],
  loading: false,
  error: null,
};

const fetchMintInfoCache = new Map<string, MintData | Promise<MintData>>();

const getMintInfoWithCache = async (url: string) => {
  if (!fetchMintInfoCache.has(url)) {
    fetchMintInfoCache.set(
      url,
      getMintInfo(url)
        .then((data) => data)
        .catch((e) => {
          fetchMintInfoCache.delete(url);
          console.error("Error fetching mint url", e);
          throw e;
        }),
    );
  }

  return fetchMintInfoCache.get(url)!;
};

export const addMintInfosAsync = createAsyncThunk(
  "nip87/addMint",
  async (
    { event, relay }: { event: NostrEvent; relay?: string },
    { getState, dispatch },
  ) => {
    const mintUrls = event.tags
      .filter((tag) => tag[0] === "u")
      .map((tag) => tag[1]);

    if (mintUrls.length > 1)
      throw new Error("Multiple mint urls in one mint info event");

    const state = getState() as RootState;
    const fetchedMint = state.nip87.mints.find(
      (mint) => mint.url === mintUrls[0],
    );

    let mintName = "";
    if (fetchedMint) {
      mintName = fetchedMint.name;
    } else {
      const mintData = await getMintInfoWithCache(mintUrls[0]);
      const { name } = mintData;
      dispatch(addMintData(mintData));
      mintName = name;
    }

    dispatch(addMint({ event, relay, mintName }));
  },
);

export const addReviewAsync = createAsyncThunk(
  "nip87/addReview",
  async (
    { event, infoEventRelay }: { event: NostrEvent; infoEventRelay?: string },
    { getState, dispatch },
  ) => {
    if (event.tags.find((tag) => tag[0] === "k" && tag[1] === "38173")) {
      const inviteCodes = event.tags
        .filter((tag) => tag[0] === "u")
        .map((tag) => tag[1]);
      const modules = event.tags
        .find((tag) => tag[0] === "modules")?.[1]
        ?.split(",");
      const fedId = event.tags.find((tag) => tag[0] === "d")?.[1];
      dispatch(
        addReview({
          event,
          mintNameMap: [
            {
              mintName: `Fedimint ${fedId?.slice(0, 3)}...${fedId?.slice(-3)}`,
              inviteCodes,
            },
          ],
        }),
      );
    }

    const mintUrls = event.tags
      .filter((tag) => tag[0] === "u" && tag[2] === "cashu")
      .map((tag) => tag[1]);

    const state = getState() as RootState;
    const fetchedMints = state.nip87.mints.filter((mint) =>
      mintUrls.includes(mint.url),
    );

    const mintNameMap = [];
    for (const mintUrl of mintUrls) {
      const fetchedMint = fetchedMints.find((mint) => mint.url === mintUrl);
      let mintName = "";
      if (fetchedMint) {
        mintName = fetchedMint.name;
      } else {
        const mintData = await getMintInfoWithCache(mintUrls[0]);
        const { name } = mintData;
        dispatch(addMintData(mintData));
        mintName = name;
      }

      mintNameMap.push({ mintUrl, mintName });
    }

    dispatch(addReview({ event, infoEventRelay, mintNameMap }));
  },
);

const nip87Slice = createSlice({
  name: "nip87",
  initialState: initialState,
  reducers: {
    addMintData(state, action: { payload: MintData }) {
      if (state.mints.find((mint) => mint.url === action.payload.url)) return;
      state.mints = [...state.mints, action.payload];
    },
    addMint(
      state,
      action: {
        payload: { event: NostrEvent; relay?: string; mintName: string };
      },
    ) {
      const mintUrls = action.payload.event.tags
        .filter((tag) => tag[0] === "u")
        .map((tag) => tag[1]);

      if (mintUrls.length === 0) return;

      if (action.payload.event.kind === Nip87Kinds.FediInfo) {
        const exists = state.mintInfos.find((mint) => {
          const fedId = action.payload.event.tags.find(
            (t) => t[0] === "d",
          )?.[1];
          return mint.mintPubkey === fedId;
        });
        if (exists) return;
        state.mintInfos = [
          ...state.mintInfos,
          {
            mintName: action.payload.mintName,
            appPubkey: action.payload.event.pubkey,
            rawEvent: action.payload.event,
            relay: action.payload.relay,
            numReviews: state.reviews.filter(
              (e) => e.mintPubkey === action.payload.event.pubkey,
            ).length,
            totalRatings: state.reviews
              .filter((e) => e.mintPubkey === action.payload.event.pubkey)
              .reduce((acc, e) => acc + (e.rating || 0), 0),
            reviewsWithRating: state.reviews
              .filter((e) => e.mintPubkey === action.payload.event.pubkey)
              .filter((e) => e.rating).length,
            mintPubkey: action.payload.event.tags.find(
              (t) => t[0] === "d",
            )?.[1],
            inviteCodes: action.payload.event.tags
              .filter((t) => t[0] === "u")
              ?.map((t) => t[1]),
          },
        ];
        return;
      }

      mintUrls.forEach((mintUrl) => {
        const exists = state.mintInfos.find(
          (mint) => `${mint.mintUrl}` === `${mintUrl}`,
        );

        if (!exists) {
          state.mintInfos = [
            ...state.mintInfos,
            {
              mintUrl,
              mintName: action.payload.mintName,
              appPubkey: action.payload.event.pubkey,
              rawEvent: action.payload.event,
              supportedNuts: action.payload.event.tags.find(
                (t) => t[0] === "nuts",
              )?.[1],
              relay: action.payload.relay,
              numReviews: state.reviews.filter((e) => e.mintUrl === mintUrl)
                .length,
              totalRatings: state.reviews
                .filter((e) => e.mintUrl === mintUrl)
                .reduce((acc, e) => acc + (e.rating || 0), 0),
              reviewsWithRating: state.reviews
                .filter((e) => e.mintUrl === mintUrl)
                .filter((e) => e.rating).length,
            },
          ];
        }
      });
    },
    addReview(
      state,
      action: {
        payload: {
          event: NostrEvent;
          mintNameMap: {
            mintUrl?: string;
            inviteCodes?: string[];
            mintName: string;
          }[];
          infoEventRelay?: string;
        };
      },
    ) {
      if (action.payload.event.kind !== Nip87Kinds.Reccomendation) return;

      // extract data rating/review from event content - `[{rating}/5] {review}`
      const rating = action.payload.event.content.match(/\[(\d)\/5\]/)?.[1];
      const review = action.payload.event.content.replace(/\[(\d)\/5\]/, "");

      if (action.payload.mintNameMap[0].mintUrl) {
        const mintUrl = action.payload.mintNameMap[0].mintUrl;

        // check if review already added to state
        const exists = state.reviews.find(
          (r) =>
            `${r.mintUrl}${r.userPubkey}` ===
            `${mintUrl}${action.payload.event.pubkey}`,
        );

        const mintName = action.payload.mintNameMap.find(
          (m) => m.mintUrl === mintUrl,
        )?.mintName!;

        // if review does not exist, add it to state
        if (!exists) {
          state.reviews = [
            ...state.reviews,
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

          // update the mint info with new review data
          const mintInfo = state.mintInfos.find((m) => m.mintUrl === mintUrl);
          if (mintInfo) {
            mintInfo.numReviews = mintInfo.numReviews + 1;
            mintInfo.totalRatings =
              mintInfo.totalRatings + (rating ? parseInt(rating) : 0);
            mintInfo.reviewsWithRating =
              mintInfo.reviewsWithRating + (rating ? 1 : 0);
            // update the mint info in the state
            state.mintInfos = state.mintInfos.map((m) =>
              m.mintUrl === mintUrl ? mintInfo : m,
            );
          }
        }
      } else if (action.payload.mintNameMap[0].inviteCodes) {
        const inviteCodes = action.payload.mintNameMap[0].inviteCodes!;

        // check if review already added to state
        const exists = state.reviews.find((r) => {
          return r.rawEvent.id === action.payload.event.id;
        });

        // if review does not exist, add it to state
        if (!exists) {
          const mintPubkey = action.payload.event.tags.find(
            (t) => t[0] === "d",
          )?.[1];
          state.reviews = [
            ...state.reviews,
            {
              mintType: Nip87MintTypes.Fedimint,
              inviteCodes,
              mintName: action.payload.mintNameMap[0].mintName,
              rating: rating ? parseInt(rating) : undefined,
              review,
              userPubkey: action.payload.event.pubkey,
              rawEvent: action.payload.event,
              mintInfoEventRelay: action.payload.infoEventRelay,
              mintPubkey,
            },
          ];

          // update the mint info with new review data
          const mintInfo = state.mintInfos.find(
            (m) => m.mintPubkey === mintPubkey,
          );
          if (mintInfo) {
            mintInfo.numReviews = mintInfo.numReviews + 1;
            mintInfo.totalRatings =
              mintInfo.totalRatings + (rating ? parseInt(rating) : 0);
            mintInfo.reviewsWithRating =
              mintInfo.reviewsWithRating + (rating ? 1 : 0);
            state.mintInfos = state.mintInfos.map((m) =>
              m.mintPubkey === mintPubkey ? mintInfo : m,
            );
          }
        }
      }
    },
    deleteReview(state, action: { payload: string }) {
      state.reviews = state.reviews.filter(
        (r) => `${r.mintUrl}${r.userPubkey}` !== action.payload,
      );
      const mintInfo = state.mintInfos.find(
        (m) => m.mintUrl === action.payload,
      );
      if (mintInfo) {
        mintInfo.numReviews = mintInfo.numReviews - 1;
        //TODO: decrement totalRatings and reviewsWithRating
        // update the mint info in the state
        state.mintInfos = state.mintInfos.map((m) =>
          m.mintUrl === action.payload ? mintInfo : m,
        );
      }
    },
    deleteMintInfo(state, action: { payload: string }) {
      state.mintInfos = state.mintInfos.filter(
        (mint) => `${mint.mintUrl}${mint.appPubkey}` !== action.payload,
      );
    },
  },
});

export default nip87Slice.reducer;
export const { addMintData, addMint, addReview, deleteReview, deleteMintInfo } =
  nip87Slice.actions;
