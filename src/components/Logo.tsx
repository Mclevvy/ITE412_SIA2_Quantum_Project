import fermaLogo from "../assets/fermalogo.png";

type LogoProps = {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
};

export default function Logo({ size = "md", className = "" }: LogoProps) {
  const px = size === "sm" ? 32 : size === "lg" ? 56 : size === "xl" ? 72 : 44;

  // Bundled brand mark. (The old ImgBB remote URL is dead — verified
  // connection timeout — so the local asset is the primary source. It also
  // loads instantly and works offline in the Capacitor builds.)
  return (
    <img
      src={fermaLogo}
      alt="FERMA Logo"
      width={px}
      height={px}
      className={`object-contain ${className}`}
      loading="eager"
    />
  );
}