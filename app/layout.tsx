import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'FocusSync — Find your focus, together',
  description: 'Create a shared focus room, invite your people, and make time for deep work. A synchronized timer for a little collective momentum.',
  icons: { icon: '/favicon.svg' },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
