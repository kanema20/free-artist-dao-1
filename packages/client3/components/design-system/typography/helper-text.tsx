import clsx from "clsx";
import { HTMLAttributes, ComponentType } from "react";

export interface HelperTextProps extends HTMLAttributes<HTMLHeadingElement> {
  as?: string | ComponentType<{ className: string }>;
  isError?: boolean;
}

export function HelperText({
  as,
  isError = false,
  className,
  ...rest
}: HelperTextProps) {
  const Component = as ?? "p";
  return (
    <Component
      className={clsx(
        "text-sm",
        isError ? "text-xs text-state-error" : null,
        className
      )}
      {...rest}
    />
  );
}
