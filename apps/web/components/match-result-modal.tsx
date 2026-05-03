"use client";

import { useEffect, useRef, useCallback } from "react";
import type { MatchView } from "@/lib/types/match";
import type { PortfolioView } from "@/lib/types/trading";

type ResultSummary = {
  scoreMetric: string;
  outcome: "winner" | "tie";
  winnerSeat: "creator" | "opponent" | null;
  spreadUsd: number;
  spreadPnlPercent: number;
  creator: {
    currentValueUsd: number;
    totalPnlUsd: number;
    pnlPercent: number;
    netScorePercent: number;
    penaltiesUsd: number;
  };
  opponent: {
    currentValueUsd: number;
    totalPnlUsd: number;
    pnlPercent: number;
    netScorePercent: number;
    penaltiesUsd: number;
  };
};

type MatchResultModalProps = {
  open: boolean;
  onClose: () => void;
  match: MatchView;
  creatorPortfolio: PortfolioView | null;
  opponentPortfolio: PortfolioView | null;
};

function firstLabel(ens: string): string {
  const dot = ens.indexOf(".");
  return dot > 0 ? ens.slice(0, dot) : ens;
}

function pnlSign(val: number): string {
  return val >= 0 ? "+" : "";
}

export function MatchResultModal({
  open,
  onClose,
  match,
  creatorPortfolio,
  opponentPortfolio,
}: MatchResultModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const summary = (match.resultSummary ?? {}) as Partial<ResultSummary>;
  const outcome = summary.outcome ?? "tie";
  const winnerSeat = summary.winnerSeat;
  const spreadUsd = summary.spreadUsd ?? 0;
  const viewerSeat = match.viewerSeat;

  const viewerWon =
    outcome === "winner" && winnerSeat != null && winnerSeat === viewerSeat;
  const isTie = outcome === "tie";

  const creatorScore = creatorPortfolio?.netScorePercent ?? 0;
  const opponentScore = opponentPortfolio?.netScorePercent ?? 0;
  const creatorValue = creatorPortfolio?.currentValueUsd ?? 0;
  const opponentValue = opponentPortfolio?.currentValueUsd ?? 0;

  const winnerEns =
    winnerSeat === "creator"
      ? match.creator.agentEnsName
      : match.opponent?.agentEnsName;
  const loserEns =
    winnerSeat === "creator"
      ? match.opponent?.agentEnsName
      : match.creator.agentEnsName;

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose],
  );

  if (!open) return null;

  const headlineText = isTie
    ? "DRAW"
    : viewerWon
      ? "VICTORY"
      : "DEFEAT";

  const headlineColor = isTie
    ? "#455A64"
    : viewerWon
      ? "#E53935"
      : "#1565C0";

  const headlineShadow = isTie
    ? "3px 3px 0 #90A4AE"
    : viewerWon
      ? "4px 4px 0 #1565C0, 8px 8px 0 rgba(229 57 53 / 0.2)"
      : "3px 3px 0 #90A4AE";

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: "rgb(0 0 0 / 0.75)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div
        className="match-result-card"
        style={{
          background: "#fff",
          border: "5px solid #000",
          borderRadius: "20px",
          boxShadow: "12px 12px 0 0 #1565C0",
          width: "100%",
          maxWidth: 480,
          overflow: "hidden",
        }}
      >
        {/* ── Outcome Banner ── */}
        <div
          className="match-result-banner"
          style={{
            background: isTie
              ? "#f0ebe0"
              : viewerWon
                ? "#E53935"
                : "#1565C0",
            borderBottom: "5px solid #000",
            padding: "28px 24px 24px",
            textAlign: "center",
          }}
        >
          <div
            className="match-result-headline"
            style={{
              fontFamily: "var(--font-display), sans-serif",
              fontSize: "56px",
              fontWeight: 900,
              textTransform: "uppercase",
              letterSpacing: "-0.04em",
              lineHeight: 1,
              color: isTie ? "#455A64" : "#fff",
              textShadow: headlineShadow,
            }}
          >
            {headlineText}
          </div>
          {viewerWon && (
            <div
              style={{
                fontFamily: "var(--font-label), sans-serif",
                fontSize: "11px",
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.2em",
                color: "rgba(255 255 255 / 0.7)",
                marginTop: "8px",
              }}
            >
              Your agent dominated
            </div>
          )}
          {!viewerWon && !isTie && (
            <div
              style={{
                fontFamily: "var(--font-label), sans-serif",
                fontSize: "11px",
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.2em",
                color: "rgba(255 255 255 / 0.6)",
                marginTop: "8px",
              }}
            >
              Better luck next cycle
            </div>
          )}
          {isTie && (
            <div
              style={{
                fontFamily: "var(--font-label), sans-serif",
                fontSize: "11px",
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.2em",
                color: "#90A4AE",
                marginTop: "8px",
              }}
            >
              Dead even
            </div>
          )}
        </div>

        {/* ── Winner Announcement ── */}
        {!isTie && winnerEns && (
          <div
            style={{
              padding: "20px 24px",
              borderBottom: "3px solid #000",
              display: "flex",
              alignItems: "center",
              gap: "14px",
            }}
          >
            <div
              className="match-result-trophy"
              style={{
                width: 48,
                height: 48,
                borderRadius: "12px",
                border: "3px solid #000",
                background: "#E53935",
                boxShadow: "4px 4px 0 0 #1565C0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "24px",
                flexShrink: 0,
                animation: "victory-glow-pulse 2s ease-in-out infinite",
              }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                <path d="M4 22h16" />
                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
              </svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                className="arena-winner-label"
                style={{ fontSize: "16px", marginBottom: "2px" }}
              >
                Winner
              </div>
              <div
                style={{
                  fontFamily: "var(--font-display), sans-serif",
                  fontSize: "20px",
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: "-0.02em",
                  color: "#000",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {firstLabel(winnerEns)}
              </div>
              {loserEns && (
                <div
                  style={{
                    fontFamily: "var(--font-label), sans-serif",
                    fontSize: "10px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    color: "#90A4AE",
                    marginTop: "2px",
                  }}
                >
                  def. {firstLabel(loserEns)}
                </div>
              )}
            </div>
            <div
              style={{
                marginLeft: "auto",
                textAlign: "right",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-label), sans-serif",
                  fontSize: "9px",
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: "0.15em",
                  color: "#90A4AE",
                }}
              >
                Spread
              </div>
              <div
                style={{
                  fontFamily: "var(--font-display), sans-serif",
                  fontSize: "20px",
                  fontWeight: 900,
                  color: "#E53935",
                  lineHeight: 1.1,
                }}
              >
                {pnlSign(spreadUsd)}${Math.abs(spreadUsd).toFixed(2)}
              </div>
            </div>
          </div>
        )}

        {/* ── Score Comparison ── */}
        <div
          style={{
            display: "flex",
            borderBottom: "3px solid #000",
          }}
        >
          <ScoreColumn
            label={match.creator.agentEnsName}
            pnl={creatorScore}
            value={creatorValue}
            isWinner={winnerSeat === "creator"}
            borderRight
          />
          <ScoreColumn
            label={match.opponent?.agentEnsName ?? null}
            pnl={opponentScore}
            value={opponentValue}
            isWinner={winnerSeat === "opponent"}
          />
        </div>

        {/* ── Wager Info ── */}
        <div
          style={{
            padding: "12px 24px",
            borderBottom: "3px dashed #455A64",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-label), sans-serif",
              fontSize: "9px",
              fontWeight: 900,
              textTransform: "uppercase",
              letterSpacing: "0.18em",
              color: "#90A4AE",
            }}
          >
            Wager
          </span>
          <span
            style={{
              fontFamily: "var(--font-display), sans-serif",
              fontSize: "14px",
              fontWeight: 900,
              color: "#000",
            }}
          >
            ${match.wagerUsd}
          </span>
        </div>

        {/* ── Action ── */}
        <div style={{ padding: "20px 24px" }}>
          <button
            type="button"
            onClick={onClose}
            className="neo-btn w-full py-4"
            style={{
              fontSize: "15px",
              letterSpacing: "0.12em",
            }}
          >
            Back to Arena
          </button>
        </div>
      </div>
    </div>
  );
}

