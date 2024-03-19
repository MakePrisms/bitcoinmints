import { useDispatch, useSelector } from "react-redux";
import { Rating, Table, Tooltip } from "flowbite-react";
import { HiTrash } from "react-icons/hi";
import { BsClipboard2, BsClipboard2CheckFill } from "react-icons/bs";
import NostrProfile from "./NostrProfile";
import { Nip87MintReccomendation } from "@/types";
import { RootState } from "@/redux/store";
import { useNdk } from "@/hooks/useNdk";
import { deleteMintEndorsement } from "@/redux/slices/nip87Slice";
import { copyToClipboard } from "@/utils";
import { useEffect, useState } from "react";

const ReviewCell = ({ review }: { review?: string }) => {
  const [shortened, setShortened] = useState(true);
  const [maxChars, setMaxChars] = useState(50);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setMaxChars(50);
      } else if (window.innerWidth < 1024) {
        setMaxChars(100);
      } else {
        setMaxChars(150);
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize()

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (review && review.length > maxChars) {
    return (
      <>
        <div>
          {shortened ? review.slice(0, maxChars) + "..." : review}
          &nbsp;
        <span
          className="text-blue-500 hover:cursor-pointer"
          onClick={() => setShortened(!shortened)}
        >
          {shortened ? "more" : "less"}
        </span>
        </div>
      </>
    );
  } else {
    return <div>{review ? review : "N/A"}</div>;
  }
};

const TableRowEndorsement = ({
  endorsement,
}: {
  endorsement: Nip87MintReccomendation;
}) => {
  const [copied, setCopied] = useState(false);
  const user = useSelector((state: RootState) => state.user);

  const dispatch = useDispatch();

  const { attemptDeleteEvent } = useNdk();

  const handleDelete = async () => {
    attemptDeleteEvent(endorsement.rawEvent);

    const endorsementId = `${endorsement.mintUrl}${endorsement.userPubkey}`;
    dispatch(deleteMintEndorsement(endorsementId));
  };

  const handleCopy = () => {
    copyToClipboard(endorsement.mintUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <Table.Row className="dark:bg-gray-800">
      <Table.Cell>
        <NostrProfile pubkey={endorsement.userPubkey} />
      </Table.Cell>
      <Table.Cell className="hover:cursor-pointer " onClick={handleCopy}>
        <div className="flex">
          {endorsement.mintName}
          {copied ? (
            <BsClipboard2CheckFill className="ml-1 mt-1" size={15} />
          ) : (
            <BsClipboard2 className="ml-1 mt-1" size={15} />
          )}
        </div>
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
      <Table.Cell className="min-w-60"><ReviewCell review={endorsement.review}/></Table.Cell>
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
