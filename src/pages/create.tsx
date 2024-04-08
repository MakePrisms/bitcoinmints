import { useState } from "react";
import { Inter } from "next/font/google";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Head from "next/head";
import { Button } from "flowbite-react";
import { useSelector } from "react-redux";
import { RootState } from "@/redux/store";
import { useNdk } from "@/hooks/useNdk";

const inter = Inter({ subsets: ["latin"] });

export default function Home() {
  const [nwcUri, setNwcUri] = useState("");
  const [mintData, setMintData] = useState("");
  const [mintUrl, setMintUrl] = useState("");

  const user = useSelector((state: RootState) => state.user);

  const { generateNip98Header } = useNdk();
  // const baseMintUrl = "http://localhost:5019";
  const baseMintUrl = "https://mint.bitcoinmints.com";

  const handleViewMints = async () => {
    if (!user.pubkey) {
      alert("Please login with a NIP07 extension");
      return;
    }

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
    setMintData(
      mints.map((mint: any, idx: number) => <div key={idx}>{mint.name}</div>)
    );
  };

  const handleCreateMint = async () => {
    if (!user.pubkey) {
      alert("Please login with a NIP07 extension");
      return;
    }

    const url = `${baseMintUrl}/mints`;
    const method = "POST";
    const nip98Header = await generateNip98Header(url, method, undefined);

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: nip98Header,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        description: "This is my first mint",
        longDescription: "This is my first mint, and it's awesome!",
        units: ["sat", "usd"],
        backend: {
          data: {
            uri: nwcUri,
          },
        },
        name: "My First Mint",
      }),
    });

    const mint = await response.json();
    console.log("mint", mint);

    if (mint.id) {
      setMintUrl(`${baseMintUrl}/${mint.id}`);
    }
  };

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
        <div>
          <Button onClick={handleViewMints}>View Mints</Button>
          <div>{mintData}</div>
        </div>
        <div>
          <div>
            <label htmlFor="">NWC For Mint Liquidity</label>
            <input
              type="text"
              className="text-black ml-2"
              placeholder="NWC URI"
              value={nwcUri}
              onChange={(e) => setNwcUri(e.target.value)}
            />
          </div>
          <Button onClick={handleCreateMint}>Create a Mint</Button>
          {mintUrl && <p>{mintUrl}</p>}
        </div>
      </main>
      <Footer />
    </>
  );
}
