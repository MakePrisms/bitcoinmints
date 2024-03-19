import { Tabs, Table, Pagination } from "flowbite-react";
import { useSelector } from "react-redux";
import { useEffect, useState } from "react";
import NDK, { NDKEvent, NDKFilter } from "@nostr-dev-kit/ndk";
import { useNdk } from "@/hooks/useNdk";
import { Nip87Kinds } from "@/types";
import { RootState, useAppDispatch } from "@/redux/store";
import {
  addMintInfosAsync,
  addMintEndorsementAsync,
} from "@/redux/slices/nip87Slice";
import NostrProfile from "@/components/NostrProfile";
import TableRowMint from "./TableRowMint";
import TableRowEndorsement from "./TableRowEndorsement";
import MintFilters from "./MintFilters";
import ReviewFilters from "./ReviewFilters";

const MintTable = () => {
  const [mintsPage, setMintsPage] = useState(1);
  const [reviewsPage, setReviewsPage] = useState(1);
  const dispatch = useAppDispatch();

  const maxPerPage = 10;

  const filters = useSelector((state: RootState) => state.filters);
  const following = useSelector((state: RootState) => state.user.following);

  const { ndk } = useNdk();

  useEffect(() => {
    if (!ndk) return;

    const mintSub = ndk.subscribe(
      {
        kinds: [Nip87Kinds.CashuInfo],
      } as unknown as NDKFilter,
      { closeOnEose: false }
    );

    const endorsementSub = ndk.subscribe(
      {
        kinds: [Nip87Kinds.Reccomendation],
      } as unknown as NDKFilter,
      { closeOnEose: false }
    );

    mintSub.on("event", (event: NDKEvent) => {
      dispatch(
        addMintInfosAsync({ event: event.rawEvent(), relay: event.relay!.url })
      );
    });

    endorsementSub.on("event", (event: NDKEvent) => {
      dispatch(
        addMintEndorsementAsync({
          event: event.rawEvent(),
          infoEventRelay: undefined,
        })
      );
    });
  }, [ndk, dispatch]);

  const { mintInfos, endorsements } = useSelector(
    (state: RootState) => state.nip87
  );

  useEffect(() => {
    console.log("mints", mintInfos);
    console.log("endorsements", endorsements);
  }, [mintInfos, endorsements]);

  return (
    <div className="w-full">
      <Tabs style="fullWidth">
        <Tabs.Item title="Mints">
          <div className="overflow-x-auto max-h-screen">
            <Table className="overflow-x-auto">
              <Table.Head>
                <Table.HeadCell>Mint</Table.HeadCell>
                <Table.HeadCell>Avg. Rating</Table.HeadCell>
                <Table.HeadCell>URL</Table.HeadCell>
                <Table.HeadCell>Supported Nuts</Table.HeadCell>
                <Table.HeadCell>
                  <span className="sr-only">Review</span>
                </Table.HeadCell>
              </Table.Head>
              <Table.Body>
                {mintInfos
                  .slice(
                    mintsPage * maxPerPage - maxPerPage,
                    mintsPage * maxPerPage
                  )
                  .map((mint, idx) => (
                    <TableRowMint mint={mint} key={idx} />
                  ))}
              </Table.Body>
            </Table>
          </div>
          <div className="flex justify-center">
            {mintInfos.length / maxPerPage > 1 && (
              <Pagination
                currentPage={mintsPage}
                onPageChange={(page) => setMintsPage(page)}
                totalPages={Math.ceil(mintInfos.length / maxPerPage)}
              />
            )}
          </div>
        </Tabs.Item>
        <Tabs.Item
          title="Reviews"
          className="focus:shadow-none focus:border-transparent"
        >
          <div className="overflow-x-auto max-h-screen">
            <Table className="w-full">
              <Table.Head className="">
                <Table.HeadCell>Rated By</Table.HeadCell>
                <Table.HeadCell>Mint</Table.HeadCell>
                <Table.HeadCell>Rating</Table.HeadCell>
                <Table.HeadCell>Review</Table.HeadCell>
                <Table.HeadCell>
                  <span className="sr-only">Review or Delete</span>
                </Table.HeadCell>
              </Table.Head>
              <Table.Body className="divide-y">
                {endorsements
                  .slice(
                    reviewsPage * maxPerPage - maxPerPage,
                    reviewsPage * maxPerPage
                  )
                  .map((endorsement, idx) => (
                    <TableRowEndorsement endorsement={endorsement} key={idx} />
                  ))}
              </Table.Body>
            </Table>
          </div>
          <div className="flex justify-center">
            <Pagination
              currentPage={reviewsPage}
              onPageChange={(page) => setReviewsPage(page)}
              totalPages={Math.ceil(endorsements.length / maxPerPage)}
            />
          </div>
        </Tabs.Item>
      </Tabs>
    </div>
  );
};

export default MintTable;
