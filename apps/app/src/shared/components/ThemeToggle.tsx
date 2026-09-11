import { Moon, Sun } from "lucide-react";

import { toggleTheme, useTheme } from "../lib/theme";

/** Sun/moon button switching the .dark class; preference persists locally. */
export default function ThemeToggle() {
  const theme = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Light theme" : "Dark theme"}
      className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-black/[0.05] hover:text-text-primary dark:hover:bg-white/[0.06]"
    >
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
