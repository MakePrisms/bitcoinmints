import { useNdk } from "@/hooks/useNdk";
import { NDKUserProfile } from "@nostr-dev-kit/ndk";
import { Avatar } from "flowbite-react";
import { useEffect, useState } from "react";
import { nip19 } from "nostr-tools";

const NostrProfile = ({ pubkey }: { pubkey: string }) => {
  const { fetchUserProfile } = useNdk();

  const [profile, setProfile] = useState<NDKUserProfile>();

  useEffect(() => {
    fetchUserProfile(pubkey).then(setProfile);
  }, [pubkey, fetchUserProfile]);

  return (
    <a href={`https://njump.me/${nip19.npubEncode(pubkey)}`} target="_blank">
      <div className="flex flex-col items-start">
        <Avatar
          img={profile?.image}
          alt={profile?.name}
          size="sm"
          className="mb-1"
        />
        <div>
          <h3 className="text-sm font-semibold">{profile?.name || ""}</h3>
        </div>
      </div>
    </a>
  );
};

export default NostrProfile;
