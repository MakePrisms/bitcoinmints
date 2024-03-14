import { Button } from "flowbite-react";
import { useNdk } from "@/hooks/useNdk";
import { useState } from "react";
import { getMintInfo } from "@/utils/cashu";
import ClaimEndorseModal from "./ClaimEndorseModal";
import { Nip87MintInfo, Nip87MintTypes, Nip87ReccomendationData } from "@/types";
import { nip87Info, nip87Reccomendation } from "@/utils/nip87";
import { useDispatch } from "react-redux";
import { addMintEndorsement } from "@/redux/slices/nip87Slice";

const PostMintButton = ({mint}: {mint?: Nip87MintInfo}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mintUrl, setMintUrl] = useState("");
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
    <>
      <Button className="" onClick={() => setIsModalOpen(true)}>Endorse a Mint</Button>
      <ClaimEndorseModal
        show={isModalOpen}
        onClose={handleModalClose}
        mintUrl={mintUrl}
        setMintUrl={setMintUrl}
        handleSubmit={handleModalSubmit}
        type="endorse"
        rating={rating}
        setRating={setRating}
        review={review}
        setReview={setReview}
      />
    </>
  );
};

export default PostMintButton;
