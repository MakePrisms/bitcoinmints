import { useState } from "react";
import { getMintInfo } from "@/utils/cashu";
import { Button } from "flowbite-react";
import ListReviewModal from "../modals/ListReviewModal";
import { nip87Info } from "@/utils/nip87";
import { useNdk } from "@/hooks/useNdk";
import { MintData, Nip87MintTypes } from "@/types";
import { useDispatch, useSelector } from "react-redux";
import { addMint, addMintData } from "@/redux/slices/nip87Slice";
import { RootState } from "@/redux/store";

const ListMintButton = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mintUrl, setMintUrl] = useState("");
  const [mintPubkey, setMintPubkey] = useState("");
  const [inviteCodes, setInviteCodes] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const mints = useSelector((state: RootState) => state.nip87.mintInfos);
  const mintData = useSelector((state: RootState) => state.nip87.mints);
  const user = useSelector((state: RootState) => state.user);

  const { ndk } = useNdk();

  const dispatch = useDispatch();

  const handleModalClose = () => {
    setIsModalOpen(false);
    setIsProcessing(false);
    setMintUrl("");
    setInviteCodes([]);
    setMintPubkey("");
  };

  const handleListFedimint = async () => {
    const mintInfoEvent = await nip87Info(ndk, Nip87MintTypes.Fedimint, {
      mintPubkey,
      inviteCodes,
    });

    console.log("mintInfoEvent", mintInfoEvent.rawEvent());
    await mintInfoEvent.publish();
    let mintName = mintUrl;
    if (!mintUrl) {
      const fedId = mintInfoEvent.getMatchingTags("d")[0][1];
      mintName = `Fedimint ${fedId.slice(0, 3)}...${fedId.slice(-3)}`;
    }
    dispatch(addMint({ event: mintInfoEvent.rawEvent(), mintName }));
    handleModalClose();
  };

  const handleMintSubmit = async () => {
    const mintExists = mints.find((mint) => {
      if (mint.mintPubkey === mintPubkey) {
        return true;
      }
      return mint.mintUrl === mintUrl;
    });

    if (mintExists) {
      alert("Mint already listed");
      return;
    }

    setIsProcessing(true);

    if (!mintUrl && mintPubkey && inviteCodes) {
      return await handleListFedimint();
    }

    try {
      let mintToList: MintData;
      if (mintData.find((mint) => mint.url === mintUrl)) {
        mintToList = mintData.find((mint) => mint.url === mintUrl)!;
      } else {
        mintToList = await getMintInfo(mintUrl)
          .then((res) => res)
          .catch(() => {
            setIsProcessing(false);
            alert("Error: Could not find mint");
            throw new Error("Could not find mint");
          });
        dispatch(addMintData(mintToList));
      }
      const { supportedNuts, v0, v1, pubkey, name: mintName } = mintToList;

      if (!pubkey)
        alert(
          "Your mint does not return a pubkey from the /info endpoint. You should add one and try again, but you can continue without it.",
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
      {user.pubkey ? (
        <Button onClick={() => setIsModalOpen(true)}>List a Mint</Button>
      ) : (
        <Button onClick={() => alert("You must be logged in to review a mint")}>
          List a Mint
        </Button>
      )}
      <ListReviewModal
        show={isModalOpen}
        onClose={handleModalClose}
        handleSubmit={handleMintSubmit}
        mintUrl={mintUrl}
        setMintUrl={setMintUrl}
        type="claim"
        isProcessing={isProcessing}
        mintPubkey={mintPubkey}
        setMintPubkey={setMintPubkey}
        inviteCodes={inviteCodes}
        setInviteCodes={setInviteCodes}
      />
    </div>
  );
};

export default ListMintButton;
