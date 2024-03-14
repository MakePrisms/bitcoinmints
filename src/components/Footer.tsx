import { Footer as FlowbiteFooter } from "flowbite-react";

const Footer = () => {
  return (
    <FlowbiteFooter container>
      <div className="w-full text-center">
        <div className="w-full md:justify-around flex md:flex-row flex-col sm:items-center justify-between">
          <FlowbiteFooter.Brand
            href="https://makeprisms.com"
            alt="Prism Logo"
            src="/prism-logo.svg"
            name="Prism"
          />
          <FlowbiteFooter.LinkGroup>
            <FlowbiteFooter.Link href="#">About</FlowbiteFooter.Link>
            <FlowbiteFooter.Link href="#">Privacy Policy</FlowbiteFooter.Link>
            <FlowbiteFooter.Link href="#">Licensing</FlowbiteFooter.Link>
            <FlowbiteFooter.Link href="#">Contact</FlowbiteFooter.Link>
          </FlowbiteFooter.LinkGroup>
        </div>
        <FlowbiteFooter.Divider />
        <div className="text-lg">Use your best judgment when trusting mints.<br/></div>
        <FlowbiteFooter.Copyright href="#" by="MakePrisms, Inc." year={2024} />
      </div>
    </FlowbiteFooter>
  );
};

export default Footer;
