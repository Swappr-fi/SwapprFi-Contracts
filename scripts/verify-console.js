// ═══════════════════════════════════════════════════════════════
// BDAGScan Verification Fix — Paste in Browser Console
// ═══════════════════════════════════════════════════════════════
//
// Problem: BDAGScan's form doesn't send optimizer/viaIR settings,
//          causing bytecode mismatch for contracts compiled with
//          optimizer + viaIR enabled.
//
// Solution: This script intercepts the form submission and adds
//           the missing compiler settings automatically.
//
// Steps:
//   1. Open https://bdagscan.com/verificationContract
//   2. Open DevTools (F12 or Cmd+Opt+I) → Console tab
//   3. Paste this entire script and press Enter
//   4. You'll see "✅ Verification interceptor active!"
//   5. Now use the form normally — fill in address, source, etc.
//   6. When you submit, the script adds optimizer + viaIR params
//
// Constructor args (paste in the form if there's a field):
//   WETH:                  (none)
//   SwapperFactory:        000000000000000000000000cbb5b1f048be05e62894fd68a0b0ac74587cceda
//   SwapperRouter:         0000000000000000000000003a634e1ce44d1b73b27a6f57f2bff1e9333106d40000000000000000000000009441c3b63270bca27fc94b232e030acacc5a597d
//   SwapperNFTMarketplace: 000000000000000000000000cbb5b1f048be05e62894fd68a0b0ac74587cceda
//   SwappyToken:           0000000000000000000000000000000000000000033b2e3c9fd0803ce8000000
//   SwapperStaking:        (none)
//   SwappyStaking:         00000000000000000000000047470692ab7d24b0db42265c18d41ce93155d477
//   SwappySale:            00000000000000000000000047470692ab7d24b0db42265c18d41ce93155d477000000000000000000000000cbb5b1f048be05e62894fd68a0b0ac74587cceda
// ═══════════════════════════════════════════════════════════════

(function() {
  const _origFetch = window.fetch;

  window.fetch = async function(url, opts) {
    // Only intercept verification API calls
    if (typeof url === "string" && url.includes("verifyContract") && opts?.body instanceof FormData) {
      const fd = opts.body;

      // Add missing compiler settings
      if (!fd.has("optimizationUsed")) fd.append("optimizationUsed", "1");
      if (!fd.has("runs"))             fd.append("runs", "200");
      if (!fd.has("viaIR"))            fd.append("viaIR", "true");

      // Fix evmVersion (form sends "default", should be "paris")
      if (fd.get("evmVersion") === "default") {
        fd.delete("evmVersion");
        fd.append("evmVersion", "paris");
      }

      console.log("🔧 Intercepted verification request — added optimizer + viaIR settings");
      console.log("   Fields:", [...fd.entries()].map(([k,v]) =>
        k === "sourceCode" ? `${k}: (${v.length} chars)` : `${k}: ${v}`
      ).join("\n   "));
    }

    return _origFetch.apply(this, arguments);
  };

  // Also intercept XMLHttpRequest in case the form uses it
  const _origXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(body) {
    if (body instanceof FormData) {
      const url = this.__url || "";
      if (url.includes("verifyContract")) {
        if (!body.has("optimizationUsed")) body.append("optimizationUsed", "1");
        if (!body.has("runs"))             body.append("runs", "200");
        if (!body.has("viaIR"))            body.append("viaIR", "true");
        if (body.get("evmVersion") === "default") {
          body.delete("evmVersion");
          body.append("evmVersion", "paris");
        }
        console.log("🔧 Intercepted XHR verification — added optimizer + viaIR settings");
      }
    }
    return _origXhrSend.apply(this, arguments);
  };

  const _origXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__url = url;
    return _origXhrOpen.apply(this, arguments);
  };

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  ✅ Verification interceptor active!                 ║");
  console.log("║                                                      ║");
  console.log("║  Use the form normally. This script automatically    ║");
  console.log("║  adds: optimizer=200, viaIR=true, evmVersion=paris  ║");
  console.log("║                                                      ║");
  console.log("║  Compiler: v0.8.24+commit.e11b9ed9                  ║");
  console.log("╚══════════════════════════════════════════════════════╝");
})();
