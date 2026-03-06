import { LogOut } from 'lucide-react';
import AppHeader from './AppHeader';
import NavBar from './NavBar';
import Footer from './Footer';
import { signOutUser } from '../../firebase/auth';

export default function AppLayout({ children }) {
  return (
    <>
      {/* Full-screen green gradient background — sits behind everything */}
      <div
        className="fixed inset-0 -z-10"
        style={{
          background: 'linear-gradient(to bottom, rgba(76,179,29,0.70) 0%, rgba(76,179,29,0.20) 100%)',
        }}
      />

      <div className="flex flex-col overflow-hidden w-full h-full">
        {/* Everything constrained to center column with white bg */}
        <div
          className="relative flex-1 flex flex-col min-h-0 w-full max-w-3xl mx-auto bg-white md:shadow-xl md:border-x-[7px] md:border-[#5C3D1E]"
        >
          <AppHeader />
          <NavBar />

          {/* Main content — pb-16 keeps content above the mobile fixed nav */}
          <main className="flex-1 flex flex-col min-h-0 overflow-hidden overflow-y-auto pb-16 md:pb-0">
            {children}
          </main>

          {/* Footer — narrow icon-only link bar, hidden on mobile */}
          <div className="hidden md:block">
            <Footer />
          </div>

          {/* Logout button — bottom-right of central column */}
          <button
            onClick={() => signOutUser()}
            className="absolute bottom-1 right-1 z-30 flex items-center justify-center w-8 h-8 rounded-full bg-gray-200/80 hover:bg-red-100 text-gray-500 hover:text-red-600 transition-colors"
            title="Log out"
            aria-label="Log out"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </>
  );
}
