import { Button } from "flowbite-react";
import { useNdk } from "@/hooks/useNdk";
import { useState } from "react";
import { getMintInfo } from "@/utils/cashu";
import ListReviewModal from "./ListReviewModal";
import { Nip87MintInfo, Nip87ReccomendationData } from "@/types";
import { nip87Reccomendation } from "@/utils/nip87";
import { useDispatch } from "react-redux";
import { addMintEndorsement } from "@/redux/slices/nip87Slice";

const ReviewMintButton = ({mint, text}: {mint?: Nip87MintInfo, text: string;}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mintUrl, setMintUrl] = useState(mint?.mintUrl || "");
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState("");

  const dispatch = useDispatch();

  const { ndk } = useNdk();

  const handleModalClose = () => {
    setIsModalOpen(false);
  };

  const handleModalSubmit = async () => {
    let mintToEndorse: Nip87MintInfo | Nip87ReccomendationData;
    if (mint) {
      mintToEndorse = mint;
    } else {
      const { supportedNuts, v0, v1, pubkey } = await getMintInfo(mintUrl);

      console.log("mintInfo", supportedNuts, v0, v1, pubkey)
      
      mintToEndorse = { mintUrl, supportedNuts };
    }
    const endorsement = await nip87Reccomendation(ndk, mintToEndorse, rating, review);
    console.log("endorsement", endorsement.rawEvent());
    dispatch(addMintEndorsement({ event: endorsement.rawEvent()}))
    await endorsement.publish();
    handleModalClose();
  };

  const handleSubmit = async () => {
    try {
      const { supportedNuts, v0, v1 } = await getMintInfo(mintUrl);
      handleModalClose();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div>
      <Button className="" onClick={() => setIsModalOpen(true)}>{text}</Button>
      <ListReviewModal
        show={isModalOpen}
        onClose={handleModalClose}
        mintUrl={mintUrl}
        setMintUrl={setMintUrl}
        handleSubmit={handleModalSubmit}
        type="review"
        rating={rating}
        setRating={setRating}
        review={review}
        setReview={setReview}
      />
    </div>
  );
};

export default ReviewMintButton;
