import Link from 'next/link';
import { Shield, Database, Lock, Eye, ArrowLeft, RefreshCw, Key, Info } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | TabSpace',
  description: 'Understand how TabSpace handles, secures, and keeps your browser data local-first.',
};

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))] transition-colors duration-300">
      {/* Top ambient glow/gradient */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[400px] bg-gradient-to-b from-[hsla(217,89%,61%,0.08)] via-[hsla(279,52%,56%,0.04)] to-transparent pointer-events-none blur-3xl z-0" />

      <div className="relative z-10 max-w-4xl mx-auto px-6 py-12 md:py-20">
        {/* Navigation / Header */}
        <header className="mb-12 flex justify-between items-center">
          <Link
            href="/"
            className="group flex items-center gap-2.5 text-sm font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-all duration-200"
          >
            <span className="p-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] group-hover:-translate-x-0.5 transition-transform duration-200">
              <ArrowLeft className="w-4 h-4" />
            </span>
            Back to Dashboard
          </Link>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--accent))] flex items-center justify-center text-white font-semibold shadow-md shadow-[hsla(217,89%,61%,0.2)]">
              TS
            </span>
            <span className="font-bold tracking-tight text-lg">TabSpace</span>
          </div>
        </header>

        {/* Hero Section */}
        <section className="mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[hsla(217,89%,61%,0.25)] bg-[hsla(217,89%,61%,0.08)] text-[hsl(var(--primary))] text-xs font-semibold uppercase tracking-wider mb-5">
            <Shield className="w-3.5 h-3.5" /> Privacy & Trust
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4 bg-gradient-to-r from-[hsl(var(--foreground))] via-[hsl(var(--foreground))] to-[hsl(var(--accent))] bg-clip-text text-transparent">
            Privacy Policy
          </h1>
          <p className="text-lg text-[hsl(var(--muted-foreground))] max-w-2xl leading-relaxed">
            Your data belongs to you. TabSpace is built with a local-first philosophy, meaning you control your information at all times.
          </p>
          <div className="mt-4 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] bg-opacity-30 w-fit px-3 py-1.5 rounded-md border border-[hsl(var(--border))]">
            <Info className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
            Last Updated: June 25, 2026
          </div>
        </section>

        {/* Summary Card Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          <div className="p-6 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm hover:shadow-md transition-shadow duration-300 flex flex-col gap-3">
            <div className="w-10 h-10 rounded-lg bg-[hsla(217,89%,61%,0.1)] flex items-center justify-center text-[hsl(var(--primary))]">
              <Database className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-lg">Local-First Storage</h3>
            <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">
              By default, all projects, collections, tasks, and notes reside solely on your device.
            </p>
          </div>

          <div className="p-6 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm hover:shadow-md transition-shadow duration-300 flex flex-col gap-3">
            <div className="w-10 h-10 rounded-lg bg-[hsla(279,52%,56%,0.1)] flex items-center justify-center text-[hsl(var(--accent))]">
              <Eye className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-lg">No Trackers / Ads</h3>
            <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">
              We do not collect usage metrics, track your web browsing activity, or show third-party ads.
            </p>
          </div>

          <div className="p-6 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm hover:shadow-md transition-shadow duration-300 flex flex-col gap-3">
            <div className="w-10 h-10 rounded-lg bg-[hsla(142,70%,45%,0.1)] flex items-center justify-center text-emerald-500">
              <RefreshCw className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-lg">Optional Cloud Sync</h3>
            <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">
              Syncing is fully opt-in and utilizes secure self-hosted Cloudflare Worker endpoints.
            </p>
          </div>
        </div>

        {/* Detailed Sections */}
        <main className="space-y-12">
          {/* Section 1 */}
          <section className="scroll-mt-20">
            <h2 className="text-2xl font-bold tracking-tight mb-4 flex items-center gap-3">
              <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-[hsl(var(--secondary))] text-xs font-bold border border-[hsl(var(--border))]">1</span>
              How TabSpace Stores Your Data
            </h2>
            <div className="pl-11 space-y-4 text-[hsl(var(--muted-foreground))] leading-relaxed">
              <p>
                When using TabSpace as a browser extension, all data you create—including your projects, tab collections, custom task lists, notes, calendars, and configurations—is stored locally using the Chrome Extension <code className="px-1.5 py-0.5 rounded bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] text-sm font-mono">chrome.storage.local</code> API.
              </p>
              <p>
                For the web companion app, data is saved in your browser's local sandbox via IndexedDB or local storage. This ensures that no data leaves your browser without your active consent and setup.
              </p>
            </div>
          </section>

          {/* Section 2 */}
          <section className="scroll-mt-20">
            <h2 className="text-2xl font-bold tracking-tight mb-4 flex items-center gap-3">
              <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-[hsl(var(--secondary))] text-xs font-bold border border-[hsl(var(--border))]">2</span>
              Permissions Requested & Why
            </h2>
            <div className="pl-11 space-y-4 text-[hsl(var(--muted-foreground))] leading-relaxed">
              <p>
                To provide tab management, bookmark mirroring, and scheduling capabilities, TabSpace requests specific permissions from your browser. Here is why they are needed:
              </p>
              <div className="overflow-x-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] bg-opacity-40">
                      <th className="p-4 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground))]">Permission</th>
                      <th className="p-4 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground))]">Technical Purpose</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[hsl(var(--border))] text-sm">
                    <tr>
                      <td className="p-4 font-mono text-[hsl(var(--foreground))] font-semibold"><code className="px-1.5 py-0.5 rounded bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] text-xs font-mono">storage</code></td>
                      <td className="p-4">Safely stores projects, collections, calendar schedules, notes, and task data locally.</td>
                    </tr>
                    <tr className="bg-[hsl(var(--muted))] bg-opacity-10">
                      <td className="p-4 font-mono text-[hsl(var(--foreground))] font-semibold"><code className="px-1.5 py-0.5 rounded bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] text-xs font-mono">tabs</code></td>
                      <td className="p-4">Reads open tab titles and URLs to group them into collections, and opens saved collections.</td>
                    </tr>
                    <tr>
                      <td className="p-4 font-mono text-[hsl(var(--foreground))] font-semibold"><code className="px-1.5 py-0.5 rounded bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] text-xs font-mono">bookmarks</code></td>
                      <td className="p-4">Allows linking or importing Chrome Bookmarks directly into your TabSpace workspace folders.</td>
                    </tr>
                    <tr className="bg-[hsl(var(--muted))] bg-opacity-10">
                      <td className="p-4 font-mono text-[hsl(var(--foreground))] font-semibold"><code className="px-1.5 py-0.5 rounded bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] text-xs font-mono">activeTab</code></td>
                      <td className="p-4">Enables saving your currently active website to a project collection with a simple click.</td>
                    </tr>
                    <tr>
                      <td className="p-4 font-mono text-[hsl(var(--foreground))] font-semibold"><code className="px-1.5 py-0.5 rounded bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] text-xs font-mono">alarms</code></td>
                      <td className="p-4">Schedules background tasks to check for cloud synchronization updates (if enabled).</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* Section 3 */}
          <section className="scroll-mt-20">
            <h2 className="text-2xl font-bold tracking-tight mb-4 flex items-center gap-3">
              <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-[hsl(var(--secondary))] text-xs font-bold border border-[hsl(var(--border))]">3</span>
              Optional Cloud Sync & Collaboration
            </h2>
            <div className="pl-11 space-y-4 text-[hsl(var(--muted-foreground))] leading-relaxed">
              <p>
                TabSpace is fully functional as a local-first tool. However, you may optionally choose to enable Cloud Sync to collaborate with team members or keep multiple devices updated.
              </p>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  <strong className="text-[hsl(var(--foreground))]">Data Transmitted:</strong> If and only if you activate Cloud Sync for a project, we transmit project structures, notes, todos, task lists, and saved URL collections to your designated sync endpoint.
                </li>
                <li>
                  <strong className="text-[hsl(var(--foreground))]">Self-Hosted Backends:</strong> Because TabSpace supports self-hosted Cloudflare Worker + D1 backends, you have absolute ownership of where your synced cloud data is hosted.
                </li>
                <li>
                  <strong className="text-[hsl(var(--foreground))]">Bookmark Isolation:</strong> Local Chrome bookmark tree IDs and physical browser directory structures are <span className="font-semibold text-[hsl(var(--foreground))]">never</span> sent to the cloud sync database.
                </li>
              </ul>
            </div>
          </section>

          {/* Section 4 */}
          <section className="scroll-mt-20">
            <h2 className="text-2xl font-bold tracking-tight mb-4 flex items-center gap-3">
              <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-[hsl(var(--secondary))] text-xs font-bold border border-[hsl(var(--border))]">4</span>
              Security & Data Integrity
            </h2>
            <div className="pl-11 space-y-4 text-[hsl(var(--muted-foreground))] leading-relaxed">
              <p>
                We employ standard industry best practices to secure your data:
              </p>
              <ul className="list-disc pl-5 space-y-2">
                <li>All cloud communication is encrypted in transit over HTTPS/WSS (WebSockets).</li>
                <li>Real-time synchronization uses atomic, authenticated change logs.</li>
                <li>We do not utilize any analytics, marketing trackers, or third-party cookies.</li>
              </ul>
            </div>
          </section>

          {/* Section 5 */}
          <section className="scroll-mt-20">
            <h2 className="text-2xl font-bold tracking-tight mb-4 flex items-center gap-3">
              <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-[hsl(var(--secondary))] text-xs font-bold border border-[hsl(var(--border))]">5</span>
              Your Controls & Data Rights
            </h2>
            <div className="pl-11 space-y-4 text-[hsl(var(--muted-foreground))] leading-relaxed">
              <p>
                Since you control the local client and optional server settings:
              </p>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  <strong className="text-[hsl(var(--foreground))]">Delete Data:</strong> You can wipe all local storage at any time by uninstalling the extension or clearing the browser's application cache.
                </li>
                <li>
                  <strong className="text-[hsl(var(--foreground))]">Disable Sync:</strong> You can disconnect your cloud account or disable Cloud Sync from the Settings menu to stop data transmission immediately.
                </li>
                <li>
                  <strong className="text-[hsl(var(--foreground))]">Export:</strong> Export features allow you to download a backup of your local project data files.
                </li>
              </ul>
            </div>
          </section>
        </main>

        {/* Footer info/banner */}
        <footer className="mt-20 pt-8 border-t border-[hsl(var(--border))] text-center text-sm text-[hsl(var(--muted-foreground))]">
          <p className="mb-2">TabSpace Project Management & Tab Organizer</p>
          <p className="text-xs">Built to keep your digital space clean and secure.</p>
        </footer>
      </div>
    </div>
  );
}
