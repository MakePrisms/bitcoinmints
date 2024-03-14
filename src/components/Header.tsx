import Image from "next/image";
import { Button, Navbar } from "flowbite-react";
import ProfileButton from "./ProfileButton";

const Header = () => {
  return (
    <Navbar fluid rounded className="bg-gray-800">
      <Navbar.Brand>
        <Image src="/bitcoinmintslogo.png" alt="" width={350} height={350} className="mr-3"/>
      </Navbar.Brand>
      <div>
        <ProfileButton />
        {/* <Navbar.Toggle /> */}
      </div>
      {/* <Navbar.Collapse> */}
        {/* <Navbar.Nav>
          <Navbar.Item active>Home</Navbar.Item>
          <Navbar.Item>Features</Navbar.Item>
          <Navbar.Item>Services</Navbar.Item>
          <Navbar.Item>About</Navbar.Item>
          <Navbar.Item>Contact</Navbar.Item>
        </Navbar.Nav>
      </Navbar.Collapse> */}
    </Navbar>
  )
};

export default Header;