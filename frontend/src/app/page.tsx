import Link from "next/link";

export default function Home() {
  return (
    <main className="max-w-5xl mx-auto px-4 py-24 space-y-20">
      {/* Hero */}
      <section className="text-center space-y-6">
        <div className="inline-flex items-center gap-2 border border-violet-500/30 bg-violet-500/10 rounded-full px-4 py-1.5 text-sm text-violet-300">
          <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
          Live on Stellar Testnet · Protocol 26
        </div>
        <h1 className="text-5xl font-bold tracking-tight">
          Confidential AI Inference
          <br />
          <span className="text-violet-400">Verified On-Chain</span>
        </h1>
        <p className="text-slate-400 text-lg max-w-2xl mx-auto">
          AuraNode pairs Intel SGX hardware enclaves with BN254 ZK proofs verified natively
          on Stellar using CAP-0080. Your data never leaves the enclave. Every result is
          cryptographically proven.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link
            href="/playground"
            className="bg-violet-600 hover:bg-violet-500 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
          >
            Try Playground
          </Link>
          <Link
            href="/validators"
            className="border border-slate-700 hover:border-slate-500 text-slate-300 px-6 py-2.5 rounded-lg font-medium transition-colors"
          >
            Live Validators
          </Link>
        </div>
      </section>

      {/* Protocol 26 feature grid */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            cap: "CAP-0080",
            title: "BN254 Native Verification",
            desc: "bn254_g1_msm and bn254_pairing_check host functions reduce ZK proof verification cost by ~90% vs Wasm.",
          },
          {
            cap: "CAP-0078",
            title: "Precise TTL Storage",
            desc: "Task escrows and proof records use extend_ttl to auto-purge after settlement, keeping ledger storage lean.",
          },
          {
            cap: "CAP-0082",
            title: "Checked 256-bit Math",
            desc: "All stake, slash, and bounty arithmetic uses checked_mul / checked_add — no silent overflow vulnerabilities.",
          },
        ].map((f) => (
          <div
            key={f.cap}
            className="border border-slate-800 rounded-xl p-5 bg-slate-900/40 space-y-2"
          >
            <span className="text-xs font-mono text-violet-400 border border-violet-500/30 rounded px-1.5 py-0.5">
              {f.cap}
            </span>
            <h3 className="font-semibold text-slate-100">{f.title}</h3>
            <p className="text-sm text-slate-400">{f.desc}</p>
          </div>
        ))}
      </section>

      {/* Architecture diagram */}
      <section className="border border-slate-800 rounded-xl p-6 bg-slate-900/40 space-y-4">
        <h2 className="font-semibold text-slate-200">Hardware-to-Ledger Flow</h2>
        <pre className="text-xs text-slate-400 overflow-x-auto leading-relaxed">
{`Browser (E2EE)  →  Stellar Event Stream  →  SGX Enclave  →  Noir Proof Engine
                                                                      ↓
                    auranode-pool  ←  complete_task  ←  auranode-verifier
                    (bounty release / slash)              (CAP-0080 pairing check)`}
        </pre>
      </section>
    </main>
  );
}
