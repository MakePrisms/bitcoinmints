import { Button } from "flowbite-react";
import { useNdk } from "@/hooks/useNdk";
import { useState } from "react";
import { getMintInfo } from "@/utils/cashu";
import ListReviewModal from "./ListReviewModal";
import { Nip87MintInfo, Nip87ReccomendationData } from "@/types";
import { nip87Reccomendation } from "@/utils/nip87";
import { useDispatch, useSelector } from "react-redux";
import { addMintEndorsement } from "@/redux/slices/nip87Slice";
import { RootState } from "@/redux/store";

const ReviewMintButton = ({mint, text}: {mint?: Nip87MintInfo, text: string;}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mintUrl, setMintUrl] = useState(mint?.mintUrl || "");
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const reviews = useSelector((state: RootState) => state.nip87.endorsements);
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
    let mintToEndorse: Nip87MintInfo | Nip87ReccomendationData;
    if (mint) {
      mintToEndorse = mint;
    } else {
      const { supportedNuts, v0, v1, pubkey, name: mintName } = await getMintInfo(mintUrl).then((res) => res).catch(() => {
        setIsProcessing(false);
        alert("Error: Could not find mint");
        throw new Error("Could not find mint");
      });

      console.log("mintInfo", supportedNuts, v0, v1, pubkey)
      
      mintToEndorse = { mintUrl, supportedNuts, mintName };
    }

    const endorsement = await nip87Reccomendation(ndk, mintToEndorse, rating, review);
    console.log("endorsement", endorsement.rawEvent());
    dispatch(addMintEndorsement({ event: endorsement.rawEvent(), mintNameMap: [{mintUrl, mintName: mintToEndorse.mintName}]}))
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
        isProcessing={isProcessing}
      />
    </div>
  );
};

export default ReviewMintButton;
