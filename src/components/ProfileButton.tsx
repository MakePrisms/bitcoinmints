import { useState, useEffect } from "react";
import { RootState } from "@/redux/store";
import { setUser } from "@/redux/slices/UserSlice";
import { Button, Avatar, Tooltip } from "flowbite-react";
import { useSelector, useDispatch } from "react-redux";
import { NDKNip07Signer, NDKUserProfile } from "@nostr-dev-kit/ndk";
import { useNdk } from "@/hooks/useNdk";

const ProfileButton = () => {
  const [loggedIn, setLoggedIn] = useState(false);
  const [profile, setProfile] = useState<NDKUserProfile>();

  const dipsatch = useDispatch();

  const { setSigner, fetchUserProfile } = useNdk();

  const user = useSelector((state: RootState) => state.user);

  useEffect(() => {
    if (user.pubkey) {
      setLoggedIn(true);
      fetchUserProfile(user.pubkey).then(setProfile);
    } else {
      setLoggedIn(false);
    }
  }, [user, fetchUserProfile]);

  useEffect(() => {
    const pubkey = window.localStorage.getItem("pubkey");
    if (pubkey) {
      dipsatch(setUser({ pubkey: pubkey }));
      setSigner(new NDKNip07Signer())
    }
  }, []);

  const handleLogout = () => {
    dipsatch(setUser({ pubkey: "" }));
    window.localStorage.removeItem("pubkey");
  };

  const handleLogin = async () => {
    if (!window.nostr) {
      alert("Nip07 extension not found");
      return;
    }
    try {
      const pubkey = await window.nostr.getPublicKey();
      if (pubkey) {
        dipsatch(setUser({ pubkey }));
        window.localStorage.setItem("pubkey", pubkey);
      } else {
        throw new Error("No pubkey");
      }
      setSigner(new NDKNip07Signer());
    } catch (e) {
      console.error(e);
      alert("Could not find nip07 extension");
    }
  };

  return (
    <>
      {loggedIn ? (
        <Tooltip content="Click to logout">
          <div className="hover:cursor-pointer">
            <Avatar
              img={profile?.image}
              alt="Profile Picture"
              className="mr-3"
              onClick={handleLogout}
            />
          </div>
        </Tooltip>
      ) : (
        <Button className="" onClick={handleLogin}>
          Login
        </Button>
      )}
    </>
  );
};

export default ProfileButton;
