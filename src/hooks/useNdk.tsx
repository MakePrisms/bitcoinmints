import { useContext, createContext, useState, useEffect, useRef } from "react";
import NDK, { NDKEvent, NDKKind, NDKSigner, NDKUserProfile, NostrEvent } from "@nostr-dev-kit/ndk";

interface NDKContextProps {
  ndk: NDK;
  setSigner: (signer: NDKSigner) => void;
  fetchUserProfile: (pubkey: string) => Promise<NDKUserProfile | undefined>;
  attemptDeleteEvent: (event: NostrEvent) => Promise<NDKEvent>;
}

const NDKContext = createContext<NDKContextProps>({
  ndk: new NDK(),
  setSigner: (signer: NDKSigner) => {},
  fetchUserProfile: async (pubkey: string): Promise<NDKUserProfile> =>
    ({} as NDKUserProfile),
  attemptDeleteEvent: async (event: NostrEvent): Promise<NDKEvent> =>
    ({} as NDKEvent),
});

const defaultRelays = [
  // "wss://relay.getalby.com/v1",
  // "wss://nostr.mutinywallet.com/",
  // "wss://relay.mutinywallet.com",
  // "wss://relay.damus.io",
  // "wss://relay.snort.social",
  "wss://relay.primal.net",
  "wss://nostr.drss.io",
  "wss://nostr.lorentz.is",
  "wss://nostr.stakey.net",
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

  const fetchUserProfile = async (pubkey: string) => {
    const user = ndk.current.getUser({ pubkey });
    await user.fetchProfile();
    return user.profile;
  };

  const attemptDeleteEvent = async (event: NostrEvent) => {
    const eventToDelete = new NDKEvent(ndk.current, event)
    const deleted = await eventToDelete.delete("Deleted by user", true);
    console.log(deleted.rawEvent())
    return deleted;
  };

  const contextValue: NDKContextProps = {
    ndk: ndk.current,
    setSigner,
    fetchUserProfile,
    attemptDeleteEvent,
  };

  return (
    <NDKContext.Provider value={contextValue}>{children}</NDKContext.Provider>
  );
};

export const useNdk = () => useContext(NDKContext);
