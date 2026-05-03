"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Challenge Modal ───────────────────────────────────────

type ChallengeModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (opts: {
    scopeType: "open" | "ens";
    scopedEnsName?: string;
    startingCapitalUsd: number;
  }) => Promise<void>;
  loading: boolean;
  error: string | null;
};

export function ChallengeModal({ open, onClose, onSubmit, loading, error }: ChallengeModalProps) {
  const [scopeType, setScopeType] = useState<"open" | "ens">("open");
  const [ensName, setEnsName] = useState("");
  const [capitalUsd, setCapitalUsd] = useState("100");
  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setScopeType("open");
      setEnsName("");
      setCapitalUsd("100");
    }
  }, [open]);

  // Focus ENS input when switching to ENS scope
  useEffect(() => {
    if (open && scopeType === "ens") {
      inputRef.current?.focus();
    }
  }, [open, scopeType]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Close on backdrop click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose],
  );

  // Lock body scroll
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const handleSubmit = async () => {
    const parsedCapital = Number(capitalUsd);
    if (!Number.isInteger(parsedCapital) || parsedCapital <= 0) {
      return;
    }

    await onSubmit({
      scopeType,
      scopedEnsName: scopeType === "ens" ? ensName.trim() : undefined,
      startingCapitalUsd: parsedCapital,
    });
  };

  const parsedCapital = Number(capitalUsd);
  const capitalValid = Number.isInteger(parsedCapital) && parsedCapital > 0;

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgb(0 0 0 / 0.7)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
    >
      <div
        className="relative w-full max-w-md animate-challenge-modal-enter"
        style={{
          background: "#fff",
          border: "5px solid #000",
          borderRadius: "20px",
          boxShadow: "12px 12px 0 0 #1565C0",
        }}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: "3px solid #000" }}
        >
          <div className="flex items-center gap-3">
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                borderRadius: "10px",
                background: "#E53935",
                border: "3px solid #000",
                boxShadow: "3px 3px 0 0 #1565C0",
                color: "#fff",
                fontFamily: "var(--font-display)",
                fontSize: "16px",
                fontWeight: 900,
              }}
            >
              VS
            </span>
            <div>
              <h2
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "20px",
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: "-0.02em",
                  color: "#000",
                  lineHeight: 1,
                }}
              >
                Challenge
              </h2>
              <span
                style={{
                  fontFamily: "var(--font-label)",
                  fontSize: "10px",
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "0.15em",
                  color: "#455A64",
                }}
              >
                Open Invite
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 36,
              height: 36,
              borderRadius: "8px",
              border: "2px solid #000",
              background: "#fff",
              fontFamily: "var(--font-label)",
              fontSize: "18px",
              fontWeight: 900,
              color: "#455A64",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "transform 0.1s ease, box-shadow 0.1s ease",
              boxShadow: "3px 3px 0 0 #1565C0",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translate(1px, 1px)";
              e.currentTarget.style.boxShadow = "2px 2px 0 0 #1565C0";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "";
              e.currentTarget.style.boxShadow = "3px 3px 0 0 #1565C0";
            }}
          >
            &times;
          </button>
        </div>

        {/* ── Terms ── */}
        <div className="px-6 py-5" style={{ borderBottom: "3px dashed #455A64", opacity: 0.8 }}>
          <span
            style={{
              fontFamily: "var(--font-label)",
              fontSize: "9px",
              fontWeight: 900,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#455A64",
              display: "block",
              marginBottom: "10px",
            }}
          >
            Match Terms
          </span>
          <div className="flex items-center gap-3 flex-wrap">
            <TermChip label="Wager" value="$10" accent />
            <TermChip label="Duration" value="5m" />
            <TermChip label="Capital" value={`$${capitalValid ? parsedCapital : "?"}`} />
          </div>
        </div>

        {/* ── Capital ── */}
        <div className="px-6 py-5" style={{ borderBottom: "3px dashed #455A64", opacity: 0.95 }}>
          <label
            htmlFor="challenge-capital"
            style={{
              fontFamily: "var(--font-label)",
              fontSize: "9px",
              fontWeight: 900,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#455A64",
              display: "block",
              marginBottom: "10px",
            }}
          >
            Trading Capital
          </label>
          <div className="flex items-center gap-3">
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "28px",
                fontWeight: 900,
                color: "#000",
                lineHeight: 1,
              }}
            >
              $
            </span>
            <input
              id="challenge-capital"
              type="number"
              min={1}
              step={1}
              value={capitalUsd}
              onChange={(e) => setCapitalUsd(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 14px",
                border: "3px solid #000",
                borderRadius: "10px",
                fontFamily: "var(--font-display)",
                fontSize: "22px",
                fontWeight: 900,
                color: "#000",
                background: "#fff",
                outline: "none",
                boxShadow: `4px 4px 0 0 ${capitalValid ? "#1565C0" : "#E53935"}`,
              }}
            />
          </div>
          {!capitalValid && (
            <span style={{ marginTop: "8px", display: "block", fontFamily: "var(--font-label)", fontSize: "10px", fontWeight: 800, color: "#E53935" }}>
              Capital must be a whole dollar amount.
            </span>
          )}
        </div>

        {/* ── Scope ── */}
        <div className="px-6 py-5" style={{ borderBottom: "3px solid #000" }}>
          <span
            style={{
              fontFamily: "var(--font-label)",
              fontSize: "9px",
              fontWeight: 900,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#455A64",
              display: "block",
              marginBottom: "12px",
            }}
          >
            Scope
          </span>
          <div className="flex gap-3">
            <ScopeButton
              active={scopeType === "open"}
              onClick={() => setScopeType("open")}
              label="Open"
              sub="Anyone can join"
            />
            <ScopeButton
              active={scopeType === "ens"}
              onClick={() => setScopeType("ens")}
              label="ENS Only"
              sub="Target a player"
            />
          </div>

          {scopeType === "ens" && (
            <div style={{ marginTop: "14px" }}>
              <input
                ref={inputRef}
                type="text"
                value={ensName}
                onChange={(e) => setEnsName(e.target.value)}
                placeholder="vitalik.moonjoy.eth"
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  border: "3px solid #000",
                  borderRadius: "10px",
                  fontFamily: "var(--font-label)",
                  fontSize: "14px",
                  fontWeight: 700,
                  color: "#000",
                  background: "#fff",
                  outline: "none",
                  transition: "box-shadow 0.15s ease",
                  boxShadow: "4px 4px 0 0 #1565C0",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.boxShadow = "4px 4px 0 0 #E53935";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.boxShadow = "4px 4px 0 0 #1565C0";
                }}
              />
            </div>
          )}
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="px-6 py-3" style={{ background: "#FFF0F0", borderBottom: "3px solid #000" }}>
            <span style={{ fontFamily: "var(--font-label)", fontSize: "12px", fontWeight: 800, color: "#E53935" }}>
              {error}
            </span>
          </div>
        )}

        {/* ── Launch ── */}
        <div className="px-6 py-5">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={loading || !capitalValid || (scopeType === "ens" && !ensName.trim())}
            className="neo-btn w-full py-4"
            style={{
              fontSize: "16px",
              letterSpacing: "0.12em",
              opacity: loading || !capitalValid || (scopeType === "ens" && !ensName.trim()) ? 0.4 : 1,
              cursor: loading || !capitalValid || (scopeType === "ens" && !ensName.trim()) ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Deploying..." : "Launch Challenge"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────

function TermChip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "8px 16px",
        border: "2px solid #000",
        borderRadius: "10px",
        background: accent ? "#E53935" : "#fff",
        color: accent ? "#fff" : "#000",
        boxShadow: "3px 3px 0 0 #1565C0",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "20px",
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontFamily: "var(--font-label)",
          fontSize: "8px",
          fontWeight: 900,
          textTransform: "uppercase",
          letterSpacing: "0.15em",
          marginTop: "4px",
          opacity: 0.7,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function ScopeButton({
  active,
  onClick,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "12px 8px",
        border: "3px solid #000",
        borderRadius: "12px",
        background: active ? "#000" : "#fff",
        color: active ? "#fff" : "#000",
        cursor: "pointer",
        transition: "transform 0.1s ease, box-shadow 0.1s ease, background 0.15s ease",
        boxShadow: active ? "4px 4px 0 0 #E53935" : "4px 4px 0 0 #1565C0",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "14px",
          fontWeight: 900,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          lineHeight: 1,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-label)",
          fontSize: "9px",
          fontWeight: 700,
          marginTop: "4px",
          opacity: 0.6,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        {sub}
      </span>
    </button>
  );
}
