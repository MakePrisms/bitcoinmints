import { useState } from "react";
import { Button, Table, Tooltip } from "flowbite-react";
import { HiTrash } from "react-icons/hi";
import { Nip87MintInfo } from "@/types";
import ListReviewModal from "./ListReviewModal";
import { nip87Reccomendation } from "@/utils/nip87";
import { useNdk } from "@/hooks/useNdk";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/redux/store";
import { deleteMintInfo } from "@/redux/slices/nip87Slice";
import ReviewMintButton from "./ReviewMintButton";
import { copyToClipboard, shortenString } from "@/utils";

const TableRowMint = ({ mint }: { mint: Nip87MintInfo }) => {
  const [show, setShow] = useState(false);

  const user = useSelector((state: RootState) => state.user);

  const { ndk, attemptDeleteEvent } = useNdk();

  const dispatch = useDispatch();

  const handleDelete = async () => {
    attemptDeleteEvent(mint.rawEvent);

    const mintInfoId = `${mint.mintUrl}${mint.appPubkey}`;
    dispatch(deleteMintInfo(mintInfoId));
  };

  const handleModalClose = () => {
    setShow(false);
  };

  const handleModalSubmit = async () => {
    const endorsement = await nip87Reccomendation(ndk, mint);
    console.log("endorsement", endorsement.rawEvent());
    await endorsement.publish();
    handleModalClose();
  };

  return (
    <>
      <Table.Row className="dark:bg-gray-800">
        <Table.Cell
          className="hover:cursor-pointer"
          onClick={() => copyToClipboard(mint.mintUrl)}
        >
          <Tooltip content="click to copy">
            {shortenString(mint.mintUrl)}
          </Tooltip>
        </Table.Cell>
        <Table.Cell>{mint.supportedNuts || "N/A"}</Table.Cell>
        <Table.Cell>
          {user.pubkey === mint.appPubkey ? (
            <Tooltip content="Attempt to delete">
              <HiTrash
                onClick={handleDelete}
                className="h-6 w-6 text-red-600 hover:cursor-pointer"
              />
            </Tooltip>
          ) : (
            <ReviewMintButton mint={mint} text="Review" />
          )}
        </Table.Cell>
      </Table.Row>
    </>
  );
};

export default TableRowMint;
