import { useEffect, useState } from "react";
import { Rating, Table, Tooltip } from "flowbite-react";
import { BsClipboard2, BsClipboard2CheckFill, BsTrash } from "react-icons/bs";
import { Nip87MintInfo } from "@/types";
import { useNdk } from "@/hooks/useNdk";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/redux/store";
import { deleteMintInfo } from "@/redux/slices/nip87Slice";
import ReviewMintButton from "../buttons/ReviewMintButton";
import { copyToClipboard, shortenString } from "@/utils";
import { useRouter } from "next/router";
import FediCodesModal from "../modals/FediCodesModal";

const MintsRowItem = ({ mint }: { mint: Nip87MintInfo }) => {
  const [copied, setCopied] = useState(false);
  const [showFediCodesModal, setShowFediCodesModal] = useState(false);
  const [reviewData, setReviewData] = useState<{
    avgRating: number;
    numReviewsWithRating: number;
  }>({
    avgRating: 0,
    numReviewsWithRating: 0,
  });

  const router = useRouter();

  const user = useSelector((state: RootState) => state.user);
  const reviews = useSelector((state: RootState) => state.nip87.reviews);

  const { ndk, attemptDeleteEvent } = useNdk();

  const dispatch = useDispatch();

  const handleDelete = async () => {
    attemptDeleteEvent(mint.rawEvent);

    const mintInfoId = `${mint.mintUrl}${mint.appPubkey}`;
    dispatch(deleteMintInfo(mintInfoId));
  };

  const handleCopy = () => {
    if (!mint.mintUrl) {
      setShowFediCodesModal(true);
      return;
    }
    copyToClipboard(mint.mintUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  useEffect(() => {
    let totalRatings = 0;
    let reviewsWithRating = 0;
    if (mint.totalRatings) {
      totalRatings = mint.totalRatings;
      reviewsWithRating = mint.reviewsWithRating;
    }
    const avgRating = Number((totalRatings / reviewsWithRating).toFixed(2));
    setReviewData({
      avgRating: avgRating,
      numReviewsWithRating: reviewsWithRating,
    });
  }, [reviews, mint]);

  const handleReviewsClick = () => {
    let query: any = { ...router.query, tab: "reviews" };
    if (mint.mintUrl) {
      query.mintUrl = mint.mintUrl;
    } else if (mint.mintPubkey) {
      query.mintPubkey = mint.mintPubkey;
    }
    router.push(
      {
        pathname: router.pathname,
        query,
      },
      undefined,
      { shallow: true }
    );
  };

  return (
    <>
      <Table.Row className="dark:bg-gray-800">
        {/* Mint name */}
        <Table.Cell className="min-w-36">{mint.mintName}</Table.Cell>

        {/* Average Rating */}
        <Table.Cell>
          <div className="flex flex-col md:flex-row">
            {reviewData.avgRating ? (
              <>
                <Rating>
                  <Rating.Star />
                  &nbsp;
                  {reviewData.avgRating || "No reviews"}
                  &nbsp;&middot;&nbsp;
                </Rating>
                <div
                  className="hover:cursor-pointer underline w-fit whitespace-nowrap"
                  onClick={handleReviewsClick}
                >
                  {reviewData.numReviewsWithRating} review
                  {reviewData.numReviewsWithRating > 1 ? "s" : ""}
                </div>
              </>
            ) : (
              "No reviews"
            )}
          </div>
        </Table.Cell>

        {/*  Mint Url */}
        <Table.Cell className="hover:cursor-pointer" onClick={handleCopy}>
          <div className="flex">
            {shortenString(mint.mintUrl || "Invite Codes")}
            {copied ? (
              <BsClipboard2CheckFill className="ml-1 mt-1" size={15} />
            ) : (
              <BsClipboard2 className="ml-1 mt-1" size={15} />
            )}
          </div>
        </Table.Cell>

        {/* Supported */}
        <Table.Cell>
          <div>
            <p>
              <strong>Nuts: </strong>
              {mint.supportedNuts || "N/A"}
            </p>
            <p>
              <strong>Units: </strong>
              {mint.units.join(", ") || "N/A"}
            </p>
          </div>
        </Table.Cell>
        <Table.Cell>
          {user.pubkey === mint.appPubkey ? (
            <Tooltip content="Attempt to delete">
              <BsTrash
                onClick={handleDelete}
                className="h-6 w-6 text-red-600 hover:cursor-pointer"
              />
            </Tooltip>
          ) : (
            <ReviewMintButton mint={mint} text="Add Review" />
          )}
        </Table.Cell>
      </Table.Row>
      {mint.inviteCodes && (
        <FediCodesModal
          inviteCodes={mint.inviteCodes!}
          show={showFediCodesModal}
          setShow={setShowFediCodesModal}
        />
      )}
    </>
  );
};

export default MintsRowItem;
