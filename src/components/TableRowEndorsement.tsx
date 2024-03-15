import { useDispatch, useSelector } from "react-redux";
import { Rating, Table, Tooltip } from "flowbite-react";
import { HiTrash } from "react-icons/hi";
import NostrProfile from "./NostrProfile";
import { Nip87MintReccomendation } from "@/types";
import { RootState } from "@/redux/store";
import { useNdk } from "@/hooks/useNdk";
import { deleteMintEndorsement } from "@/redux/slices/nip87Slice";
import { copyToClipboard, shortenString } from "@/utils";

const TableRowEndorsement = ({
  endorsement,
}: {
  endorsement: Nip87MintReccomendation;
}) => {
  const user = useSelector((state: RootState) => state.user);

  const dispatch = useDispatch();

  const { attemptDeleteEvent } = useNdk();

  const handleDelete = async () => {
    attemptDeleteEvent(endorsement.rawEvent);

    const endorsementId = `${endorsement.mintUrl}${endorsement.userPubkey}`;
    dispatch(deleteMintEndorsement(endorsementId));
  };

  return (
    <Table.Row className="dark:bg-gray-800">
      <Table.Cell>
        <NostrProfile pubkey={endorsement.userPubkey} />
      </Table.Cell>
      <Table.Cell
        className="hover:cursor-pointer"
        onClick={() => copyToClipboard(endorsement.mintUrl)}
      >
        <Tooltip content="click to copy">
          {shortenString(endorsement.mintUrl)}
        </Tooltip>
      </Table.Cell>
      <Table.Cell>
        {endorsement.rating ? (
          <Rating>
            {Array.from({ length: 5 }).map((_, i) => (
              <Rating.Star key={i} filled={i < endorsement.rating!} />
            ))}
          </Rating>
        ) : (
          "N/A"
        )}
      </Table.Cell>
      <Table.Cell>{endorsement.review || "N/A"}</Table.Cell>
      <Table.Cell>
        {user.pubkey === endorsement.userPubkey && (
          <Tooltip content="Attempt to delete">
            <HiTrash
              onClick={handleDelete}
              className="h-6 w-6 text-red-600 hover:cursor-pointer"
            />
          </Tooltip>
        )}
      </Table.Cell>
    </Table.Row>
  );
};

export default TableRowEndorsement;
