import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  options: SelectOption[];
  onValueChange?: (value: string) => void;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, value, onValueChange, disabled, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          value={value}
          disabled={disabled}
          onChange={(event) => onValueChange?.(event.target.value)}
          className={cn(
            "flex h-8 w-full appearance-none rounded-md border border-input bg-background px-2.5 pr-7 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      </div>
    );
  },
);
Select.displayName = "Select";

export { Select };
