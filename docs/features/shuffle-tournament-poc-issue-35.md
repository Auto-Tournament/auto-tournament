# Shuffle Tournament – Proof of Concept Overview (Issue #35)

> **Audience**: Original issue author for [Feature #35 – New Tournament Type](https://github.com/sivert-io/matchzy-auto-tournament/issues/35)  
> **Goal**: Describe what the implemented **shuffle tournament** feature does, how the flow works, and where it deliberately differs from your original “Excel + manual matches” setup.

---

## 1. Goals & Interpretation of Your Request

From Issue [#35](https://github.com/sivert-io/matchzy-auto-tournament/issues/35), the core goals were:

- **Individual competition, not fixed teams**  
  - Players should compete as individuals; there is no “tournament-winning team”.  
  - The winner is the **player with the most match wins**, with ELO and stats available as tie-breakers.

- **Dynamic, balanced teams every match**  
  - Instead of fixed rosters, teams are reshuffled every match/round.  
  - Team balancing should use an ELO-like rating (similar to your Excel sheet) so that each team’s average ELO is as close as possible.

- **Fixed map per round, no veto**  
  - For this tournament type, you don’t need veto or map votes.  
  - All matches in a round should use the **same map**, which you configure in advance.

- **Full automation (Complex Option)**  
  - The POC targets the **complex solution** you described:
    - Internal ELO/skill system (we use **OpenSkill** under the hood – a Bayesian rating system for teams and games, see [openskill.me](https://openskill.me)).
    - Automatic team creation and balancing every round.
    - Automatic match creation, round progression, and standings.

The implementation therefore focuses on a **fully automatic shuffle tournament mode** rather than the purely manual “simple” mode.

> **If you’re not familiar with these terms:**  
> - **ELO** is the classic rating system from chess – a single number that goes up or down after each match.  
> - **OpenSkill** is a modern rating system that builds on Bayesian statistics and is designed for **team games** and changing teammates. You can think of it as “a smarter ELO under the hood” – we convert it to an ELO-like number in the UI so it stays familiar.

---

## 2. High-Level Concept

At a high level, the shuffle tournament feature does the following:

- Treats **players** as the primary entity (not teams).
- Uses a **global rating system** (OpenSkill → displayed as ELO) for **all tournament types**, but shuffle tournaments make the heaviest use of it.
- For each round:
  1. Looks at all **registered players** and their current ELO.
  2. Builds **balanced teams** (e.g. 5v5) based on ELO.
  3. Creates matches, assigns maps and sides, and allocates servers.
  4. Lets players play their matches.
  5. When all matches in the round finish:
     - Updates ratings for all players who played.
     - Stores detailed stats per player.
     - **Reshuffles teams** using the updated ratings.
     - Generates the **next round** automatically.
- Keeps a **player leaderboard** for the tournament:
  - Primary: **match wins**  
  - Secondary: **ELO**  
  - Tertiary: **ADR** (average damage per round)
- Exposes everything on:
  - A public **tournament standings page** for that shuffle tournament.
  - Individual **player pages** with rating history and stats.

---

## 3. Admin Flow – Step by Step

This section describes what you, as the admin, actually do in the UI.

### 3.1. One-Time Setup

1. **Configure servers**
   - Use the existing **Servers** page to register your CS2 servers (with MatchZy installed).
   - The shuffle tournament mode uses the same automatic server allocation system as other tournaments.

2. **Configure Default Player ELO**
   - In **Settings**, set a **Default Player ELO** (FaceIT-style, default 3000).
   - Any new player created without a specified ELO (Players page, Teams page, imports) will use this value.

3. **Create players**
   - Either:
     - Import players directly on the **Players** page (CSV/JSON), or
     - Create teams in the **Teams** page (team import / manual add) – this automatically creates linked players.
   - Each player has:
     - Steam ID
     - Name
     - Starting ELO (default or customized)

> **Note**: Players and teams are separate concepts. For shuffle tournaments, players are what matter; teams are mainly for “normal” bracketed tournaments.

### 3.2. Creating a Shuffle Tournament

1. Go to **Tournaments → Create Tournament**.
2. Choose **Tournament Type: Shuffle Tournament**.
3. Configure **match structure**:
   - **Team size** (default 5 for 5v5; configurable).
   - **Number of rounds**: you select a sequence of maps; the number of maps = number of rounds.
   - **Round limit**:
     - “First to 13” (standard MR15: 16 max rounds) or
     - “Max rounds” (e.g. 24) with no overtime.
   - **Overtime**:
     - “Enable Overtime” (standard CS2 MR3, first to 4, 10k start), or
     - “Stop at Max Rounds” (no overtime; match can end in a draw).
4. Configure **ELO behavior** (optional, advanced):
   - Choose an **ELO template** (e.g. pure win/loss, or stat-adjusted).
   - This defines to what extent individual stats (ADR, K/D, etc.) influence rating changes.
5. Save the tournament.

### 3.3. Registering Players

1. From the shuffle tournament page, use **“Register Players”**.
2. You can:
   - Select players from the global **Players** list, or
   - Import players if you haven’t already.
3. Registered players are now eligible for team balancing in each round.

### 3.4. Starting and Running Rounds

1. **Start the tournament**:
   - When you click **Start**, the system creates **Round 1**:
     - Uses all registered players.
     - Balances them into teams based on current ELO.
     - Creates matches using the **first map** in your map sequence.
     - Allocates servers automatically as they become available.
2. **Players play their matches**:
   - Players connect via the usual team pages / match pages.
   - MatchZy handles whitelisting based on the match config (only registered players can join).
3. **Round completion**:
   - The system watches all matches in the current round.
   - When **all matches** reach “completed”:
     - ELO ratings are updated for all participating players.
     - Player stats are written to the stats tables.
     - The **next round** is created automatically:
       - Teams are rebalanced using the **new** ratings.
       - Next map in the sequence is used.
       - Servers are allocated for the new matches.
4. This loop repeats until you have played all configured rounds.

### 3.5. Ending the Tournament

When the final round completes:

- The tournament status becomes **Completed**.
- The **tournament standings page** shows:
  - Final leaderboard (wins → ELO → ADR).
  - Top players highlighted.
  - Links to individual player pages.
- As admin, you can:
  - Review demos (if uploads are configured).
  - Export any relevant data you need.

---

## 4. Player Experience

From the player’s point of view:

- They **don’t join teams** manually for this tournament type.
  - Instead, they are **registered as players** in the shuffle tournament.
  - The system decides which team they are on each round.

- Before Round 1:
  - They receive a link (or see a page) where they can:
    - See the current round’s match.
    - Get the **connect IP** and **connect command**.

- During the tournament:
  - Each round, they are placed into new teams based on the updated ELO.
  - They can see:
    - Who is on their team.
    - Who they are playing against.
    - Match status (warmup, live, completed).

- After the tournament:
  - They can visit their **player page**:
    - See final ELO and how it changed per match.
    - See match and stat history (ADR, damage, K/D, MVPs, etc.).
    - See their final position in the shuffle tournament standings.

> **Public URLs (Player-Facing)**
>
> - **Find Player / Claim Page**: `/player`  
>   - Public entry point where players can search for themselves by **Steam ID** or **Steam profile URL** (no login required).  
>   - When a match is running (including shuffle tournaments), you can share this URL with participants so they can quickly find **their own public player page**.
> - **Individual Player Page**: `/player/{steamId}`  
>   - Public profile showing ELO, rating history, match stats, and tournament participation (including shuffle tournaments).  
>   - This is what the **tournament standings page** links to when you click a player.

---

## 5. Rating System & ELO Behavior

### 5.1. Starting Ratings

- Every player has a **starting ELO**, defined as:
  - Either the value you specify when creating/importing that player, or
  - The **Default Player ELO** configured in Settings (FaceIT-style, default 3000).
- This is global – the same player’s rating is shared across all tournaments and modes.

### 5.2. Rating Updates

For each completed match (across **all** tournament types, not just shuffle):

- The system:
  1. Reads the participating teams and players.
  2. Reads match stats (ADR, kills, deaths, etc.) from the MatchZy events.
  3. Runs the **OpenSkill** update for all players in the match:
     - Uses team result (win/loss) as the primary signal.
     - Uses internal mu/sigma values for accuracy/uncertainty.
  4. Optionally applies **ELO template adjustments**:
     - Templates can reward or penalize performance metrics (e.g. high ADR, good support play).
  5. Saves:
     - New ELO value.
     - Internal OpenSkill mu/sigma.
     - A full history entry in `player_rating_history`.

The display you see in the UI is a **converted ELO-like number**, but the engine behind it is OpenSkill.

### 5.3. Tournament Leaderboard Logic

For shuffle tournaments, the leaderboard is:

1. Primary sort: **match wins** (most wins first).
2. Secondary sort: **current ELO** (higher first).
3. Tertiary sort: **average ADR** (higher first, treating “no stats” as 0).

This matches your original requirement:

- Winner = player with most wins.  
- ELO and performance metrics give extra detail and break ties.

---

## 6. Team Balancing & Odd Player Handling

### 6.1. Team Balancing

When creating a round:

- The system:
  1. Looks at all **registered players** and their **current ELO**.
  2. Uses a **greedy algorithm + optimization step** to:
     - Form teams of `teamSize` players (e.g. 5).
     - Minimize the ELO difference between teams.
     - Avoid stacking all high-ELO players on one team.
  3. Spreads very high/low ELO players across matches to avoid extreme mismatches.

This logic is based on the research and algorithm ideas described in your original request and the linked team-balancing research.

### 6.2. Odd Number of Players

When there is an **odd number of players**:

- The system currently uses a **“best effort rotation”**:
  - One player will sit out each round, but we try to:
    - Prefer sitting players who **played the previous round**.
    - Prefer rotating in players who **have played fewer matches overall**.
- Over multiple rounds, this aims to:
  - Even out the number of rounds played per player.
  - Avoid having the same person repeatedly sit out.

This is intentionally kept simple for v1, but the logic is written so it can be evolved (e.g. to fully guarantee perfect rotation) if needed.

---

## 7. Differences vs Your Original “Simple” Proposal

In the issue you described two options: a **simple** Excel-driven manual mode and a **complex** automated mode.

The POC implemented here is much closer to the **complex** option:

- **What we implemented (complex):**
  - Full player system with ratings and history.
  - Automatic team balancing every round using ratings.
  - Automatic match creation and round progression.
  - Public tournament standings and player pages.
  - Rating/leaderboard logic integrated with the rest of the platform.

- **What we did NOT focus on (simple/manual):**
  - A pure “no-tournament-tree, manual matches only” mode tailored specifically for your Excel sheet.
  - That said, the underlying system can still create manual matches, and you can ignore the shuffle tournament type if you prefer your own workflow.

The idea is that you **shouldn’t need Excel anymore** for this type of event; the platform covers the team balancing, match creation, and standings automatically.

---

## 8. Known Limitations & Future Tweaks

To set expectations:

- **Metric-based overtime** (deciding winners based on a metric like total damage at 12–12) is **not implemented**:
  - Overtime options are currently just:
    - “Enable Overtime” (standard MR3).
    - “Stop at Max Rounds”.
- **Odd player rotation** is “best effort”, not mathematically perfect:
  - It already tries to be fair, but we can refine it based on real-world feedback.
- **Excel import of historical ELO** is not a dedicated feature:
  - You can still seed ELO via bulk player import, but there’s no one-click Excel adapter for your specific sheet.

All of these can be iterated on after you’ve tried the POC and given feedback.

---

## 9. How to Review & Provide Feedback

When you test the POC, we recommend focusing on:

1. **Does the tournament flow match your mental model?**
   - Individual competition, automatic team reshuffling, fixed maps per round, fully automatic progression.
2. **Are the teams “fair enough” each round?**
   - Do you feel the balancing is close to what your Excel sheet produced?
3. **Do the standings and player pages show what you need?**
   - Winner selection, tie-breaking, visibility into ELO and stats.
4. **Are any critical controls missing for your use case?**
   - E.g. forced rebalancing, manual overrides, specialized tie-break rules, etc.

Once you’ve gone through a test event (or at least a few rounds with test data), we can adjust:

- The balancing behavior (greedy vs more aggressive optimization).
- The rating templates and how strongly stats influence ELO.
- The handling of edge cases (odd players, server shortages, etc.).

This document should give you enough of a **surface-level view** of how the shuffle tournament POC works to spot any conceptual mismatches or missing pieces before you host a real event.  


