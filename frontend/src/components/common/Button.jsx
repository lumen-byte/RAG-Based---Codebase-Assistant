import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Utility to merge tailwind classes safely */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const Button = React.forwardRef(({ 
  className, 
  variant = 'primary', 
  size = 'default', 
  isLoading, 
  children, 
  ...props 
}, ref) => {
  const baseStyles = "inline-flex items-center justify-center rounded-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50";
  
  const variants = {
    primary: "bg-primary text-white hover:bg-primary/90 shadow-sm",
    secondary: "bg-dark-surface dark:bg-dark-surface text-light-text dark:text-dark-text hover:bg-gray-200 dark:hover:bg-dark-border border border-light-border dark:border-dark-border",
    ghost: "hover:bg-gray-100 dark:hover:bg-dark-surface text-light-text dark:text-dark-text",
    danger: "bg-red-500 text-white hover:bg-red-600 shadow-sm"
  };

  const sizes = {
    default: "h-10 px-4 py-2",
    sm: "h-9 rounded-sm px-3 text-sm",
    lg: "h-11 rounded-sm px-8",
    icon: "h-10 w-10"
  };

  return (
    <button
      ref={ref}
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      disabled={isLoading || props.disabled}
      {...props}
    >
      {isLoading ? (
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      ) : null}
      {children}
    </button>
  );
});

Button.displayName = "Button";

export { Button };
