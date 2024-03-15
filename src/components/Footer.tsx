import { Footer as FlowbiteFooter } from "flowbite-react";
import { IconType } from "react-icons";
import { BsDiscord, BsTwitterX } from "react-icons/bs";
import { GiOstrich } from "react-icons/gi";
// Define props for IconWrapper
interface IconWrapperProps {
  IconComponent: IconType; // Use the IconType from 'react-icons' for the component
  iconProps?: React.SVGProps<SVGSVGElement>; // Define props that the icon component can accept
  className?: string; // Optional className for additional styling
}

const IconWrapper: React.FC<IconWrapperProps> = ({
  IconComponent,
  iconProps = {},
  className = "",
}) => (
  <div className={`p-2  bg-black rounded-full ${className}`}>
    <IconComponent
      size={24}
      className={`h-9 w-9 ${iconProps.className || ""}`}
      {...iconProps}
    />
  </div>
);

const CustomOstriche: React.FC = () => (
  <IconWrapper
    IconComponent={GiOstrich}
    iconProps={{ className: "text-purple-600" }}
  />
);

const CustomDiscord: React.FC = () => (
  <IconWrapper
    IconComponent={BsDiscord}
    iconProps={{ className: "text-blue-700" }}
  />
);

const CustomTwitter: React.FC = () => (
  <IconWrapper
    IconComponent={BsTwitterX}
    iconProps={{ className: "text-white" }}
  />
);

const Footer = () => {
  return (
    <FlowbiteFooter container className="bg-gradient-to-r from-gray-900 to-gray-800 rounded-none">
      <div className="w-full text-center">
        <div className="w-full md:justify-around flex md:flex-row flex-col sm:items-center justify-between ">
          <div>
            <a
              href="https://www.makeprisms.com"
              target="__blank"
              className="mb-4 flex items-center sm:mb-0"
            >
              <span className="self-center whitespace-nowrap text-2xl font-semibold text-gray-800 dark:text-white">
                Prism
              </span>
            </a>
          </div>
          <div className="mt-4 flex space-x-6 sm:mt-0 sm:justify-center">
            <FlowbiteFooter.Icon
              href="https://twitter.com/makeprisms"
              target="__blank"
              icon={CustomOstriche}
            />
            <FlowbiteFooter.Icon
              href="https://discord.gg/dMkUbp3SjF"
              target="__blank"
              icon={CustomDiscord}
            />
            <FlowbiteFooter.Icon
              href="https://twitter.com/makeprisms"
              target="__blank"
              icon={CustomTwitter}
            />
          </div>
        </div>
        <FlowbiteFooter.Divider />
        <FlowbiteFooter.Copyright by="MakePrisms, Inc." year={2024} />
      </div>
    </FlowbiteFooter>
  );
};

export default Footer;
