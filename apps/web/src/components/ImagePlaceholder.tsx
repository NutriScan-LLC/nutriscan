// Stands in for real photography that doesn't exist in the repo yet.
// To swap in the real asset once it's available, replace the usage with:
//   import Image from "next/image";
//   <Image src="/images/<file>" alt="..." fill className="object-cover" />
// and drop the file into `public/images/`.

type ImagePlaceholderProps = {
  label: string;
  className?: string;
};

export default function ImagePlaceholder({
  label,
  className = "",
}: ImagePlaceholderProps) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`flex items-center justify-center rounded-2xl border border-dashed border-emerald-300/70 bg-gradient-to-br from-emerald-50 to-white text-center ${className}`}
    >
      <span className="px-3 text-xs font-medium text-emerald-700/70">
        {label}
      </span>
    </div>
  );
}
