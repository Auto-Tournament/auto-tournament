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

### BO1 Format (7 Steps) - CS Major Standard

```
1. Team A removes 2 maps (first)
2. Team A removes 2 maps (second)
3. Team B removes 3 maps (first)
4. Team B removes 3 maps (second)
5. Team B removes 3 maps (third)
6. Team A removes 1 map
7. Team B chooses starting side on remaining map

Result: 1 map with chosen side
```

### BO3 Format (9 Steps) - CS Major Standard

```
1. Team A removes 1 map
2. Team B removes 1 map
3. Team A picks Map 1
4. Team B chooses starting side on Map 1
5. Team B picks Map 2
6. Team A chooses starting side on Map 2
7. Team B removes 1 map
8. Team A removes 1 map
9. Team B chooses starting side on Map 3 (decider)

Result: 2 picked maps + 1 decider map (with side chosen by Team B)
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

## Custom Veto Formatting

The system supports **custom veto orders** that comply with CS Major rules. Tournament organizers can define custom veto sequences while ensuring they follow professional Counter-Strike standards.

### CS Major Compliance

All veto formats are validated to ensure compliance with the [Counter-Strike Major Supplemental Rulebook](https://github.com/ValveSoftware/counter-strike_rules_and_regs/blob/main/major-supplemental-rulebook.md):

- ✅ **BO1**: Must ban 6 maps (leaving 1), then pick starting side
- ✅ **BO3**: Must pick 2 maps with side picks, ban 4 maps (2 initial + 2 final, leaving 1 decider)
- ✅ **BO5**: Must pick 4 maps with side picks, ban 2 maps (leaving 1 decider)
- ✅ Side picks must come after map picks
- ✅ Sequential step numbering starting from 1
- ✅ Valid team assignments (team1/team2) and actions (ban/pick/side_pick)

### Using Custom Veto Orders

Custom veto orders can be configured in tournament settings. If a custom order is provided and passes validation, it will be used instead of the standard format. If validation fails, the system automatically falls back to the standard CS Major format.

**Example Custom BO3 Format:**
```json
{
  "customVetoOrder": {
    "bo3": [
      { "step": 1, "team": "team1", "action": "ban" },
      { "step": 2, "team": "team2", "action": "ban" },
      { "step": 3, "team": "team1", "action": "pick" },
      { "step": 4, "team": "team2", "action": "side_pick" },
      { "step": 5, "team": "team2", "action": "pick" },
      { "step": 6, "team": "team1", "action": "side_pick" },
      { "step": 7, "team": "team1", "action": "ban" },
      { "step": 8, "team": "team2", "action": "ban" },
      { "step": 9, "team": "team2", "action": "side_pick" }
    ]
  }
}
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
3. ✅ **Server allocation attempted** — System tries to allocate from available server pool
4. ⏳ **If no server available** — Backend polls every 10 seconds for available servers
5. ✅ **Server auto-allocated** when one becomes available
6. ✅ **Match loaded** via RCON (`matchzy_loadmatch_url`)
7. ✅ **Teams notified via WebSocket** — Match status updates in real-time to "Loaded"
8. ✅ **Connect info shown** — Server IP, port, connect command

!!! info "Server Allocation"
    If no servers are available immediately after veto completion, the system automatically polls every 10 seconds in the background. Teams will see "WAITING FOR SERVER" status, and the match will be assigned as soon as a server becomes available. All updates are sent via WebSocket, so no page refresh is needed!

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
