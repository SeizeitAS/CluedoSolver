import React, { useState, useMemo } from "react";

// ---------------------------------------------------------------------------
// Card data — classic 6/6/9 Cluedo deck (Norwegian naming, matches the brief)
// ---------------------------------------------------------------------------
const SUSPECTS = [
  { id: "plum", name: "Frk. Plomme" },
  { id: "mustard", name: "Oberst Sennep" },
  { id: "white", name: "Fru Hvit" },
  { id: "peacock", name: "Fru Påfugl" },
  { id: "green", name: "Herr Grønn" },
  { id: "scarlet", name: "Frk. Rød" },
];
const WEAPONS = [
  { id: "knife", name: "Kniv" },
  { id: "candlestick", name: "Lysestake" },
  { id: "rope", name: "Reip" },
  { id: "revolver", name: "Revolver" },
  { id: "pipe", name: "Rørledning" },
  { id: "wrench", name: "Skiftenøkkel" },
];
const ROOMS = [
  { id: "kitchen", name: "Kjøkken" },
  { id: "dining", name: "Spisestue" },
  { id: "lounge", name: "Salong" },
  { id: "library", name: "Bibliotek" },
  { id: "billiard", name: "Billiardrom" },
  { id: "music", name: "Musikkrom" },
  { id: "hall", name: "Hall" },
  { id: "study", name: "Studie" },
  { id: "conservatory", name: "Konservatorium" },
];
const ALL_CARDS = [
  ...SUSPECTS.map((c) => ({ ...c, type: "suspect" })),
  ...WEAPONS.map((c) => ({ ...c, type: "weapon" })),
  ...ROOMS.map((c) => ({ ...c, type: "room" })),
];
const SECRET_PASSAGES = { kitchen: "conservatory", conservatory: "kitchen", study: "lounge", lounge: "study" };

// ---------------------------------------------------------------------------
// Engine — binary matrix constraint propagation
//
// Fixes / additions over the original draft in the brief:
//  1. "Cornered hand" deduction: once a player's remaining unknown cards
//     exactly fill their remaining hand slots, ALL of them are forced to 1
//     (not just the "two zeros -> third is one" single-track case).
//  2. "Full hand" deduction: once a player's known 1-count reaches their
//     hand size, every remaining unknown card for that player is forced to 0.
//     Without this the matrix stalls on larger tables (5-6 players) even
//     though a human solver could close it out by hand-size alone.
//  3. Envelope hand size is fixed at 3 (1 suspect + 1 weapon + 1 room) and
//     is fed through the same generic hand-size routine, so the previous
//     special-cased "all humans zero -> envelope one" rule becomes a special
//     case of the general rule instead of a separate code path.
// ---------------------------------------------------------------------------
class CluedoEngine {
  constructor(cards, players, handSizes) {
    this.cards = cards;
    this.players = players; // includes { id: 'envelope' }
    this.handSizes = handSizes; // { [playerId]: number }
    this.tracks = [];
    this.matrix = {};
    this.cards.forEach((c) => {
      this.matrix[c.id] = {};
      this.players.forEach((p) => (this.matrix[c.id][p.id] = null));
    });
  }

  setKnown(cardId, playerId, value) {
    this.matrix[cardId][playerId] = value;
  }

  addTrack(track) {
    this.tracks.push(track);
  }

