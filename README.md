# CluedoSolver
Cluedo deduction assistant — a React app that tracks suggestions and calculates solution probabilities using binary matrix constraint propagation.

# Cluedo Matrix Solver

A React app that tracks suggestions during a game of Cluedo and calculates
solution probabilities in real time using binary matrix constraint
propagation.

## Features

- **Setup screen** — choose number of players (3–6), name them, and mark
  your own hand. Opponent hand sizes are computed automatically.
- **Suggestion tracker** — log who suggested which suspect/weapon/room and
  how each opponent responded (passed or showed a card).
- **Live probability matrix** — every card's likelihood of being in the
  solution envelope updates automatically as you log suggestions.
- **AI advisor banner** — suggests which cards to investigate next and
  flags secret-passage rooms (Kitchen ↔ Conservatory, Study ↔ Lounge) as
  efficient suggestion targets.

## Deduction engine

The solver goes beyond simple elimination with three propagation rules:

1. **Direct reveal** — if a player shows a card for a suggestion where the
   other two cards are already ruled out for them, the shown card is
   locked in.
2. **Full hand** — once a player's known cards reach their hand size,
   every other card is ruled out for them.
3. **Cornered hand** — once a player's remaining unknown cards exactly
   fill their remaining hand slots, all of those cards are locked in.
   This also covers the envelope (fixed hand size of 3: one suspect, one
   weapon, one room).

Rules are applied repeatedly until no further deductions can be made.

## Tech stack

- React (functional components + hooks)
- Tailwind CSS

## Running locally

```bash
npm install
npm run dev
```

(Requires a Vite or Create React App shell with Tailwind configured — the
component in `CluedoSolver.jsx` is self-contained and has no external
dependencies beyond React.)

## Project structure

```
CluedoSolver.jsx   # Full app: engine, setup screen, tracker UI
README.md
```