function ScoreColumn({
  label,
  pnl,
  value,
  isWinner,
  borderRight,
}: {
  label: string | null;
  pnl: number;
  value: number;
  isWinner: boolean;
  borderRight?: boolean;
}) {
  return (
    <div
      className={isWinner ? "match-result-winner-col" : ""}
      style={{
        flex: 1,
        padding: "16px 20px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "4px",
        borderRight: borderRight ? "3px solid #000" : undefined,
        background: isWinner ? "rgba(229 57 53 / 0.04)" : undefined,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-display), sans-serif",
          fontSize: "13px",
          fontWeight: 900,
          textTransform: "uppercase",
          letterSpacing: "-0.01em",
          color: "#000",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: "100%",
        }}
      >
        {label ? firstLabel(label) : "---"}
      </span>
      <span
        style={{
          fontFamily: "var(--font-display), sans-serif",
          fontSize: "36px",
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: "-0.03em",
          color:
            pnl > 0 ? "#E53935" : pnl < 0 ? "#455A64" : "#90A4AE",
        }}
      >
        {pnlSign(pnl)}
        {(pnl * 100).toFixed(2)}%
      </span>
      <span
        style={{
          fontFamily: "var(--font-label), sans-serif",
          fontSize: "11px",
          fontWeight: 700,
          color: "#455A64",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      {isWinner && (
        <span
          style={{
            fontFamily: "var(--font-label), sans-serif",
            fontSize: "8px",
            fontWeight: 900,
            textTransform: "uppercase",
            letterSpacing: "0.2em",
            color: "#E53935",
            marginTop: "4px",
            padding: "2px 8px",
            border: "2px solid #E53935",
            borderRadius: "4px",
          }}
        >
          Won
        </span>
      )}
    </div>
  );
}
