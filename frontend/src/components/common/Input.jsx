import React from 'react';
import { cn } from './Button';

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-sm border border-light-border dark:border-dark-border bg-light-surface dark:bg-dark-bg px-3 py-2 text-sm text-light-text dark:text-dark-text file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-light-muted dark:placeholder:text-dark-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
