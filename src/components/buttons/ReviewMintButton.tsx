import { Button } from "flowbite-react";
import { useNdk } from "@/hooks/useNdk";
import { useState } from "react";
import { getMintInfo } from "@/utils/cashu";
import ListReviewModal from "../modals/ListReviewModal";
import { Nip87MintInfo, Nip87ReccomendationData } from "@/types";
import { nip87Reccomendation } from "@/utils/nip87";
import { useDispatch, useSelector } from "react-redux";
import { addMintData, addReview } from "@/redux/slices/nip87Slice";
import { RootState } from "@/redux/store";

const ReviewMintButton = ({mint, text}: {mint?: Nip87MintInfo, text: string;}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mintUrl, setMintUrl] = useState(mint?.mintUrl || "");
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const reviews = useSelector((state: RootState) => state.nip87.reviews);
  const mintData = useSelector((state: RootState) => state.nip87.mints);
  const user = useSelector((state: RootState) => state.user);

  const dispatch = useDispatch();

  const { ndk } = useNdk();

  const handleModalClose = () => {
    setIsModalOpen(false);
    setIsProcessing(false);
    setMintUrl("");
    setRating(0);
    setReview("");
  };

  const handleModalSubmit = async () => {
    const exists = reviews.find((review) => `${review.mintUrl}${review.userPubkey}` === `${mintUrl}${user.pubkey}`);


    if (exists) {
      alert("You already reviewed this mint");
      return;
    }
    
    setIsProcessing(true);
    let mintToReview: Nip87MintInfo | Nip87ReccomendationData;
    if (mint) {
      mintToReview = mint;
    } else if (mintData.find((mint) => mint.url === mintUrl)) {
      const {supportedNuts, name: mintName} = mintData.find((mint) => mint.url === mintUrl)!;
      mintToReview = {mintUrl, supportedNuts, mintName};
    } else {
      const mintData = await getMintInfo(mintUrl).then((res) => res).catch(() => {
        setIsProcessing(false);
        alert("Error: Could not find mint");
        throw new Error("Could not find mint");
      });
      dispatch(addMintData(mintData));
      const {supportedNuts, name: mintName} = mintData;

      mintToReview = { mintUrl, supportedNuts, mintName };
    }

    const reviewEvent = await nip87Reccomendation(ndk, mintToReview, rating, review);
    
    dispatch(addReview({ event: reviewEvent.rawEvent(), mintNameMap: [{mintUrl, mintName: mintToReview.mintName}]}))
    await reviewEvent.publish();
    handleModalClose();
  };

  return (
    <div>
      {
        user.pubkey ? (
          <Button onClick={() => setIsModalOpen(true)}>{text}</Button>
        ) : (
          <Button onClick={() => alert("You must be logged in to review a mint")}>{text}</Button>
        )
      }
      <ListReviewModal
        show={isModalOpen}
        onClose={handleModalClose}
        mintUrl={mint?.mintUrl ? mint?.mintUrl : mintUrl}
        setMintUrl={mint?.mintUrl ? () => {} : setMintUrl}
        handleSubmit={handleModalSubmit}
        type="review"
        rating={rating}
        setRating={setRating}
        review={review}
        setReview={setReview}
        isProcessing={isProcessing}
      />
    </div>
  );
};

export default ReviewMintButton;
