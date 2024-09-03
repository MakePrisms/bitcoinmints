import { Button } from "flowbite-react";
import { useNdk } from "@/hooks/useNdk";
import { useState } from "react";
import { getMintInfo } from "@/utils/cashu";
import ListReviewModal from "../modals/ListReviewModal";
import {
  Nip87Kinds,
  Nip87MintInfo,
  Nip87MintTypes,
  Nip87ReccomendationData,
} from "@/types";
import { nip87Reccomendation } from "@/utils/nip87";
import { useDispatch, useSelector } from "react-redux";
import { addMintData, addReview } from "@/redux/slices/nip87Slice";
import { RootState } from "@/redux/store";

const ReviewMintButton = ({
  mint,
  text,
}: {
  mint?: Nip87MintInfo;
  text: string;
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mintUrl, setMintUrl] = useState(mint?.mintUrl || "");
  const [mintPubkey, setMintPubkey] = useState(mint?.mintPubkey || "");
  const [inviteCodes, setInviteCodes] = useState<string[]>(
    mint?.inviteCodes || []
  );
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const reviews = useSelector((state: RootState) => state.nip87.reviews);
  const mintData = useSelector((state: RootState) => state.nip87.mints);
  const user = useSelector((state: RootState) => state.user);

  let mintType: Nip87MintTypes =
    mint?.rawEvent.kind === Nip87Kinds.FediInfo || (mintPubkey && !mintUrl)
      ? Nip87MintTypes.Fedimint
      : Nip87MintTypes.Cashu;

  const dispatch = useDispatch();

  const { ndk } = useNdk();

  const handleModalClose = () => {
    setIsModalOpen(false);
    setIsProcessing(false);
    setMintUrl("");
    setRating(0);
    setReview("");
    setInviteCodes([]);
    setMintPubkey("");
  };

  const handleModalSubmit = async () => {
    const exists = reviews.find((review) => {
      if (
        `${review.mintUrl}${review.userPubkey}` === `${mintUrl}${user.pubkey}`
      ) {
        return true;
      }
      if (
        `${review.mintPubkey}${review.userPubkey}` ===
        `${mintPubkey}${user.pubkey}`
      ) {
        return true;
      }
      if (
        review.mintPubkey !== undefined &&
        mint?.mintPubkey !== undefined &&
        `${review.mintPubkey}${review.userPubkey}` ===
          `${mint?.mintPubkey}${user.pubkey}`
      ) {
        return true;
      }
      return false;
    });

    if (exists) {
      alert("You already reviewed this mint");
      return;
    }

    setIsProcessing(true);
    let mintToReview: Nip87MintInfo | Nip87ReccomendationData;

    if (mint) {
      mintToReview = mint;
    } else if (mintPubkey && !mintUrl) {
      // this means the mint is a fedimint mint
      mintType = Nip87MintTypes.Fedimint;
      const mintName = `Fedimint ${mintPubkey.slice(0, 3)}...${mintPubkey.slice(
        -3
      )}`;
      mintToReview = {
        inviteCodes: inviteCodes,
        supportedNuts: "undefined",
        mintName,
        mintPubkey,
      };
    } else if (mintData.find((mint) => mint.url === mintUrl)) {
      const { supportedNuts, name: mintName } = mintData.find(
        (mint) => mint.url === mintUrl
      )!;
      mintToReview = { mintUrl, supportedNuts, mintName };
    } else {
      const mintData = await getMintInfo(mintUrl)
        .then((res) => res)
        .catch(() => {
          setIsProcessing(false);
          alert("Error: Could not find mint");
          throw new Error("Could not find mint");
        });
      dispatch(addMintData(mintData));
      const { supportedNuts, name: mintName } = mintData;

      mintToReview = { mintUrl, supportedNuts, mintName };
    }

    const reviewEvent = await nip87Reccomendation(
      ndk,
      mintToReview,
      mintType,
      rating,
      review
    );

    dispatch(
      addReview({
        event: reviewEvent.rawEvent(),
        mintNameMap: [
          {
            mintUrl: mintToReview.mintUrl || "",
            mintName: mintToReview.mintName,
            inviteCodes: mintToReview.inviteCodes || [],
          },
        ],
      })
    );
    await reviewEvent.publish();
    console.log("Review event", reviewEvent.rawEvent());
    handleModalClose();
  };

  return (
    <div>
      {user.pubkey ? (
        <Button onClick={() => setIsModalOpen(true)}>{text}</Button>
      ) : (
        <Button onClick={() => alert("You must be logged in to review a mint")}>
          {text}
        </Button>
      )}
      <ListReviewModal
        show={isModalOpen}
        onClose={handleModalClose}
        mintType={mintType}
        mintPubkey={mint?.mintPubkey ? mint?.mintPubkey : mintPubkey}
        setMintPubkey={mint?.mintPubkey ? () => {} : setMintPubkey}
        mintUrl={mint?.mintUrl ? mint?.mintUrl : mintUrl}
        setMintUrl={mint?.mintUrl ? () => {} : setMintUrl}
        handleSubmit={handleModalSubmit}
        type="review"
        rating={rating}
        setRating={setRating}
        review={review}
        setReview={setReview}
        isProcessing={isProcessing}
        // inviteCodes={mint?.inviteCodes ? mint?.inviteCodes : inviteCodes}
        // setInviteCodes={mint?.inviteCodes ? () => {} : setInviteCodes}
        inviteCode=""
        setInviteCode={() => {}}
      />
    </div>
  );
};

export default ReviewMintButton;
