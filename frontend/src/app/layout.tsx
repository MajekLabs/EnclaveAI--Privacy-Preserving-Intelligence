import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AuraNode — Confidential Compute on Stellar",
  description:
    "Decentralized verifiable AI inference with TEE hardware enclaves and on-chain ZK proof verification.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#0a0a0f] text-slate-100 antialiased">
        <nav className="border-b border-slate-800 bg-[#0a0a0f]/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-violet-400 font-bold text-lg tracking-tight">AuraNode</span>
              <span className="text-xs text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">
                Stellar Protocol 26
              </span>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <a href="/playground" className="text-slate-400 hover:text-slate-100 transition-colors">
                Playground
              </a>
              <a href="/validators" className="text-slate-400 hover:text-slate-100 transition-colors">
                Validators
              </a>
              <a
                href="https://github.com/auranode"
                className="text-slate-400 hover:text-slate-100 transition-colors"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
            </div>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
