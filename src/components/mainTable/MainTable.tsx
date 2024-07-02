import { useRef, useState } from "react";
import TableRowEndorsement from "./ReviewsRowItem";
import useMintData from "../../nostr";
import { Pagination, Table, Tabs, TabsRef } from "flowbite-react";
import { useRouter } from "next/router";
import { ParsedUrlQueryInput } from "querystring";
import Filters from "./Filters";
import {
  IoIosArrowDown,
  IoIosArrowForward,
  IoIosArrowUp,
} from "react-icons/io";
import MintsRowItem from "./MintsRowItem";

const MintTable = () => {
  const {
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
  } = useMintData();

  const [mintsPage, setMintsPage] = useState(1);
  const [reviewsPage, setReviewsPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const tabsRef = useRef<TabsRef>(null);
  const [ratingSort, setRatingSort] = useState<"asc" | "desc" | undefined>(
    "desc"
  );

  const router = useRouter();
  const maxPerPage = 10;

  const handleUnitChange = (unit: string) => {
    let newQuery: ParsedUrlQueryInput = { ...router.query };
    let newUnits;
    if (units.includes(unit)) {
      newUnits = units.filter((u) => u !== unit);
    } else {
      newUnits = [...units, unit];
    }

    setUnits(newUnits);

    if (newUnits.length === 0) {
      delete newQuery.units;
    } else {
      newQuery.units = `${newUnits.join(",")}`;
    }

    router.push(
      {
        pathname: router.pathname,
        query: newQuery,
      },
      undefined,
      { shallow: true }
    );
  };

  const handleShowTypeChange = (show: "cashu" | "fedimint") => {
    let newQuery: ParsedUrlQueryInput = { ...router.query };
    const showQuery = [];

    if (show === "cashu") {
      if (showCashu) {
        setShowCashu(false);
      } else {
        showQuery.push("cashu");
        setShowCashu(true);
        setShowFedimint(false);
      }
    }

    if (show === "fedimint") {
      if (showFedimint) {
        setShowFedimint(false);
      } else {
        showQuery.push("fedimint");
        setShowFedimint(true);
        setShowCashu(false);
      }
    }

    if (showQuery.length === 0) {
      delete newQuery.show;
    } else {
      newQuery.show = showQuery.join(",");
    }

    router.push(
      {
        pathname: router.pathname,
        query: newQuery,
      },
      undefined,
      { shallow: true }
    );
  };

  const handleTabChange = (tab: number) => {
    const newQuery: ParsedUrlQueryInput = { ...router.query };

    const tabQueryParam = tab === 0 ? "mints" : "reviews";
    if (router.query.tab !== tabQueryParam) {
      newQuery.tab = tabQueryParam;
    }

    if (tab === 0 && (router.query.mintUrl || router.query.mintPubkey)) {
      delete newQuery.mintUrl;
      delete newQuery.mintPubkey;
      setMintUrlToShow(undefined);
    }

    if (JSON.stringify(newQuery) === JSON.stringify(router.query)) return;

    router.push(
      {
        pathname: router.pathname,
        query: newQuery,
      },
      undefined,
      { shallow: true }
    );

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

  const filterProps = {
    minReviews,
    minRating,
    onlyFriends,
    showCashu,
    showFedimint,
    units,
    showFilters,
    setMinReviews,
    setMinRating,
    setOnlyFriends,
    setShowCashu,
    setShowFedimint,
    handleUnitChange,
    setShowFilters,
    handleShowTypeChange,
  };

  return (
    <div className="w-full">
      <Tabs style="fullWidth" onActiveTabChange={handleTabChange} ref={tabsRef}>
        <Tabs.Item title="Mints" active>
          <Filters {...filterProps} />
          <div className="overflow-x-auto">
            <Table className="overflow-x-auto">
              <Table.Head>
                <Table.HeadCell>Mint</Table.HeadCell>
                <Table.HeadCell>
                  <div className="flex">
                    <span>Rating</span>&nbsp;
                    <span
                      className="hover:cursor-pointer mt-0.5"
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
                  </div>
                </Table.HeadCell>
                <Table.HeadCell>URL</Table.HeadCell>
                <Table.HeadCell>Supported</Table.HeadCell>
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
