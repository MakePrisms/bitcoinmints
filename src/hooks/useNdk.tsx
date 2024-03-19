import { useContext, createContext, useState, useEffect, useRef } from "react";
import NDK, { NDKEvent, NDKKind, NDKSigner, NDKUserProfile, NostrEvent } from "@nostr-dev-kit/ndk";

interface NDKContextProps {
  ndk: NDK;
  setSigner: (signer: NDKSigner) => void;
  removeSigner: () => void;
  fetchUserProfile: (pubkey: string) => Promise<NDKUserProfile | undefined>;
  fetchFollowingPubkeys: (pubkey: string) => Promise<string[]>;
  attemptDeleteEvent: (event: NostrEvent) => Promise<NDKEvent>;
}

const NDKContext = createContext<NDKContextProps>({
  ndk: new NDK(),
  setSigner: (signer: NDKSigner) => {},
  removeSigner: () => {},
  fetchUserProfile: async (pubkey: string): Promise<NDKUserProfile> =>
    ({} as NDKUserProfile),
  fetchFollowingPubkeys: async (pubkey: string): Promise<string[]> => [],
  attemptDeleteEvent: async (event: NostrEvent): Promise<NDKEvent> =>
    ({} as NDKEvent),
});

const defaultRelays = [
  "wss://nostr.mutinywallet.com/",
  "wss://relay.damus.io",
  "wss://relay.snort.social",
  "wss://relay.primal.net",
  "wss://bitcoiner.social",
  "wss://relay.satoshidnc.com",
  "wss://nos.lol"
];

export const NDKProvider = ({ children }: any) => {
  const ndk = useRef(new NDK({ explicitRelayUrls: defaultRelays }));

  useEffect(() => {
    ndk.current
      .connect()
      .then(() => {
        console.log("Connected to NDK");
      })
      .catch((e) => {
        console.error(e);
      });
  });

  const setSigner = (signer: NDKSigner) => {
    ndk.current.signer = signer;
    ndk.current.assertSigner();
  };

  const removeSigner = () => {
    ndk.current.signer = undefined;
  }

  const fetchUserProfile = async (pubkey: string) => {
    const user = ndk.current.getUser({ pubkey });
    await user.fetchProfile();
    return user.profile;
  };

  const fetchFollowingPubkeys = async (pubkey: string) => {
    const user = ndk.current.getUser({ pubkey });
    const following = await user.follows({ closeOnEose: false})
    return Array.from(following).map((user) => user.pubkey);
  }

  const attemptDeleteEvent = async (event: NostrEvent) => {
    const eventToDelete = new NDKEvent(ndk.current, event)
    const deleted = await eventToDelete.delete("Deleted by user", true);
    console.log(deleted.rawEvent())
    return deleted;
  };

  const contextValue: NDKContextProps = {
    ndk: ndk.current,
    setSigner,
    removeSigner,
    fetchUserProfile,
    fetchFollowingPubkeys,
    attemptDeleteEvent,
  };

  return (
    <NDKContext.Provider value={contextValue}>{children}</NDKContext.Provider>
  );
};

export const useNdk = () => useContext(NDKContext);
