import { useState } from "react";
import { getMintInfo } from "@/utils/cashu";
import { Button } from "flowbite-react";
import ListReviewModal from "./ListReviewModal";
import { nip87Info } from "@/utils/nip87";
import { useNdk } from "@/hooks/useNdk";
import { Nip87MintTypes } from "@/types";
import { useDispatch } from "react-redux";
import { addMint } from "@/redux/slices/nip87Slice";

const ListMintButton = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mintUrl, setMintUrl] = useState("");

  const { ndk } = useNdk();

  const dispatch = useDispatch();

  const handleModalClose = () => {
    setIsModalOpen(false);
  };

  const handleMintSubmit = async () => {
    console.log("mintUrl", mintUrl);
    try {
      const { supportedNuts, v0, v1, pubkey, name: mintName } = await getMintInfo(mintUrl);

      console.log("mintInfo", supportedNuts, v0, v1, pubkey);

      if (!pubkey)
        alert(
          "Your mint does not return a pubkey from the /info endpoint. You should add one and try again."
        );

      const mintInfoEvent = await nip87Info(ndk, Nip87MintTypes.Cashu, {
        mintPubkey: pubkey,
        mintUrl,
        supportedNuts,
      });

      console.log("mintInfoEvent", mintInfoEvent.rawEvent());
      await mintInfoEvent.publish();
      dispatch(addMint({ event: mintInfoEvent.rawEvent(), mintName }));
      handleModalClose();
    } catch (e) {
      console.error(e);
    }
  };
  return (
    <div>
      <Button onClick={() => setIsModalOpen(true)}>List a Mint</Button>
      <ListReviewModal
        show={isModalOpen}
        onClose={handleModalClose}
        handleSubmit={handleMintSubmit}
        mintUrl={mintUrl}
        setMintUrl={setMintUrl}
        type="claim"
      />
    </div>
  );
};

export default ListMintButton;
