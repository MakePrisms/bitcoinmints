import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useRouter } from "next/router";
import NDK, { NDKEvent, NDKFilter } from "@nostr-dev-kit/ndk";
import { RootState, useAppDispatch } from "@/redux/store";
import {
  addMint,
  addMintInfosAsync,
  addReviewAsync,
} from "@/redux/slices/nip87Slice";
import {
  setMintsFilter,
  setReviewsFilter,
  setUnitsFilter,
} from "@/redux/slices/filterSlice";
import {
  Nip87Kinds,
  Nip87MintInfo,
  Nip87MintReccomendation,
  Nip87MintTypes,
} from "@/types";
import { useNdk } from "@/hooks/useNdk";

const useMintData = () => {
  const [mintInfos, setMintInfos] = useState<Nip87MintInfo[]>([]);
  const [reviews, setReviews] = useState<Nip87MintReccomendation[]>([]);
  const [minReviews, setMinReviews] = useState(0);
  const [minRating, setMinRating] = useState(0);
  const [onlyFriends, setOnlyFriends] = useState(false);
  const [showCashu, setShowCashu] = useState(false);
  const [units, setUnits] = useState<string[]>([]);
  const [showFedimint, setShowFedimint] = useState(false);
  const [mintUrlToShow, setMintUrlToShow] = useState<string | undefined>();

  const router = useRouter();
  const dispatch = useAppDispatch();
  const { ndk } = useNdk();

  const filters = useSelector((state: RootState) => state.filters);
  const following = useSelector((state: RootState) => state.user.following);
  const { mintInfos: unfilteredMintInfos, reviews: unfilteredReviews } =
    useSelector((state: RootState) => state.nip87);

  useEffect(() => {
    if (!ndk) return;
    if (!router.isReady) return;

    const showCashuQuery = showCashu;

    let mintInfoFilter: NDKFilter;
    if (showCashuQuery) {
      mintInfoFilter = {
        kinds: [Nip87Kinds.CashuInfo],
      } as unknown as NDKFilter;
    } else {
      mintInfoFilter = {
        kinds: [Nip87Kinds.CashuInfo, Nip87Kinds.FediInfo],
      } as unknown as NDKFilter;
    }

    console.log("mintInfoFilter", mintInfoFilter);

    const mintSub = ndk.subscribe(mintInfoFilter, { closeOnEose: false });

    const reviewSub = ndk.subscribe(
      {
        kinds: [Nip87Kinds.Reccomendation],
      } as unknown as NDKFilter,
      { closeOnEose: false }
    );

    mintSub.on("event", async (event: NDKEvent) => {
      if (event.kind === Nip87Kinds.FediInfo) {
        // Fetch the mint name with fedimint observer
        const inviteCode = event.getMatchingTags("u")[0]?.[1];
        let response = await fetch(
          `https://fmo.sirion.io/config/${inviteCode}/meta`
        );
        let data = await response.json();
        let mintName = "Fedimint: ";
        if (!data.federation_name) {
          mintName =
            mintName +
            `${event.getMatchingTags("d")[0][1].slice(0, 3)}...${event
              .getMatchingTags("d")[0][1]
              .slice(-3)}`;
        } else {
          mintName = mintName + data.federation_name;
        }
        const fetchModulesUrl = `https://fmo.sirion.io/config/${inviteCode}/module_kinds`;
        response = await fetch(fetchModulesUrl);
        data = await response.json();
        const modules = data.join(", ").toUpperCase();
        dispatch(
          addMint({
            event: event.rawEvent(),
            mintName,
            // Fedimint units are in msats
            units: ["msat"],
            supportedNuts: modules,
          })
        );
      } else {
        dispatch(
          addMintInfosAsync({
            event: event.rawEvent(),
            relay: event.relay?.url,
          })
        );
      }
    });

    reviewSub.on("event", (event: NDKEvent) => {
      dispatch(
        addReviewAsync({
          event: event.rawEvent(),
          infoEventRelay: undefined,
        })
      );
    });
  }, [
    ndk,
    dispatch,
    showCashu,
    showFedimint,
    router.isReady,
    router.query.show,
  ]);

  // set mints to show based on filters
  useEffect(() => {
    const filteredMintInfos = unfilteredMintInfos.filter((mint) => {
      const avgRating = mint.totalRatings / mint.reviewsWithRating;
      if (avgRating < filters.mints.minRating) {
        return false;
      }
      if (mint.numReviews < filters.mints.minReviews) {
        return false;
      }

      if (
        !filters.reviews.showCashu &&
        mint.rawEvent.kind === Nip87Kinds.CashuInfo
      ) {
        if (filters.reviews.showFedimint) {
          return false;
        }
      }

      if (
        !filters.reviews.showFedimint &&
        mint.rawEvent.kind === Nip87Kinds.FediInfo
      ) {
        if (filters.reviews.showCashu) {
          return false;
        }
      }

      if (
        filters.units.length > 0 &&
        !mint.units.some((unit) => filters.units.includes(unit))
      ) {
        return false;
      }

      return true;
    });
    setMintInfos(filteredMintInfos);
  }, [
    unfilteredMintInfos,
    filters.mints,
    filters.reviews.showFedimint,
    filters.reviews.showCashu,
    filters.units,
  ]);

  // set reviews to show based on filters
  useEffect(() => {
    const filteredReviews = unfilteredReviews.filter((review) => {
      if (
        !mintInfos.some(
          (m) =>
            m.mintUrl === review.mintUrl || m.mintPubkey === review.mintPubkey
        )
      ) {
        return false;
      }
      if (filters.reviews.friends && !following.includes(review.userPubkey)) {
        return false;
      }

      if (
        mintUrlToShow &&
        mintUrlToShow !== review.mintUrl &&
        mintUrlToShow !== review.mintPubkey
      ) {
        return false;
      }

      if (
        !filters.reviews.showCashu &&
        review.mintType === Nip87MintTypes.Cashu
      ) {
        return false;
      }

      if (
        !filters.reviews.showFedimint &&
        review.mintType === Nip87MintTypes.Fedimint
      ) {
        return false;
      }

      if (units.length > 0) {
        const mintInfo = unfilteredMintInfos.find(
          (mint) =>
            mint.mintUrl === review.mintUrl ||
            mint.mintPubkey === review.mintPubkey
        );
        if (!mintInfo) return false;
        if (!mintInfo.units.some((unit) => units.includes(unit))) {
          return false;
        }
      }

      return true;
    });
    setReviews(filteredReviews);
  }, [
    unfilteredReviews,
    filters.reviews,
    following,
    mintUrlToShow,
    units,
    mintInfos,
    unfilteredMintInfos,
  ]);

  useEffect(() => {
    dispatch(setMintsFilter({ minReviews, minRating }));
  }, [minReviews, minRating, dispatch]);

  useEffect(() => {
    dispatch(
      setReviewsFilter({ friends: onlyFriends, showCashu, showFedimint })
    );
  }, [onlyFriends, showCashu, showFedimint, dispatch]);

  useEffect(() => {
    dispatch(setUnitsFilter(units));
  }, [units, dispatch]);

  return {
    mintInfos,
    reviews,
    minReviews,
    minRating,
    onlyFriends,
    showCashu,
    showFedimint,
    units,
    mintUrlToShow,
    setMinReviews,
    setMinRating,
    setOnlyFriends,
    setShowCashu,
    setShowFedimint,
    setUnits,
    setMintUrlToShow,
  };
};

export default useMintData;
