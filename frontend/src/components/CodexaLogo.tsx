import React from 'react';

interface CodexaLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export default function CodexaLogo({ className = '', size = 'md' }: CodexaLogoProps) {
  const sizeClasses = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16',
  };

  const dimensions = sizeClasses[size];

  return (
    <svg 
      className={`${dimensions} ${className} drop-shadow-[0_2px_8px_rgba(99,102,241,0.25)]`} 
      viewBox="0 0 32 32" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="codexa-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366f1" /> {/* Indigo */}
          <stop offset="50%" stopColor="#a855f7" /> {/* Purple */}
          <stop offset="100%" stopColor="#10b981" /> {/* Emerald */}
        </linearGradient>
      </defs>
      {/* Outer Code-C Loop */}
      <path 
        d="M25 7.5C22 4.5 17.8 3 13.5 3C6.6 3 1 8.6 1 15.5C1 22.4 6.6 28 13.5 28C17.8 28 22 26.5 25 23.5C22.5 22.5 20 21.5 18 21.5C16.8 22 15.2 22.5 13.5 22.5C9.6 22.5 6.5 19.4 6.5 15.5C6.5 11.6 9.6 8.5 13.5 8.5C15.2 8.5 16.8 9 18 9.5C20 9.5 22.5 8.5 25 7.5Z" 
        fill="url(#codexa-gradient)" 
      />
      {/* Connected AI node endpoints */}
      <circle cx="25" cy="7.5" r="3" fill="#10b981" />
      <circle cx="25" cy="23.5" r="3" fill="#6366f1" />
      {/* Core Intelligence Orb */}
      <circle cx="13.5" cy="15.5" r="4.5" fill="url(#codexa-gradient)" fillOpacity="0.85" />
      {/* Internal Code Indicator (>) */}
      <path 
        d="M12.5 13.5L14.5 15.5L12.5 17.5" 
        stroke="white" 
        strokeWidth="1.5" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
      />
    </svg>
  );
}
