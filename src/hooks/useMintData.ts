import { useEffect, useMemo } from "react";
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
  Nip87Kinds,
  Nip87MintInfo,
  Nip87MintReccomendation,
  Nip87MintTypes,
} from "@/types";
import { useNdk } from "@/hooks/useNdk";

const useMintData = () => {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { ndk } = useNdk();

  const following = useSelector((state: RootState) => state.user.following);
  const { mintInfos: unfilteredMintInfos, reviews: unfilteredReviews } =
    useSelector((state: RootState) => state.nip87);

  // Parse filters from URL
  const filters = useMemo(() => {
    const parseUnits = (units: string | string[] | undefined): string[] => {
      if (Array.isArray(units)) return units.filter(Boolean);
      if (typeof units === "string") return units.split(",").filter(Boolean);
      return [];
    };

    const showCashu = router.query.showCashu === "true";
    const showFedimint = router.query.showFedimint === "true";

    return {
      minReviews: parseInt(router.query.minReviews as string) || 0,
      minRating: parseFloat(router.query.minRating as string) || 0,
      onlyFriends: router.query.onlyFriends === "true",
      showCashu,
      showFedimint,
      showAll: !showCashu && !showFedimint,
      units: parseUnits(router.query.units),
      mintUrlToShow: router.query.mintUrl as string | undefined,
    };
  }, [router.query]);

  // Filter mintInfos
  const mintInfos = useMemo(() => {
    return unfilteredMintInfos.filter((mint) => {
      const avgRating = mint.totalRatings / mint.reviewsWithRating;
      if (avgRating < filters.minRating) return false;
      if (mint.numReviews < filters.minReviews) return false;
      if (!filters.showAll) {
        if (filters.showCashu && mint.rawEvent.kind !== Nip87Kinds.CashuInfo)
          return false;
        if (filters.showFedimint && mint.rawEvent.kind !== Nip87Kinds.FediInfo)
          return false;
      }
      if (
        filters.units.length > 0 &&
        !mint.units.some((unit) => filters.units.includes(unit))
      )
        return false;
      return true;
    });
  }, [unfilteredMintInfos, filters]);

  // Filter reviews
  const reviews = useMemo(() => {
    return unfilteredReviews.filter((review) => {
      if (
        !mintInfos.some(
          (m) =>
            m.mintUrl === review.mintUrl || m.mintPubkey === review.mintPubkey
        )
      )
        return false;
      if (filters.onlyFriends && !following.includes(review.userPubkey))
        return false;
      if (
        filters.mintUrlToShow &&
        filters.mintUrlToShow !== review.mintUrl &&
        filters.mintUrlToShow !== review.mintPubkey
      )
        return false;
      if (!filters.showCashu && review.mintType === Nip87MintTypes.Cashu)
        return false;
      if (!filters.showFedimint && review.mintType === Nip87MintTypes.Fedimint)
        return false;
      if (filters.units.length > 0) {
        const mintInfo = unfilteredMintInfos.find(
          (mint) =>
            mint.mintUrl === review.mintUrl ||
            mint.mintPubkey === review.mintPubkey
        );
        if (
          !mintInfo ||
          !mintInfo.units.some((unit) => filters.units.includes(unit))
        )
          return false;
      }
      return true;
    });
  }, [unfilteredReviews, mintInfos, filters, following, unfilteredMintInfos]);

  // Fetch data
  useEffect(() => {
    if (!ndk || !router.isReady) return;

    const mintInfoFilter: NDKFilter = {
      kinds: filters.showCashu
        ? [Nip87Kinds.CashuInfo]
        : [Nip87Kinds.CashuInfo, Nip87Kinds.FediInfo],
    } as unknown as NDKFilter;

    const mintSub = ndk.subscribe(mintInfoFilter, { closeOnEose: false });
    const reviewSub = ndk.subscribe(
      { kinds: [Nip87Kinds.Reccomendation] } as unknown as NDKFilter,
      { closeOnEose: false }
    );

    mintSub.on("event", async (event: NDKEvent) => {
      if (event.kind === Nip87Kinds.FediInfo) {
        // Fetch Fedimint info
        const inviteCode = event.getMatchingTags("u")[0]?.[1];
        const metaResponse = await fetch(
          `https://fmo.sirion.io/config/${inviteCode}/meta`
        );
        const metaData = await metaResponse.json();
        const mintName = `Fedimint: ${
          metaData.federation_name ||
          `${event.getMatchingTags("d")[0][1].slice(0, 3)}...${event
            .getMatchingTags("d")[0][1]
            .slice(-3)}`
        }`;

        const modulesResponse = await fetch(
          `https://fmo.sirion.io/config/${inviteCode}/module_kinds`
        );
        const modulesData = await modulesResponse.json();
        const modules = modulesData.join(", ").toUpperCase();

        dispatch(
          addMint({
            event: event.rawEvent(),
            mintName,
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
  }, [ndk, router.isReady, filters.showCashu, dispatch]);

  const updateFilters = (newFilters: Partial<typeof filters>) => {
    const updatedQuery: Partial<{
      minReviews: string;
      minRating: string;
      onlyFriends: string;
      showCashu: string;
      showFedimint: string;
      showAll: string;
      units: string;
      mintUrlToShow: string;
    }> = { ...router.query };

    (Object.keys(newFilters) as Array<keyof typeof filters>).forEach((key) => {
      const value = newFilters[key];
      if (value !== undefined) {
        if (key === "units" && Array.isArray(value)) {
          updatedQuery[key] = value.join(",");
        } else if (typeof value === "boolean") {
          updatedQuery[key] = value.toString();
        } else if (typeof value === "number") {
          updatedQuery[key] = value.toString();
        } else if (typeof value === "string") {
          updatedQuery[key] = value;
        }
      }
    });

    router.push({ pathname: router.pathname, query: updatedQuery }, undefined, {
      shallow: true,
    });
  };

  return {
    mintInfos,
    reviews,
    filters,
    updateFilters,
  };
};

export default useMintData;