  propagate() {
    let changed = true;
    let guard = 0;
    while (changed && guard < 50) {
      changed = false;
      guard++;

      // 1. Explicit track responses
      this.tracks.forEach((track) => {
        const trio = [track.whatSuspect, track.whatWeapon, track.whereRoom];
        track.responses.forEach((resp) => {
          if (resp.type === "pass") {
            trio.forEach((cid) => {
              if (this.matrix[cid][resp.playerId] === null) {
                this.matrix[cid][resp.playerId] = 0;
                changed = true;
              }
            });
          } else if (resp.type === "show_known" && resp.shownCardId) {
            if (this.matrix[resp.shownCardId][resp.playerId] !== 1) {
              this.matrix[resp.shownCardId][resp.playerId] = 1;
              changed = true;
            }
          } else if (resp.type === "show_unknown") {
            const zeros = trio.filter((c) => this.matrix[c][resp.playerId] === 0);
            const ones = trio.filter((c) => this.matrix[c][resp.playerId] === 1);
            const unknowns = trio.filter((c) => this.matrix[c][resp.playerId] === null);
            if (ones.length === 0 && zeros.length === 2 && unknowns.length === 1) {
              this.matrix[unknowns[0]][resp.playerId] = 1;
              changed = true;
            }
          }
        });
      });

      // 2. Global uniqueness: if someone holds it, everyone else is 0
      this.cards.forEach((card) => {
        const holder = this.players.find((p) => this.matrix[card.id][p.id] === 1);
        if (holder) {
          this.players.forEach((p) => {
            if (p.id !== holder.id && this.matrix[card.id][p.id] !== 0) {
              this.matrix[card.id][p.id] = 0;
              changed = true;
            }
          });
        }
      });

      // 3. Hand-size deductions (per player, including the envelope)
      this.players.forEach((p) => {
        const handSize = this.handSizes[p.id];
        if (handSize == null) return;
        const ones = this.cards.filter((c) => this.matrix[c.id][p.id] === 1);
        const nulls = this.cards.filter((c) => this.matrix[c.id][p.id] === null);
        if (ones.length >= handSize && nulls.length > 0) {
          nulls.forEach((c) => {
            this.matrix[c.id][p.id] = 0;
            changed = true;
          });
        } else if (nulls.length > 0 && nulls.length === handSize - ones.length) {
          nulls.forEach((c) => {
            this.matrix[c.id][p.id] = 1;
            changed = true;
          });
        }
      });
    }
  }

  probabilities() {
    const out = {};
    this.cards.forEach((card) => {
      if (this.matrix[card.id]["envelope"] === 1) { out[card.id] = 1; return; }
      if (this.matrix[card.id]["envelope"] === 0) { out[card.id] = 0; return; }
      const humans = this.players.filter((p) => p.id !== "envelope");
      const possible = humans.filter((p) => this.matrix[card.id][p.id] !== 0);
      out[card.id] = possible.length > 0 ? 1 / (possible.length + 1) : 0.5;
    });
    return out;
  }

  matrixState() { return this.matrix; }
}

// ---------------------------------------------------------------------------
// UI style helpers (kept from the brief's own token set)
// ---------------------------------------------------------------------------
const cell = (v) => {
  if (v === 1) return "bg-emerald-500/15 text-emerald-400 font-bold";
  if (v === 0) return "bg-red-500/10 text-red-400/50";
  return "text-slate-500";
};
const probCell = (p) => {
  if (p === 1) return "bg-emerald-500/10 text-emerald-400 font-bold border-l-4 border-l-emerald-500";
  if (p === 0) return "bg-red-500/10 text-red-400/50 line-through decoration-red-500/30";
  if (p > 0.5) return "bg-amber-500/10 text-amber-400 font-semibold";
  return "text-slate-300";
};

