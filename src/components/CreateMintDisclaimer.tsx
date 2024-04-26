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
        <p className="mb-3">
          Create Mint is in early BETA! We hold no responsibility for people
          losing access to funds. Use at your own risk!
        </p>
        <p className="mb-3">
          Create Mint is an experimental feature based on the Cashu and Nostr
          protocols which are still extremely early in development. This
          functionality will certainly change in the near future and mints will
          no longer work. Do not plan to use a mint for an extended period of
          time.
        </p>
        <p className="mb-3">
          Create Mint is non-custodial software - this software does not custody
          any bitcoin or any ecash tokens. This means if you lose access to your
          bitcoin or ecash tokens stored on your wallet, there is no way to
          recover them using our software.
        </p>
        <p>
          Terms of service can be found at{" "}
          <a
            className="text-cyan-400 underline"
            href="https://www.makeprisms.com/terms"
          >
            https://www.makeprisms.com/terms
          </a>
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
