import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 t-sm font-semibold",
  {
    variants: {
      variant: {
        default: "border-primary/30 bg-primary/12 text-primary",
        live: "border-[color-mix(in_srgb,var(--buy)_40%,transparent)] bg-[color-mix(in_srgb,var(--buy)_14%,transparent)] text-buy",
        est: "border-primary/35 bg-primary/10 text-warn",
        muted: "border-border bg-muted text-muted-foreground",
        danger:
          "border-[color-mix(in_srgb,var(--sell)_40%,transparent)] bg-[color-mix(in_srgb,var(--sell)_14%,transparent)] text-sell",
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
