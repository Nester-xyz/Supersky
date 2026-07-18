import { browser } from 'wxt/browser';
import { ArrowRightIcon } from '@/components/icons';
import { LogoMark } from '@/components/Logo';
import { Button } from '@/components/ui';

/**
 * First-run screen, opened in a tab when the extension is installed. It's purely
 * a welcome + hand-off: the actual sign-in lives on the settings page, which
 * this tab navigates to (reusing itself) when the user continues.
 */
export default function App() {
  function getStarted() {
    window.location.href = browser.runtime.getURL('/options.html');
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center">
      <div className="animate-slide-up flex max-w-md flex-col items-center">
        <LogoMark size={96} />
        <h1 className="mt-8 text-3xl font-bold tracking-tight text-ink">
          Welcome to Super<span className="text-gradient">sky</span>
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
          The fastest way to post on Bluesky, right from your toolbar.
        </p>
        <Button onClick={getStarted} className="mt-9 h-11 gap-2 px-7 text-[15px]">
          Get started
          <ArrowRightIcon size={17} />
        </Button>
        <p className="mt-4 text-xs text-ink-faint">
          You&rsquo;ll connect your Bluesky account on the next screen.
        </p>
      </div>
    </main>
  );
}
