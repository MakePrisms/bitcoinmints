import { useDispatch, useSelector } from "react-redux";
import { List, Modal, Rating, Table, Tooltip } from "flowbite-react";
import { HiTrash } from "react-icons/hi";
import { BsClipboard2, BsClipboard2CheckFill } from "react-icons/bs";
import NostrProfile from "../NostrProfile";
import { Nip87MintReccomendation, Nip87MintTypes } from "@/types";
import { RootState } from "@/redux/store";
import { useNdk } from "@/hooks/useNdk";
import { deleteReview } from "@/redux/slices/nip87Slice";
import { copyToClipboard, shortenString } from "@/utils";
import { useEffect, useState } from "react";
import FediCodesModal from "../modals/FediCodesModal";

const ReviewCell = ({ review }: { review?: string }) => {
  const [shortened, setShortened] = useState(true);
  const [maxChars, setMaxChars] = useState(50);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setMaxChars(50);
      } else if (window.innerWidth < 1024) {
        setMaxChars(100);
      } else {
        setMaxChars(150);
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (review && review.length > maxChars) {
    return (
      <>
        <div>
          {shortened ? review.slice(0, maxChars) + "..." : review}
          &nbsp;
          <span
            className="text-blue-500 hover:cursor-pointer"
            onClick={() => setShortened(!shortened)}
          >
            {shortened ? "more" : "less"}
          </span>
        </div>
      </>
    );
  } else {
    return <div>{review ? review : "N/A"}</div>;
  }
};

const ReviewsRowItem = ({ review }: { review: Nip87MintReccomendation }) => {
  const [copied, setCopied] = useState(false);
  const user = useSelector((state: RootState) => state.user);
  const [showFediCodesModal, setShowFediCodesModal] = useState(false);

  const dispatch = useDispatch();

  const { attemptDeleteEvent } = useNdk();

  const handleDelete = async () => {
    attemptDeleteEvent(review.rawEvent);

    const reviewId = `${review.mintUrl}${review.userPubkey}`;
    dispatch(deleteReview(reviewId));
  };

  const handleCopy = () => {
    if (!review.mintUrl && review.mintType === Nip87MintTypes.Fedimint) {
      setShowFediCodesModal(true);
    }
    if (review.mintUrl) {
      copyToClipboard(review.mintUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  return (
    <>
      <Table.Row className="dark:bg-gray-800">
        <Table.Cell>
          <NostrProfile pubkey={review.userPubkey} />
        </Table.Cell>
        <Table.Cell className="hover:cursor-pointer " onClick={handleCopy}>
          <div className="flex">
            {review.mintName}
            {copied ? (
              <BsClipboard2CheckFill className="ml-1 mt-1" size={15} />
            ) : (
              <BsClipboard2 className="ml-1 mt-1" size={15} />
            )}
          </div>
        </Table.Cell>
        <Table.Cell>
          {review.rating ? (
            <Rating>
              {Array.from({ length: 5 }).map((_, i) => (
                <Rating.Star key={i} filled={i < review.rating!} />
              ))}
            </Rating>
          ) : (
            "N/A"
          )}
        </Table.Cell>
        <Table.Cell className="min-w-60">
          <ReviewCell review={review.review} />
        </Table.Cell>
        <Table.Cell>
          {user.pubkey === review.userPubkey && (
            <Tooltip content="Attempt to delete">
              <HiTrash
                onClick={handleDelete}
                className="h-6 w-6 text-red-600 hover:cursor-pointer"
              />
            </Tooltip>
          )}
        </Table.Cell>
      </Table.Row>
      <FediCodesModal inviteCodes={review.inviteCodes!} show={showFediCodesModal} setShow={setShowFediCodesModal}/>
    </>
  );
};

export default ReviewsRowItem;
