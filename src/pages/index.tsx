import { Inter } from "next/font/google";
import Link from "next/link";
import Header from "@/components/Header";
import ReviewMintButton from "@/components/buttons/ReviewMintButton";
import ListMintButton from "@/components/buttons/ListMintButton";
import MainTable from "@/components/mainTable/MainTable";
import Footer from "@/components/Footer";
import Head from "next/head";
import { Button } from "flowbite-react";

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
          {/* <Link href={"/create"}>
            <Button>Create Mint</Button>
          </Link> */}
          <ReviewMintButton text="Review Mint" />
        </div>
        <MainTable />
      </main>
      <Footer />
    </>
  );
}
