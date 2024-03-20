import { Tabs, Table, Pagination, TabsRef } from "flowbite-react";
import { useSelector } from "react-redux";
import { useEffect, useRef, useState } from "react";
import NDK, { NDKEvent, NDKFilter } from "@nostr-dev-kit/ndk";
import { useNdk } from "@/hooks/useNdk";
import { Nip87Kinds, Nip87MintInfo, Nip87MintReccomendation } from "@/types";
import { RootState, useAppDispatch } from "@/redux/store";
import {
  addMintInfosAsync,
  addReviewAsync,
} from "@/redux/slices/nip87Slice";
import MintsRowItem from "./MintsRowItem";
import TableRowEndorsement from "./ReviewsRowItem";
import Filters from "./Filters";
import { setMintsFilter, setReviewsFilter } from "@/redux/slices/filterSlice";
import { useRouter } from "next/router";
import { ParsedUrlQueryInput } from "querystring";
import {
  IoIosArrowDown,
  IoIosArrowForward,
  IoIosArrowUp,
} from "react-icons/io";

const MintTable = () => {
  const [mintsPage, setMintsPage] = useState(1);
  const [reviewsPage, setReviewsPage] = useState(1);
  const [mintInfos, setMintInfos] = useState<Nip87MintInfo[]>([]);
  const [reviews, setReviews] = useState<Nip87MintReccomendation[]>([]);
  const [minReviews, setMinReviews] = useState(0);
  const [minRating, setMinRating] = useState(0);
  const [onlyFriends, setOnlyFriends] = useState(false);
  const [showCashu, setShowCashu] = useState(true);
  const [showFedimint, setShowFedimint] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [mintUrlToShow, setMintUrlToShow] = useState<string | undefined>();
  const tabsRef = useRef<TabsRef>(null);
  const [ratingSort, setRatingSort] = useState<"asc" | "desc" | undefined>('desc');

  const router = useRouter();

  const filterProps = {
    minReviews,
    minRating,
    onlyFriends,
    showCashu,
    showFedimint,
    showFilters,
    setMinReviews,
    setMinRating,
    setOnlyFriends,
    setShowCashu,
    setShowFedimint,
    setShowFilters,
  };

  const dispatch = useAppDispatch();

  const maxPerPage = 10;

  const filters = useSelector((state: RootState) => state.filters);
  const following = useSelector((state: RootState) => state.user.following);

  const { ndk } = useNdk();

  const handleTabChange = (tab: number) => {
    const newQuery: ParsedUrlQueryInput = { ...router.query };

    const tabQueryParam = tab === 0 ? "mints" : "reviews";
    if (router.query.tab !== tabQueryParam) {
      newQuery.tab = tabQueryParam;
    }

    if (tab === 0 && router.query.mintUrl) {
      delete newQuery.mintUrl;
      setMintUrlToShow(undefined);
    }

    // check if newQuery is different from router.query
    if (JSON.stringify(newQuery) === JSON.stringify(router.query)) return;

    router.push(
      {
        pathname: router.pathname,
        query: newQuery,
      },
      undefined,
      { shallow: true }
    );

    //always reset page to 1 when changing tabs
    setMintsPage(1);
    setReviewsPage(1);
  };

  const toggleRatingSort = () => {
    const states = ["desc", "asc", undefined];
    const currentIndex = states.indexOf(ratingSort);
    setRatingSort(
      states[(currentIndex + 1) % states.length] as "asc" | "desc" | undefined
    );
  };

  useEffect(() => {
    if (router.query.tab) {
      tabsRef.current?.setActiveTab(router.query.tab === "mints" ? 0 : 1);
    }

    if (router.query.mintUrl) {
      setMintUrlToShow(router.query.mintUrl as string);
    }
  }, [router.query]);

  useEffect(() => {
    if (!ndk) return;

    const mintSub = ndk.subscribe(
      {
        kinds: [Nip87Kinds.CashuInfo],
      } as unknown as NDKFilter,
      { closeOnEose: false }
    );

    const reviewSub = ndk.subscribe(
      {
        kinds: [Nip87Kinds.Reccomendation],
      } as unknown as NDKFilter,
      { closeOnEose: false }
    );

    mintSub.on("event", (event: NDKEvent) => {
      dispatch(
        addMintInfosAsync({ event: event.rawEvent(), relay: event.relay!.url })
      );
    });

    reviewSub.on("event", (event: NDKEvent) => {
      dispatch(
        addReviewAsync({
          event: event.rawEvent(),
          infoEventRelay: undefined,
        })
      );
    });
  }, [ndk, dispatch]);

  const { mintInfos: unfilteredMintInfos, reviews: unfilteredReviews } =
    useSelector((state: RootState) => state.nip87);

  useEffect(() => {
    const filteredMintInfos = unfilteredMintInfos.filter((mint) => {
      const avgRating = mint.totalRatings / mint.reviewsWithRating;
      if (avgRating < filters.mints.minRating) {
        return false;
      }
      if (mint.numReviews < filters.mints.minReviews) {
        return false;
      }
      return true;
    });
    setMintInfos(filteredMintInfos);
  }, [unfilteredMintInfos, filters.mints]);

  useEffect(() => {
    const filteredReviews = unfilteredReviews.filter((review) => {
      if (filters.reviews.friends && !following.includes(review.userPubkey)) {
        return false;
      }

      if (mintUrlToShow && mintUrlToShow !== review.mintUrl) {
        return false;
      }

      return true;
    });
    setReviews(filteredReviews);
  }, [unfilteredReviews, filters.reviews, following, mintUrlToShow]);

  useEffect(() => {
    dispatch(setMintsFilter({ minReviews, minRating }));
  }, [minReviews, minRating]);

  useEffect(() => {
    dispatch(setReviewsFilter({ friends: onlyFriends }));
  }, [onlyFriends]);

  return (
    <div className="w-full">
      <Tabs style="fullWidth" onActiveTabChange={handleTabChange} ref={tabsRef}>
        <Tabs.Item title="Mints" active>
          <Filters {...filterProps} />
          <div className="overflow-x-auto">
            <Table className="overflow-x-auto">
              <Table.Head>
                <Table.HeadCell>Mint</Table.HeadCell>
                <Table.HeadCell className="flex">
                  <span>Rating</span>&nbsp;
                  <span
                    className="hover:cursor-pointer"
                    onClick={toggleRatingSort}
                  >
                    {!ratingSort ? (
                      <IoIosArrowForward />
                    ) : ratingSort === "desc" ? (
                      <IoIosArrowDown />
                    ) : (
                      <IoIosArrowUp />
                    )}
                  </span>
                </Table.HeadCell>
                <Table.HeadCell>URL</Table.HeadCell>
                <Table.HeadCell>Supported Nuts</Table.HeadCell>
                <Table.HeadCell>
                  <span className="sr-only">Review</span>
                </Table.HeadCell>
              </Table.Head>
              <Table.Body>
                {mintInfos
                  .slice(
                    mintsPage * maxPerPage - maxPerPage,
                    mintsPage * maxPerPage
                  )
                  .sort((a, b) => {
                    const aRating =
                      a.reviewsWithRating *
                        (a.totalRatings / a.reviewsWithRating / 5) || 0;
                    const bRating =
                      b.reviewsWithRating *
                        (b.totalRatings / b.reviewsWithRating / 5) || 0;
                    if (!ratingSort) return 0;
                    if (ratingSort === "asc") {
                      return aRating - bRating;
                    } else {
                      return bRating - aRating;
                    }
                  })
                  .map((mint, idx) => (
                    <MintsRowItem mint={mint} key={idx} />
                  ))}
              </Table.Body>
            </Table>
          </div>
          <div className="flex justify-center">
            {mintInfos.length / maxPerPage > 1 && (
              <Pagination
                currentPage={mintsPage}
                onPageChange={(page) => setMintsPage(page)}
                totalPages={Math.ceil(mintInfos.length / maxPerPage)}
              />
            )}
          </div>
        </Tabs.Item>
        <Tabs.Item
          title="Reviews"
          className="focus:shadow-none focus:border-transparent"
        >
          <Filters {...filterProps} />
          <div className="overflow-x-auto">
            <Table className="w-full">
              <Table.Head className="">
                <Table.HeadCell>Rated By</Table.HeadCell>
                <Table.HeadCell>Mint</Table.HeadCell>
                <Table.HeadCell>Rating</Table.HeadCell>
                <Table.HeadCell>Review</Table.HeadCell>
                <Table.HeadCell>
                  <span className="sr-only">Review or Delete</span>
                </Table.HeadCell>
              </Table.Head>
              <Table.Body className="divide-y">
                {reviews
                  .slice(
                    reviewsPage * maxPerPage - maxPerPage,
                    reviewsPage * maxPerPage
                  )
                  .map((review, idx) => (
                    <TableRowEndorsement review={review} key={idx} />
                  ))}
              </Table.Body>
            </Table>
          </div>
          <div className="flex justify-center">
            <Pagination
              currentPage={reviewsPage}
              onPageChange={(page) => setReviewsPage(page)}
              totalPages={Math.ceil(reviews.length / maxPerPage)}
            />
          </div>
        </Tabs.Item>
      </Tabs>
    </div>
  );
};

export default MintTable;