function SectionCard({ title, children, className = "" }) {
  return (
    <div className={`bg-slate-900 border border-slate-800 rounded-xl p-4 ${className}`}>
      {title && (
        <h3 className="text-xs font-semibold tracking-wider uppercase text-slate-400 mb-3">{title}</h3>
      )}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup screen
// ---------------------------------------------------------------------------
function Setup({ onStart }) {
  const [count, setCount] = useState(4);
  const [names, setNames] = useState(["Meg (Du)", "Spiller 2", "Spiller 3", "Spiller 4", "Spiller 5", "Spiller 6"]);
  const [myCards, setMyCards] = useState([]);

  const totalOtherCards = 21 - myCards.length - 3; // minus envelope's 3
  const baseHand = Math.floor(totalOtherCards / (count - 1));
  const remainder = totalOtherCards % (count - 1);

  const toggleCard = (id) => {
    setMyCards((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-amber-400">🕵️ Cluedo Matrix Solver</h1>
          <p className="text-sm text-slate-400 mt-1">Sett opp partiet før du begynner å logge mistanker.</p>
        </div>

        <SectionCard title="Antall spillere (inkl. deg selv)">
          <div className="grid grid-cols-5 gap-2">
            {[3, 4, 5, 6].map((n) => (
              <button
                key={n}
                onClick={() => setCount(n)}
                className={`p-3 rounded-lg border text-sm font-medium transition-all active:scale-95 ${
                  count === n
                    ? "bg-amber-500/20 border-amber-500 text-amber-400"
                    : "bg-slate-800/40 border-slate-700 text-slate-300 hover:bg-slate-800"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Spillernavn">
          <div className="space-y-2">
            {Array.from({ length: count }).map((_, i) => (
              <input
                key={i}
                value={names[i]}
                onChange={(e) => {
                  const next = [...names];
                  next[i] = e.target.value;
                  setNames(next);
                }}
                disabled={i === 0}
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm text-slate-100 disabled:text-amber-400 disabled:border-amber-500/40"
              />
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Dine kort (klikk for å markere hånden din)">
          {["suspect", "weapon", "room"].map((type) => (
            <div key={type} className="mb-3 last:mb-0">
              <div className="grid grid-cols-3 gap-2">
                {ALL_CARDS.filter((c) => c.type === type).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => toggleCard(c.id)}
                    className={`p-2 rounded-lg border text-xs font-medium transition-all active:scale-95 ${
                      myCards.includes(c.id)
                        ? "bg-amber-500/20 border-amber-500 text-amber-400"
                        : "bg-slate-800/40 border-slate-700 text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-slate-500 mt-2">
            {myCards.length} kort valgt. Med {count} spillere fordeles resten som{" "}
            {remainder === 0 ? `${baseHand} kort hver` : `${baseHand}–${baseHand + 1} kort (${remainder} spillere får ett ekstra)`}.
          </p>
        </SectionCard>

        <button
          onClick={() =>
            onStart({
              playerCount: count,
              names: names.slice(0, count),
              myCards,
              baseHand,
              remainder,
            })
          }
          className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold py-3 rounded-xl transition-all active:scale-95"
        >
          Start sporing →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main tracker
// ---------------------------------------------------------------------------
export default function CluedoSolver() {
  const [setup, setSetup] = useState(null);

  if (!setup) return <Setup onStart={setSetup} />;

  const players = [
    ...setup.names.map((n, i) => ({ id: i === 0 ? "user" : `p${i + 1}`, name: n })),
    { id: "envelope", name: "Konvolutt ✉️" },
  ];
  const otherPlayers = players.filter((p) => p.id !== "user" && p.id !== "envelope");

  const handSizes = {};
  players.forEach((p, idx) => {
    if (p.id === "envelope") { handSizes[p.id] = 3; return; }
    if (p.id === "user") { handSizes[p.id] = setup.myCards.length; return; }
    const otherIdx = otherPlayers.findIndex((op) => op.id === p.id);
    handSizes[p.id] = setup.baseHand + (otherIdx < setup.remainder ? 1 : 0);
  });

  return <Tracker players={players} handSizes={handSizes} myCards={setup.myCards} />;
}

function Tracker({ players, handSizes, myCards }) {
  const [tracks, setTracks] = useState([]);
  const [activeAsker, setActiveAsker] = useState("user");
  const [selSuspect, setSelSuspect] = useState("");
  const [selWeapon, setSelWeapon] = useState("");
  const [selRoom, setSelRoom] = useState("");
  const [whyText, setWhyText] = useState("");
  const [responses, setResponses] = useState({});

  const { matrix, probabilities } = useMemo(() => {
    const engine = new CluedoEngine(ALL_CARDS, players, handSizes);
    myCards.forEach((cid) => engine.setKnown(cid, "user", 1));
    tracks.forEach((t) => engine.addTrack(t));
    engine.propagate();
    return { matrix: engine.matrixState(), probabilities: engine.probabilities() };
  }, [tracks, players, handSizes, myCards]);

  const advisor = useMemo(() => {
    const unresolved = ALL_CARDS.filter((c) => probabilities[c.id] > 0 && probabilities[c.id] < 1);
    if (unresolved.length === 0) {
      return "Løsningen er identifisert — sjekk sannsynlighetsmatrisen for de tre 100%-kortene.";
    }
    const suspectSolved = ALL_CARDS.filter((c) => c.type === "suspect" && probabilities[c.id] === 1)[0];
    const roomsUnresolved = unresolved.filter((c) => c.type === "room");
    const passageHint = roomsUnresolved.find((c) => SECRET_PASSAGES[c.id]);
    let tip = `Fokuser neste mistanke på: ${unresolved
      .slice(0, 3)
      .map((c) => c.name)
      .join(", ")}.`;
    if (passageHint) {
      const roomName = ROOMS.find((r) => r.id === passageHint.id)?.name;
      const passName = ROOMS.find((r) => r.id === SECRET_PASSAGES[passageHint.id])?.name;
      tip += ` ${roomName} har hemmelig gang til ${passName} — nyttig for å teste rommet uten å bruke terningkast.`;
    }
    if (suspectSolved) tip = `Mistenkt sannsynligvis avklart (${suspectSolved.name}). ` + tip;
    return tip;
  }, [probabilities]);

  const askable = players.filter((p) => p.id !== "envelope");
  const responders = players.filter((p) => p.id !== "envelope" && p.id !== activeAsker);

  const logTrack = (e) => {
    e.preventDefault();
    if (!selSuspect || !selWeapon || !selRoom) return;
    const newTrack = {
      id: crypto.randomUUID(),
      whoAsked: activeAsker,
      whatSuspect: selSuspect,
      whatWeapon: selWeapon,
      whereRoom: selRoom,
      whyNote: whyText || "Standard sporing",
      responses: Object.entries(responses).map(([playerId, type]) => ({ playerId, type })),
    };
    setTracks((prev) => [...prev, newTrack]);
    setSelSuspect(""); setSelWeapon(""); setSelRoom(""); setWhyText(""); setResponses({});
  };

  const nameOf = (id) => players.find((p) => p.id === id)?.name || id;
  const cardName = (id) => ALL_CARDS.find((c) => c.id === id)?.name || id;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6 font-sans select-none">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-7xl mx-auto">
        <div className="lg:col-span-12 mb-1 p-4 bg-gradient-to-r from-amber-500/10 to-indigo-500/10 border border-slate-800 rounded-xl flex items-start gap-3 shadow-md">
          <span className="text-xl text-amber-400 shrink-0 mt-0.5">💡</span>
          <p className="text-sm text-slate-300 leading-relaxed">{advisor}</p>
        </div>

        {/* Input column */}
        <div className="lg:col-span-5 space-y-6">
          <SectionCard title="🕵️ Hvem spør?">
            <div className="grid grid-cols-3 gap-2">
              {askable.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setActiveAsker(p.id)}
                  className={`p-3 rounded-lg border text-sm font-medium transition-all active:scale-95 ${
                    activeAsker === p.id
                      ? "bg-amber-500/20 border-amber-500 text-amber-400"
                      : "bg-slate-800/40 border-slate-700 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="🔎 Mistanke (Hva & Hvor)">
            <form onSubmit={logTrack} className="space-y-3">
              <select value={selSuspect} onChange={(e) => setSelSuspect(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm">
                <option value="">Velg mistenkt…</option>
                {SUSPECTS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={selWeapon} onChange={(e) => setSelWeapon(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm">
                <option value="">Velg våpen…</option>
                {WEAPONS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={selRoom} onChange={(e) => setSelRoom(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm">
                <option value="">Velg rom…</option>
                {ROOMS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>

              <div className="pt-2 border-t border-slate-800 space-y-2">
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-400">🎲 Svar fra motspillere</p>
                {responders.map((p) => (
                  <div key={p.id} className="flex items-center justify-between p-2 bg-slate-850 bg-slate-800/30 rounded-lg border border-slate-800/80">
                    <span className="text-sm">{p.name}</span>
                    <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-md border border-slate-800">
                      <button type="button" onClick={() => setResponses((r) => ({ ...r, [p.id]: "pass" }))}
                        className={`px-2 py-1 text-xs font-semibold rounded ${responses[p.id] === "pass" ? "bg-red-500/20 text-red-400 border border-red-500/30" : "text-slate-400"}`}>
                        Passet
                      </button>
                      <button type="button" onClick={() => setResponses((r) => ({ ...r, [p.id]: "show_unknown" }))}
                        className={`px-2 py-1 text-xs font-semibold rounded ${responses[p.id] === "show_unknown" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "text-slate-400"}`}>
                        Viste kort
                      </button>
                      <button type="button" onClick={() => setResponses((r) => { const n = { ...r }; delete n[p.id]; return n; })}
                        className={`px-2 py-1 text-xs font-semibold rounded ${!responses[p.id] ? "bg-slate-700/50 text-slate-300" : "text-slate-500"}`}>
                        —
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <input
                type="text"
                value={whyText}
                onChange={(e) => setWhyText(e.target.value)}
                placeholder="Notat: hvorfor spurte du dette?"
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-amber-500"
              />
              <button type="submit" className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold py-2.5 rounded-lg transition-all active:scale-95">
                Kjør analyse
              </button>
            </form>
          </SectionCard>

          <SectionCard title="Loggstrøm">
            {tracks.length === 0 ? (
              <p className="text-sm text-slate-500">Ingen spor logget enda.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {tracks.map((t, idx) => (
                  <div key={t.id} className="p-2 bg-slate-800/30 rounded-lg border border-slate-800/80 text-xs">
                    <div className="flex justify-between text-slate-400">
                      <span>#{idx + 1} — {nameOf(t.whoAsked)}</span>
                    </div>
                    <div className="text-slate-200 mt-1">
                      {cardName(t.whatSuspect)} + {cardName(t.whatWeapon)} i {cardName(t.whereRoom)}
                    </div>
                    <div className="text-slate-500 mt-1">{t.whyNote}</div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Matrix column */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-4 md:p-6 shadow-xl space-y-6">
          <h3 className="text-xs font-semibold tracking-wider uppercase text-slate-400">📊 Sannsynlighetsmatrise</h3>
          {["suspect", "weapon", "room"].map((type) => (
            <div key={type} className="w-full overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr>
                    <th className="bg-slate-950 p-2 text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800">
                      {type === "suspect" ? "Mistenkt" : type === "weapon" ? "Våpen" : "Rom"}
                    </th>
                    {players.map((p) => (
                      <th key={p.id} className="bg-slate-950 p-2 text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800">
                        {p.id === "user" ? "Deg" : p.id === "envelope" ? "✉️" : p.name}
                      </th>
                    ))}
                    <th className="bg-slate-950 p-2 text-xs font-semibold uppercase tracking-wider text-amber-400 border-b border-slate-800">%</th>
                  </tr>
                </thead>
                <tbody>
                  {ALL_CARDS.filter((c) => c.type === type).map((c) => (
                    <tr key={c.id}>
                      <td className="p-2 text-sm border-b border-slate-800/60">{c.name}</td>
                      {players.map((p) => (
                        <td key={p.id} className={`p-2 text-sm border-b border-slate-800/60 text-center ${cell(matrix[c.id][p.id])}`}>
                          {matrix[c.id][p.id] === 1 ? "✓" : matrix[c.id][p.id] === 0 ? "·" : "?"}
                        </td>
                      ))}
                      <td className={`p-2 text-sm border-b border-slate-800/60 text-center ${probCell(probabilities[c.id])}`}>
                        {Math.round(probabilities[c.id] * 100)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
