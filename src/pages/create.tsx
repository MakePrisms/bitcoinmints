import { useEffect, useState } from "react";
import { Inter } from "next/font/google";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CreateMintModal from "@/components/modals/CreateMintModal";
import Head from "next/head";
import { Button, Spinner, Table } from "flowbite-react";
import { useSelector } from "react-redux";
import { RootState } from "@/redux/store";
import { useNdk } from "@/hooks/useNdk";
import {
  FetchMintsResponse,
  CreateMintResponse,
} from "@/types/bitcoinMintsApi";
import { copyToClipboard, shortenString } from "@/utils";
import { BsClipboard2, BsClipboard2CheckFill } from "react-icons/bs";
import CreateMintDisclaimer from "@/components/CreateMintDisclaimer";

const inter = Inter({ subsets: ["latin"] });

const baseMintUrl = "https://mint.bitcoinmints.com";

const MintDataRow = ({ mint }: { mint: CreateMintResponse }) => {
  const [copied, setCopied] = useState(false);

  const mintUrl = `${baseMintUrl}/${mint.id}`;

  const date = new Date(mint.createdAt);

  // Extract the year, month, and day from the Date object
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0"); // add 1 because months start from 0
  const day = date.getDate().toString().padStart(2, "0");

  // Format the date as YYYY-MM-DD
  const formattedDate = `${year}-${month}-${day}`;

  const handleCopy = () => {
    try {
      copyToClipboard(mintUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (e) {
      alert("Failed to copy mint URL");
    }
  };

  return (
    <Table.Row className="dark:bg-gray-800">
      <Table.Cell className="hover:cursor-pointer" onClick={handleCopy}>
        <div className="flex">
          {shortenString(mintUrl)}
          {copied ? (
            <BsClipboard2CheckFill className="ml-1 mt-1" size={15} />
          ) : (
            <BsClipboard2 className="ml-1 mt-1" size={15} />
          )}
        </div>
      </Table.Cell>
      <Table.Cell>{mint.name}</Table.Cell>
      <Table.Cell>{"N/A"}</Table.Cell>
      <Table.Cell>{formattedDate}</Table.Cell>
    </Table.Row>
  );
};

export default function Home() {
  const [mintData, setMintData] = useState<FetchMintsResponse | null>(null);
  const [showCreateMintModal, setShowCreateMintModal] = useState(false);
  const [loadingMints, setLoadingMints] = useState(false);

  const user = useSelector((state: RootState) => state.user);

  const { generateNip98Header } = useNdk();
  // const baseMintUrl = "http://localhost:5019";

  const handleOpenCreateMintModal = () => {
    if (!user.pubkey) {
      alert("Please login with a NIP07 extension");
      return;
    }

    setShowCreateMintModal(true);
  };

  const handleCloseCreateMintModal = () => {
    setShowCreateMintModal(false);
  };

  useEffect(() => {
    const fetchUserMints = async () => {
      if (!user.pubkey) {
        return;
      }

      setLoadingMints(true);

      const url = `${baseMintUrl}/mints`;
      const method = "GET";
      const nip98Header = await generateNip98Header(url, method, undefined);

      const response = await fetch(url, {
        method,
        headers: {
          Authorization: nip98Header,
        },
      });

      const mints = await response.json();
      console.log("mints", mints);
      setMintData(mints);

      setLoadingMints(false);
    };

    fetchUserMints();
  }, [user]);

  return (
    <>
      <Head>
        <title>Bitcoin Mints</title>
      </Head>
      <header>
        <Header />
      </header>
      <main
        className={`flex min-h-screen flex-col items-center justify-start md:px-24 md:py-12 py-6 ${inter.className}`}
      >
        <CreateMintDisclaimer />
        <Button className="mb-5" onClick={handleOpenCreateMintModal}>
          Create a Mint
        </Button>
        <CreateMintModal
          mintProviderUrl={baseMintUrl}
          show={showCreateMintModal}
          handleClose={handleCloseCreateMintModal}
        />
        <div className="w-full flex flex-col items-center">
          <h1 className="text-2xl font-bold underline mb-5 self-start ml-3">
            Your Mints
          </h1>
          <div className="overflow-x-auto w-full">
            <Table className="min-w-max">
              <Table.Head>
                <Table.HeadCell>URL</Table.HeadCell>
                <Table.HeadCell>Name</Table.HeadCell>
                <Table.HeadCell>Units</Table.HeadCell>
                <Table.HeadCell>Created</Table.HeadCell>
              </Table.Head>
              {!loadingMints ? (
                <Table.Body className="divide-y">
                  {mintData?.map((mint, idx) => (
                    <MintDataRow mint={mint} key={idx} />
                  ))}
                </Table.Body>
              ) : (
                <div className="flex flex-col items-center w-full mt-5">
                  <Spinner />
                  <p>Loading mints...</p>
                </div>
              )}
            </Table>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
