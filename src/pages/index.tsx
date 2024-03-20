import { Inter } from "next/font/google";
import Header from "@/components/Header";
import ReviewMintButton from "@/components/ReviewMintButton";
import ListMintButton from "@/components/ListMintButton";
import MintTable from "@/components/MintTable";
import Footer from "@/components/Footer";
import Head from "next/head";

const inter = Inter({ subsets: ["latin"] });

export default function Home() {
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
        <div className="flex justify-around mb-6 md:mb-12 w-full">
          <ListMintButton />
          <ReviewMintButton text="Review a Mint" />
        </div>
        <MintTable />
      </main>
      <Footer />
    </>
  );
}
