import { Inter } from "next/font/google";
import Header from "@/components/Header";
import PostMintButton from "@/components/PostMintButton";
import ClaimMintButton from "@/components/ClaimMintButton";
import MintTable from "@/components/MintTable";

const inter = Inter({ subsets: ["latin"] });

export default function Home() {
  return (
    <>
      <header>
        <Header />
      </header>
      <main
        className={`flex min-h-screen flex-col items-center justify-between p-24 ${inter.className}`}
      >
        <MintTable />
        <div className="flex">
          <ClaimMintButton />
          <PostMintButton />
        </div>
      </main>
    </>
  );
}
