import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/15 text-primary",
        live: "border-emerald-500/40 bg-emerald-500/15 text-emerald-400",
        est: "border-amber-500/40 bg-amber-500/15 text-amber-400",
        muted: "border-border bg-muted text-muted-foreground",
        danger: "border-red-500/40 bg-red-500/15 text-red-400",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
