/* eslint-disable @next/next/no-img-element */
import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { NDKNip07Signer, NDKUserProfile } from "@nostr-dev-kit/ndk";
import { useNdk } from "@/hooks/useNdk";
import { RootState } from "@/redux/store";
import { setUser } from "@/redux/slices/UserSlice";
import { Avatar, Button, Dropdown, Navbar } from "flowbite-react";

const Header = () => {
  const [loggedIn, setLoggedIn] = useState(false);
  const [profile, setProfile] = useState<NDKUserProfile>();

  const dipsatch = useDispatch();

  const { setSigner, removeSigner, fetchUserProfile } = useNdk();

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
    removeSigner();
  };

  const handleLogin = async () => {
    if (!window.nostr) {
      alert("Nip07 extension not found. Get an extenstion then try again: https://github.com/aljazceru/awesome-nostr?tab=readme-ov-file#nip-07-browser-extensions");
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
    <Navbar
      fluid
      className="bg-gradient-to-tr from-gray-800 to-gray-700 flex justify-around align-middle items-center"
    >
      <Navbar.Brand className="md:ml-6 w-2/3 md:w-1/3 md:my-1 lg:w-1/4">
        <img src="/bitcoinmintslogo.png" alt="" />
      </Navbar.Brand>
      <div className="flex justify-end md:order-2 md:mr-6">
        {loggedIn ? (
        <Dropdown arrowIcon={false} inline label={ <Avatar
          img={profile?.image}
          alt="Profile Picture"
          className="mr-3"
         />}>
          <Dropdown.Header>
            <span className="block truncate text-sm font-medium">
              {profile?.name || profile?.displayName || ""}
            </span>
          </Dropdown.Header>
          <Dropdown.Item onClick={handleLogout}>Sign out</Dropdown.Item>
        </Dropdown>
        ) : (
          <Button color="light" pill onClick={handleLogin}>
            Login
          </Button>
        )}
      </div>
    </Navbar>
  );
};

export default Header;
