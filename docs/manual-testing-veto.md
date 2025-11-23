# Manual Testing Guide: CS Major Veto Format

This guide helps you manually test the CS Major veto format to verify it matches the [Counter-Strike Major Supplemental Rulebook](https://github.com/ValveSoftware/counter-strike_rules_and_regs/blob/main/major-supplemental-rulebook.md#map-pick-ban).

## Prerequisites

1. **Start the database:**

   ```bash
   yarn db
   ```

2. **Start the application:**

   ```bash
   yarn dev
   ```

3. **Open the application:**
   - Go to http://localhost:3069
   - Login with API token: `admin123` (default)

## Test BO1 Format

### Step 1: Create Two Teams

1. Go to **Teams** page
2. Click **"Add Team"**
3. Create Team A:
   - Name: `Test Team A`
   - Add 5 players (any Steam IDs work for testing)
4. Click **"Add Team"** again
5. Create Team B:
   - Name: `Test Team B`
   - Add 5 players

### Step 2: Create BO1 Tournament

1. Go to **Tournaments** page
2. Click **"Create Tournament"**
3. Fill in:
   - **Name:** `CS Major BO1 Test`
   - **Type:** `Single Elimination`
   - **Format:** `BO1` ⚠️ (This is important!)
   - **Maps:** Select all 7 Active Duty maps:
     - de_mirage
     - de_inferno
     - de_ancient
     - de_anubis
     - de_dust2
     - de_vertigo
     - de_nuke
4. Select both teams (Team A and Team B)
5. Click **"Create Tournament"**

### Step 3: Generate Bracket

1. Click **"Generate Bracket"**
2. You should see 1 match created

### Step 4: Start Tournament

1. Click **"Start Tournament"**
2. Tournament status should change to "In Progress"

### Step 5: Access Team Pages

You'll need two browser windows/tabs to test both teams:

**Window 1 (Team A):**

- Copy Team A's team page URL (shown in Teams page or Bracket)
- Example: `http://localhost:3069/team/test-team-a/match`

**Window 2 (Team B):**

- Copy Team B's team page URL
- Example: `http://localhost:3069/team/test-team-b/match`

### Step 6: Execute Veto Process

Follow these steps in order, verifying each one:

#### ✅ Step 1: Team A bans 1 map (first of 2)

- **Window 1 (Team A):** Should show "BAN A MAP"
- Click on any map (e.g., `de_mirage`)
- ✅ Verify: Map shows as banned in both windows

#### ✅ Step 2: Team A bans 1 map (second of 2)

- **Window 1 (Team A):** Still Team A's turn
- Click another map (e.g., `de_inferno`)
- ✅ Verify: Now 2 maps banned

#### ✅ Step 3: Team B bans 1 map (first of 3)

- **Window 2 (Team B):** Should now show "BAN A MAP"
- Click a map (e.g., `de_ancient`)
- ✅ Verify: Now 3 maps banned total

#### ✅ Step 4: Team B bans 1 map (second of 3)

- **Window 2 (Team B):** Still Team B's turn
- Click another map (e.g., `de_anubis`)
- ✅ Verify: Now 4 maps banned total

#### ✅ Step 5: Team B bans 1 map (third of 3)

- **Window 2 (Team B):** Still Team B's turn
- Click another map (e.g., `de_dust2`)
- ✅ Verify: Now 5 maps banned total

#### ✅ Step 6: Team A removes 1 map

- **Window 1 (Team A):** Should now show "BAN A MAP"
- Click another map (e.g., `de_vertigo`)
- ✅ Verify: Now 6 maps banned, only 1 remaining (should be `de_nuke`)

#### ✅ Step 7: Team B chooses starting side

- **Window 2 (Team B):** Should show side selection (CT/T buttons)
- Click **"CT"** (or "T" if you prefer)
- ✅ Verify: Veto completes!
- ✅ Verify: Only 1 map remains (`de_nuke`)
- ✅ Verify: Side is shown (Team B CT, Team A T)

### Step 7: Verify Final Config

Check the match config API endpoint:

```bash
# Get the match slug from the browser (it's in the URL)
# Example: http://localhost:3069/team/test-team-a/match shows the match slug

# Then check the config:
curl http://localhost:3069/api/matches/{match-slug}.json | jq
```

**Expected Result:**

```json
{
  "num_maps": 1,
  "maplist": ["de_nuke"],
  "map_sides": ["team2_ct"],  // or ["team1_ct"] depending on which side Team B picked
  ...
}
```

✅ Verify:

- `num_maps` is `1` (BO1)
- `maplist` has exactly 1 map
- `map_sides` shows the correct side

---

## Test BO3 Format

### Setup (Similar to BO1)

1. Create same two teams (or create new ones)
2. Create tournament with:
   - **Format:** `BO3` ⚠️
   - **Maps:** All 7 Active Duty maps
3. Generate bracket and start tournament

### BO3 Veto Process (9 Steps)

#### ✅ Step 1: Team A removes 1 map

- Team A bans a map (e.g., `de_mirage`)
- ✅ Verify: 1 map banned

#### ✅ Step 2: Team B removes 1 map

- Team B bans a map (e.g., `de_inferno`)
- ✅ Verify: 2 maps banned

#### ✅ Step 3: Team A picks Map 1

- Team A picks a map (e.g., `de_ancient`)
- ✅ Verify: Map shows as "picked" for Map 1

#### ✅ Step 4: Team B chooses starting side on Map 1

- Team B selects side (CT or T)
- ✅ Verify: Map 1 shows with chosen side

#### ✅ Step 5: Team B picks Map 2

- Team B picks a map (e.g., `de_anubis`)
- ✅ Verify: Map shows as "picked" for Map 2

#### ✅ Step 6: Team A chooses starting side on Map 2

- Team A selects side (CT or T)
- ✅ Verify: Map 2 shows with chosen side

#### ✅ Step 7: Team B removes 1 map

- Team B bans a map (e.g., `de_dust2`)
- ✅ Verify: 3 maps banned total

#### ✅ Step 8: Team A removes 1 map

- Team A bans a map (e.g., `de_vertigo`)
- ✅ Verify: 4 maps banned, 3 maps remaining (1 picked, 1 picked, 1 left)

#### ✅ Step 9: Team B chooses starting side on Map 3 (decider)

- Team B selects side for the remaining map (`de_nuke`)
- ✅ Verify: Veto completes!
- ✅ Verify: 3 maps total (2 picked, 1 decider)
- ✅ Verify: All maps have sides assigned

### Verify BO3 Final Config

```bash
curl http://localhost:3069/api/matches/{match-slug}.json | jq
```

**Expected Result:**

```json
{
  "num_maps": 3,
  "maplist": ["de_ancient", "de_anubis", "de_nuke"],
  "map_sides": ["team2_ct", "team1_ct", "team2_ct"],  // Example sides
  ...
}
```

✅ Verify:

- `num_maps` is `3` (BO3)
- `maplist` has exactly 3 maps
- `map_sides` has 3 entries matching the maplist

---

## Quick Test Checklist

### BO1 Checklist:

- [ ] Team A bans 2 maps (steps 1-2)
- [ ] Team B bans 3 maps (steps 3-5)
- [ ] Team A bans 1 map (step 6)
- [ ] Team B picks starting side (step 7)
- [ ] Final result: 1 map with side chosen
- [ ] Config shows `num_maps: 1` and 1 map in `maplist`

### BO3 Checklist:

- [ ] Team A removes 1 map
- [ ] Team B removes 1 map
- [ ] Team A picks Map 1
- [ ] Team B picks side on Map 1
- [ ] Team B picks Map 2
- [ ] Team A picks side on Map 2
- [ ] Team B removes 1 map
- [ ] Team A removes 1 map
- [ ] Team B picks side on Map 3 (decider)
- [ ] Final result: 3 maps (2 picked + 1 decider)
- [ ] Config shows `num_maps: 3` and 3 maps in `maplist`

## Troubleshooting

**Veto stuck?**

- Check browser console for errors
- Verify both teams have access to their team pages
- Check server logs for API errors

**Wrong format?**

- Verify tournament format is BO1 or BO3
- Check that you selected the correct format when creating tournament

**Can't see veto interface?**

- Make sure tournament is started
- Verify you're on the team's match page (not team info page)
- Check that teams are assigned to the match

## Expected Behavior

✅ **Correct CS Major Format:**

- BO1: 7 steps (6 bans + 1 side pick), results in 1 map
- BO3: 9 steps (2 bans + 2 picks with sides + 2 bans + 1 side pick), results in 3 maps
- Turn-based: Only correct team can act at each step
- Real-time: Both teams see updates instantly

❌ **Incorrect Behavior:**

- Wrong number of steps
- Wrong team's turn
- Missing side picks
- Wrong number of final maps
