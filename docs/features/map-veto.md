# Map Veto System

The map veto system allows teams to ban and pick maps in a professional Counter-Strike format, just like FaceIT and HLTV matches.

---

## When Veto is Used

Map veto is **only available** for:

- ✅ **Best of 1 (BO1)** tournaments
- ✅ **Best of 3 (BO3)** tournaments
- ✅ **Best of 5 (BO5)** tournaments

Round Robin and Swiss tournaments use **preset maps** and **don't require veto**.

---

## Veto Flow

### BO1 Format (7 Steps)

```
1. Team A bans a map
2. Team B bans a map
3. Team A bans a map
4. Team B bans a map
5. Team A bans a map
6. Team B bans a map
7. Team A picks starting side on remaining map

Result: 1 map with chosen side
```

### BO3 Format (8 Steps)

```
1. Team A bans a map
2. Team B bans a map
3. Team A picks Map 1
4. Team B picks starting side on Map 1
5. Team B picks Map 2
6. Team A picks starting side on Map 2
7. Team A bans a map
8. Team B bans a map

Result: 2 picked maps + 1 decider (with knife round)
```

### BO5 Format (10 Steps)

```
1. Team A bans a map
2. Team B bans a map
3. Team A picks Map 1
4. Team B picks starting side on Map 1
5. Team B picks Map 2
6. Team A picks starting side on Map 2
7. Team A picks Map 3
8. Team B picks starting side on Map 3
9. Team B picks Map 4
10. Team A picks starting side on Map 4

Result: 4 picked maps + 1 decider (with knife round)
```

---

## How Teams Complete Veto

### 1. Tournament Must Be Started

Admin must click **"Start Tournament"** first. Until then, teams see:

!!! warning "Waiting for Tournament to Start"
Your match is ready, but the tournament hasn't started yet. The map veto will become available once the tournament administrator starts the tournament.

### 2. Teams Access Veto Interface

Each team navigates to their public team page:

```
http://your-domain/team/{team-id}/match
```

They see the map veto interface with:

- **Match header:** "Team Alpha VS Team Beta"
- **Progress indicator:** "Step 3 of 8"
- **Current action:** "Team Alpha: PICK A MAP" (colored header)
- **Map grid:** All 8 CS2 maps displayed

### 3. Turn-Based Actions

!!! example "Your Turn" - Header shows: **"Your turn to ban a map"** - Maps are **clickable** with hover effects - Click a map to ban/pick it

!!! info "Not Your Turn" - Header shows: **"Waiting for Team Beta to pick a map..."** - All maps are **grayed out and disabled** - No error messages, just visual feedback

### 4. Map States

**Available Maps:**

- Full color, clickable
- Hover effect shows intent

**Banned Maps:**

- 50% opacity
- Grayscale filter
- Red block icon overlay
- Still visible (not hidden)

**Picked Maps:**

- Green border with thickness
- "MAP 1/2/3" chip in corner
- Side indicator (CT/T) if chosen
- Green checkmark icon

### 5. Side Selection

After picking a map, the team choosing the side sees:

```
Choose Your Starting Side

Select which side you want to start on for Mirage

[Counter-Terrorist (CT)]  [Terrorist (T)]
```

!!! tip "Side Selection Strategy" - **CT-sided maps:** Nuke, Vertigo (often pick CT) - **T-sided maps:** Mirage, Inferno (often pick T) - **Balanced maps:** Dust2, Ancient (either side works)

---

## Real-Time Synchronization

Both teams see the veto progress **live** via WebSocket:

- ✅ When Team A bans Ancient, Team B's page **instantly** shows Ancient as banned
- ✅ Progress bar updates: "Step 2 of 8"
- ✅ Turn indicator updates: "Team Beta: BAN A MAP"
- ✅ Veto history updates: "Team Alpha BANNED Ancient"

**No page refresh needed!**

---

## After Veto Completes

1. ✅ **Veto marked complete** in database
2. ✅ **Match config generated** with picked maps
3. ✅ **Server auto-allocated** from available server pool
4. ✅ **Match loaded** via RCON (`matchzy_loadmatch_url`)
5. ✅ **Teams notified** — Match status changes to "Loaded"
6. ✅ **Connect info shown** — Server IP, port, connect command

Teams then connect to the server and play!

---

## Veto Timeline

Both teams and admins can see the complete veto history:

```
Veto History

Step 1: Team Alpha BANNED Ancient
Step 2: Team Beta BANNED Vertigo
Step 3: Team Alpha PICKED Mirage (Starting T)
Step 4: Team Beta PICKED Dust2 (Starting CT)
Step 5: Team Alpha BANNED Nuke
Step 6: Team Beta BANNED Inferno

Decider: Anubis (Knife Round)
```

---

## Admin Capabilities

Admins can:

- ✅ **View veto progress** for any match (Matches page, Match modal)
- ✅ **Skip veto** if needed (Admin Controls → Skip Veto)
- ✅ **Reset veto** via API: `POST /api/veto/{matchSlug}/reset`
- ✅ **See who's turn it is** in match status

---

## Security

!!! success "Turn-Based Enforcement" - Backend validates which team is making each action - Returns `403 Forbidden` if wrong team tries to act - Frontend disables UI when it's not your turn - No way for teams to cheat or act out of order

!!! info "No Authentication Required"
Team pages are public (no login). Security is based on:

    - **Team identification** from URL (`/team/team-alpha/match`)
    - **Turn validation** on backend
    - **Visual UI hints** on frontend

---

## Troubleshooting

??? failure "Veto not showing for teams?"
**Check:**

    - Tournament status is `in_progress` (admin must start it)
    - Match status is `ready`
    - Match format is BO1, BO3, or BO5

    **Fix:** Admin clicks "Start Tournament" button

??? failure "Can't click any maps?"
**Cause:** It's not your turn

    **Solution:** Wait for other team to complete their action. You'll see:
    "Waiting for {Other Team} to ban a map..."

??? failure "Match not loading after veto?"
**Check:**

    - At least one server is online and available
    - Check server logs: `Admin Tools → Server Events Monitor`
    - Check API logs for allocation errors

    **Fix:** Ensure the webhook URL in the dashboard **Settings** points to the tournament API

---

## Next Steps

- 📊 **[Feature Overview](overview.md)** — See all features in detail
- 🎮 **[Running Matches](../guides/running-matches.md)** — Match management guide
- 🎯 **[First Tournament](../getting-started/first-tournament.md)** — Step-by-step tutorial
