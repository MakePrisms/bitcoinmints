import { Tabs, Table, Button } from "flowbite-react";
import { useSelector } from "react-redux";
import { useEffect } from "react";
import NDK, { NDKEvent, NDKFilter } from "@nostr-dev-kit/ndk";
import { useNdk } from "@/hooks/useNdk";
import { Nip87Kinds } from "@/types";
import { RootState, useAppDispatch } from "@/redux/store";
import { addMintAsync, addMintEndorsementAsync } from "@/redux/slices/nip87Slice";
import NostrProfile from "@/components/NostrProfile";
import TableRowMint from "./TableRowMint";
import TableRowEndorsement from "./TableRowEndorsement";

const MintTable = () => {
  const dispatch = useAppDispatch();

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
      dispatch(addMintAsync({ event: event.rawEvent(), relay: event.relay!.url }))
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

  const { mints, endorsements } = useSelector(
    (state: RootState) => state.nip87
  );

  useEffect(() => {
    console.log("mints", mints);
    console.log("endorsements", endorsements);
  }, [mints, endorsements]);

  return (
    <Tabs className="w-full" style="fullWidth">
      <Tabs.Item title="Mints">
      <div className="overflow-x-auto overflow-y-auto max-h-screen">
        <Table className="overflow-x-auto">
          <Table.Head>
            <Table.HeadCell>Mint</Table.HeadCell>
            <Table.HeadCell>URL</Table.HeadCell>
            <Table.HeadCell>Supported Nuts</Table.HeadCell>
            <Table.HeadCell>
              <span className="sr-only">Review</span>
            </Table.HeadCell>
          </Table.Head>
          <Table.Body>
            {mints.map((mint, idx) => (
              <TableRowMint mint={mint} key={idx} />
            ))}
          </Table.Body>
        </Table>
        </div>
      </Tabs.Item>
      <Tabs.Item
        title="Reviews"
        className="focus:shadow-none focus:border-transparent"
      >
        <div className="overflow-x-auto overflow-y-auto max-h-screen">
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
              {endorsements.map((endorsement, idx) => (
                <TableRowEndorsement endorsement={endorsement} key={idx} />
              ))}
            </Table.Body>
          </Table>
        </div>
      </Tabs.Item>
    </Tabs>
  );
};

export default MintTable;
