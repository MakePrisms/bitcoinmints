import { useNdk } from "@/hooks/useNdk";
import { CreateMintRequest, CreateMintResponse } from "@/types/bitcoinMintsApi";
import { copyToClipboard, shortenString } from "@/utils";
import {
  Button,
  Checkbox,
  Label,
  Modal,
  ModalHeader,
  Spinner,
  TextInput,
  Textarea,
  ToggleSwitch,
  Tooltip,
} from "flowbite-react";
import { useState } from "react";
import { BsClipboard2, BsClipboard2CheckFill } from "react-icons/bs";

type CreateMintModalProps = {
  mintProviderUrl: string;
  show: boolean;
  handleClose: () => void;
};

const CreateMintModal = ({
  mintProviderUrl,
  show,
  handleClose,
}: CreateMintModalProps) => {
  const [nwcUri, setNwcUri] = useState("");
  const [usdToggle, setUsdToggle] = useState(false);
  const [satToggle, setSatToggle] = useState(false);
  const [mintName, setMintName] = useState("");
  const [description, setDescription] = useState("");
  const [longDescription, setLongDescription] = useState("");
  const [mintData, setMintData] = useState<
    (CreateMintResponse & { url: string }) | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const { generateNip98Header } = useNdk();

  const construtCurrencyArray = () => {
    const currencies = [];

    if (usdToggle) {
      currencies.push("usd");
    }

    if (satToggle) {
      currencies.push("sat");
    }

    return currencies;
  };

  const buildPostMintAuthHeader = async () => {
    const url = `${mintProviderUrl}/mints`;
    const method = "POST";
    const nip98Header = await generateNip98Header(url, method, undefined);

    return nip98Header;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!nwcUri || !mintName || !description) {
      alert("Please fill out all required fields.");
      return;
    }

    if (!usdToggle && !satToggle) {
      alert("Please select at least one currency.");
      return;
    }

    const createMintPayload: CreateMintRequest = {
      name: mintName,
      units: construtCurrencyArray(),
      backend: {
        data: {
          uri: nwcUri,
        },
      },
      description,
      longDescription: longDescription || description,
    };

    setLoading(true);

    const authHeader = await buildPostMintAuthHeader();

    const response = await fetch(`${mintProviderUrl}/mints`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createMintPayload),
    });

    if (!response.ok) {
      alert(`Failed to create mint. ${response.statusText}`);
      setLoading(false);
      return;
    }

    const mint = await response.json();

    setLoading(false);
    setMintData({ ...mint, url: `${mintProviderUrl}/${mint.id}` });

    console.log("NEW MINT", mint);
  };

  const handleCopy = () => {
    if (!mintData) {
      return;
    }
    copyToClipboard(mintData.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <Modal show={show} onClose={handleClose}>
      <Modal.Header>
        <h3 className="text-2xl font-medium">Create a Mint</h3>
      </Modal.Header>
      <Modal.Body>
        {!mintData ? (
          <form
            className="flex max-w-md flex-col gap-4"
            onSubmit={handleSubmit}
          >
            <div>
              <div className="mb-2 block">
                <Label htmlFor="nwcUri" value="NWC URI" />
              </div>
              <TextInput
                value={nwcUri}
                onChange={(e) => setNwcUri(e.target.value)}
                id="nwcUri"
                placeholder="nostr+walletconnect://a30f..."
                required
                helperText="This will be used to provide liquidity to your mint."
              />
            </div>
            <div className="gap-2 flex flex-col items-start">
              <div className="mb-2 block">
                <Label value="Supported Currencies" />
              </div>
              <ToggleSwitch
                checked={usdToggle}
                label="USD"
                onChange={setUsdToggle}
              />
              <div className="flex items-center gap-2">
                <ToggleSwitch
                  checked={satToggle}
                  label="Sats"
                  onChange={setSatToggle}
                />
              </div>
            </div>
            <div>
              <div className="mb-2 block">
                <Label value="Mint Name" />
              </div>
              <TextInput
                value={mintName}
                onChange={(e) => setMintName(e.target.value)}
                id="mintName"
                placeholder="My First Mint"
                required
                helperText="The name that wallets will display for your mint."
              />
            </div>
            <div>
              <div className="mb-2 block">
                <Label value="Description" />
              </div>
              <TextInput
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                id="description"
                placeholder="This is my first mint"
                required
                helperText="A short description of your mint."
              />
            </div>
            <div>
              <div className="mb-2 block">
                <Label value="Long Description" />
              </div>
              <Textarea
                value={longDescription}
                onChange={(e) => setLongDescription(e.target.value)}
                id="longDescription"
                placeholder="This is my first mint, and it's awesome!"
                helperText="(Optional) A longer description of your mint."
              />
            </div>
            <div className="flex justify-end">
              <Button isProcessing={loading} type="submit">
                Create Mint
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col items-start justify-center">
            <h3 className="text-xl font-medium">Mint Created!</h3>
            <div className="mt-4">
              {/* Mint URL */}
              <div className="flex items-center space-x-2">
                <strong className="mr-1">Mint URL:</strong>
                <Tooltip content={mintData.url}>
                  <div
                    onClick={handleCopy}
                    className="flex items-center hover:cursor-pointer py-1"
                  >
                    <span className="text-blue-500 text-lg break-all mr-2">
                      {shortenString(mintData.url)}
                    </span>
                    {copied ? (
                      <BsClipboard2CheckFill
                        className="text-green-500"
                        size={20}
                      />
                    ) : (
                      <BsClipboard2 className="text-gray-500" size={20} />
                    )}
                  </div>
                </Tooltip>
              </div>
              {/* Description */}
              <p className="mt-2 text-gray-400">
                Your mint can now be added to a wallet with this URL!
              </p>
              {/* Mint Details */}
              <div className="mt-4">
                <p className="font-medium">Supported Currencies:</p>
                <p className=" text-gray-400">
                  {construtCurrencyArray().join(", ")}
                </p>
              </div>
              <div className="mt-4">
                <p className="font-medium">Mint Name:</p>
                <p className="text-gray-400">{mintData.name}</p>
              </div>
              <div className="mt-2">
                <p className=" font-medium">Mint Description:</p>
                <p className=" text-gray-400">{mintData.description}</p>
              </div>
            </div>
            <div className="flex justify-end min-w-full">
              <Button
                color="success"
                onClick={() => {
                  handleCopy();
                  handleClose();
                }}
                className="mt-4"
              >
                Copy & Close
              </Button>
            </div>
          </div>
        )}
      </Modal.Body>
    </Modal>
  );
};

export default CreateMintModal;
