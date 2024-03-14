import { useState } from "react";
import { getMintInfo } from "@/utils/cashu";
import { Button } from "flowbite-react";
import ClaimEndorseModal from "./ClaimEndorseModal";
import { nip87Info } from "@/utils/nip87";
import { useNdk } from "@/hooks/useNdk";
import { Nip87MintTypes } from "@/types";
import { useDispatch } from "react-redux";
import { addMint } from "@/redux/slices/nip87Slice";

const ClaimMintButton = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mintUrl, setMintUrl] = useState("");

  const { ndk } = useNdk();

  const dispatch = useDispatch();

  const handleModalClose = () => {
    setIsModalOpen(false);
  };

  const handleMintSubmit = async () => {
    console.log("mintUrl", mintUrl)
    try {
      const { supportedNuts, v0, v1, pubkey } = await getMintInfo(mintUrl);

      console.log("mintInfo", supportedNuts, v0, v1, pubkey)
      
      if (!pubkey) alert ("Your mint does not return a pubkey from the /info endpoint. You should add one and try again.")
      
      const mintInfoEvent = await nip87Info(ndk, Nip87MintTypes.Cashu, {
        mintPubkey: pubkey,
        mintUrl,
        supportedNuts,
      });

      console.log("mintInfoEvent", mintInfoEvent.rawEvent());
      await mintInfoEvent.publish();
      dispatch(addMint({ event: mintInfoEvent.rawEvent()}))
      handleModalClose();
    } catch (e) {
      console.error(e);
    }
  };
  return (
    <>
      <Button className="" onClick={() => setIsModalOpen(true)}>Claim a Mint</Button>
      <ClaimEndorseModal
        show={isModalOpen}
        onClose={handleModalClose}
        handleSubmit={handleMintSubmit}
        mintUrl={mintUrl}
        setMintUrl={setMintUrl}
        type="claim"
      />
    </>
  );
};

export default ClaimMintButton;
