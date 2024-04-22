import { Button, Modal } from "flowbite-react";
import { useRouter } from "next/router";
import { useState } from "react";

const CreateMintDisclaimer = () => {
  const [show, setShow] = useState(true);
  const router = useRouter();

  return (
    <Modal show={show} id="createMintDisclaimer" title="Create a Mint">
      <div className="flex items-start justify-between rounded-t border-b p-5 dark:border-gray-600">
        <h2 className="text-2xl">Warning!</h2>
      </div>
      <Modal.Body>
        <p>
          Insert disclaimer text here. This is a disclaimer for creating a mint.
        </p>
      </Modal.Body>
      <Modal.Footer className="flex justify-between">
        <Button
          onClick={() => router.push("/")}
          className="btn btn-secondary"
          color="failure"
        >
          I&apos;m scared
        </Button>
        <Button onClick={() => setShow(false)} className="btn btn-primary">
          I understand
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default CreateMintDisclaimer;
