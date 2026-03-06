import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  ClipboardList,
  Truck,
  MoreHorizontal,
} from 'lucide-react';
import { useBelowParCount } from '../../context/BelowParContext';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { to: '/inventory', label: 'Inventory', Icon: Package, badge: 'belowPar' },
  { to: '/products', label: 'Products', Icon: ClipboardList },
  { to: '/transfers', label: 'Transfers', Icon: Truck },
  { to: '/more', label: 'More', Icon: MoreHorizontal },
];

function BelowParBadge({ count }) {
  if (!count) return null;
  return (
    <span
      className="absolute -top-1 -right-1 flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] px-0.5 leading-none"
      aria-label={`${count} items below par`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function NavItem({ to, label, Icon, badge }) {
  const belowParCount = useBelowParCount();
  const location = useLocation();
  const navigate = useNavigate();
  const isActive = location.pathname === to;

  const handleClick = (e) => {
    e.preventDefault();
    if (isActive) {
      // Already on this page (possibly on a subpage) — navigate with reset flag
      navigate(to, { replace: true, state: { reset: Date.now() } });
    } else {
      navigate(to);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] min-w-[44px] px-2 py-1 rounded-lg transition-colors ${
        isActive ? 'text-grg-green' : 'text-gray-400 hover:text-grg-green'
      }`}
    >
      <span className="relative">
        <Icon size={22} strokeWidth={isActive ? 2.5 : 1.5} />
        {badge === 'belowPar' && <BelowParBadge count={belowParCount} />}
      </span>
      <span className="text-[10px] font-medium leading-tight">{label}</span>
    </button>
  );
}

function DesktopNavItem({ to, label, Icon, badge }) {
  const belowParCount = useBelowParCount();
  const location = useLocation();
  const navigate = useNavigate();
  const isActive = location.pathname === to;

  const handleClick = (e) => {
    e.preventDefault();
    if (isActive) {
      navigate(to, { replace: true, state: { reset: Date.now() } });
    } else {
      navigate(to);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        isActive
          ? 'border-grg-green text-grg-green'
          : 'border-transparent text-gray-500 hover:text-grg-green hover:border-grg-sage'
      }`}
    >
      <span className="relative">
        <Icon size={18} strokeWidth={isActive ? 2.5 : 1.5} />
        {badge === 'belowPar' && <BelowParBadge count={belowParCount} />}
      </span>
      {label}
    </button>
  );
}

export default function NavBar() {
  return (
    <>
      {/* Mobile: fixed bottom nav */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 flex justify-around items-center h-16 px-1"
        style={{ boxShadow: '0 -2px 8px rgba(0,0,0,0.08)' }}
      >
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>

      {/* Desktop: top nav bar below header */}
      <nav className="hidden md:flex border-b border-gray-200 overflow-x-auto">
        <div className="flex justify-center w-full px-4">
          {NAV_ITEMS.map((item) => (
            <DesktopNavItem key={item.to} {...item} />
          ))}
        </div>
      </nav>
    </>
  );
}
