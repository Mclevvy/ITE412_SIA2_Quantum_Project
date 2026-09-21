type LogoProps = {
  size?: "sm" | "md" | "lg";
  className?: string;
};

export default function Logo({ size = "md", className = "" }: LogoProps) {
  const px = size === "sm" ? 32 : size === "lg" ? 56 : 44;
  
  // Your working ImgBB direct link!
  const logoUrl = "https://i.ibb.co/psTtv5x/logo.png";

  return (
    <img
      src={logoUrl}
      alt="FERMA Logo"
      width={px}
      height={px}
      className={`object-contain ${className}`}
      loading="lazy"
    />
  );
}