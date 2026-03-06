import { Eye, EyeOff } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';

export default function AppHeader() {
  const { hiViz, toggleHiViz } = useTheme();

  return (
    <header className="sticky top-0 z-40 bg-white shadow-md">
      <div className="relative flex items-center justify-center px-4 h-14 w-full max-w-3xl mx-auto">
        {/* Logo — centered */}
        <img src="/grg-logo.jpg" alt="GRG Playscapes" className="h-9" />

        {/* Hi-viz toggle — absolute right */}
        <button
          onClick={toggleHiViz}
          aria-label={hiViz ? 'Disable hi-viz mode' : 'Enable hi-viz mode'}
          className="absolute right-4 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 active:bg-gray-200 transition-colors"
        >
          {hiViz ? <EyeOff size={22} /> : <Eye size={22} />}
        </button>
      </div>
    </header>
  );
}
