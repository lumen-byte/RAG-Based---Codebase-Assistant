import React, { useContext } from 'react';
import { Moon, Sun } from 'lucide-react';
import { ThemeContext } from '../../context/ThemeContext';
import { Button } from './Button';

export function ThemeToggle() {
  const { theme, toggleTheme } = useContext(ThemeContext);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label="Toggle theme"
      className="rounded-full"
    >
      {theme === 'dark' ? (
        <Sun className="h-5 w-5 text-dark-text" />
      ) : (
        <Moon className="h-5 w-5 text-light-text" />
      )}
    </Button>
  );
}
