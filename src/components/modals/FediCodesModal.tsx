import { BsClipboard2 } from "react-icons/bs";
import { Modal, List } from "flowbite-react";
import { shortenString, copyToClipboard } from "@/utils";

type FediCodesModalProps = {
  show: boolean;
  setShow: (show: boolean) => void;
  inviteCodes: string[];
};

const FediCodesModal = ({
  show,
  setShow,
  inviteCodes,
}: FediCodesModalProps) => {
  if (inviteCodes === undefined || inviteCodes.length === 0) return null;
  return (
    <Modal show={show} onClose={() => setShow(false)}>
      <Modal.Header>Invite Codes</Modal.Header>
      <Modal.Body>
        <List>
          {inviteCodes.map((code, i) => (
            <List.Item key={i} className="flex">
              {shortenString(code)}
              <BsClipboard2
                className="hover:cursor-pointer ml-1 mt-1"
                onClick={() => copyToClipboard(code)}
              />
            </List.Item>
          ))}
        </List>
      </Modal.Body>
    </Modal>
  );
};

export default FediCodesModal;
