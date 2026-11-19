import type { Metadata } from 'next';
import './globals.css';
import { QueryProvider } from '@/components/providers/query-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';

export const metadata: Metadata = {
  title: 'YouTube Clipping Intelligence & OmniPost Studio',
  description:
    'Modern production-grade multi-user clipping intelligence and multi-platform publishing platform.',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Zero-FOUC Blocking Theme Execution */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var stored = localStorage.getItem('theme');
                  var theme = stored || 'light';
                  var isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
                  if (isDark) {
                    document.documentElement.classList.add('dark');
                    document.documentElement.style.colorScheme = 'dark';
                  } else {
                    document.documentElement.classList.remove('dark');
                    document.documentElement.style.colorScheme = 'light';
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer"
        >
          Skip to main content
        </a>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          storageKey="theme"
          enableSystem={true}
          disableTransitionOnChange
        >
          <QueryProvider>{children}</QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
