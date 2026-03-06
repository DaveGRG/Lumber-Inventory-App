import { links } from '../../utils/deepLinks';

function BuildertrendIcon() {
  return <img src="/bt-logo.jpg" alt="Buildertrend" className="h-6 w-6 rounded" />;
}

function GmailIcon() {
  return <img src="/gmail-logo.jpg" alt="Gmail" className="h-6 w-6 rounded" />;
}

function DriveIcon() {
  return <img src="/drive-logo.jpg" alt="Google Drive" className="h-6 w-6 rounded" />;
}

const FOOTER_LINKS = [
  { href: links.buildertrend, label: 'Buildertrend', Icon: BuildertrendIcon },
  { href: links.drive, label: 'Google Drive', Icon: DriveIcon },
  { href: links.gmail, label: 'Gmail', Icon: GmailIcon },
];

export default function Footer() {
  return (
    <footer className="flex justify-center items-center gap-3 py-3 border-t border-gray-100 bg-white">
      {FOOTER_LINKS.map(({ href, label, Icon }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-grg-green transition-colors rounded-lg"
        >
          <Icon />
        </a>
      ))}
    </footer>
  );
}
