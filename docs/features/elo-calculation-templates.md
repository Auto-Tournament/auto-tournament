# ELO Calculation Templates - Design Document

## Overview

This document describes the design and implementation of configurable ELO calculation templates that allow admins to customize how player performance statistics affect ELO ratings beyond the base OpenSkill win/loss calculation.

## Core Concept

The system uses a **hybrid approach**:
1. **Base Rating**: OpenSkill calculates the base ELO change based on team win/loss (pure Bayesian rating)
2. **Stat Adjustments**: Optional stat-based adjustments are applied as a post-processing step
3. **Final ELO**: Base ELO + stat adjustments = final displayed ELO

## Default Behavior

**By default, the system uses pure OpenSkill** (no stat adjustments):
- Only team win/loss affects ELO
- Individual performance stats are tracked but not used in rating
- Simple, fair, and statistically sound

## ELO Calculation Templates

Admins can create custom templates that define how individual player stats affect ELO:

### Template Structure

```typescript
interface EloCalculationTemplate {
  id: string;
  name: string;
  description?: string;
  enabled: boolean; // If false, uses pure OpenSkill (default)
  
  // Stat weights (ELO points per unit)
  weights: {
    kills?: number;           // ELO per kill
    deaths?: number;          // ELO per death (negative)
    assists?: number;         // ELO per assist
    flashAssists?: number;    // ELO per flash assist
    headshotKills?: number;   // ELO per headshot kill
    damage?: number;          // ELO per damage point
    utilityDamage?: number;   // ELO per utility damage point
    kast?: number;            // ELO per KAST percentage point
    mvps?: number;            // ELO per MVP
    score?: number;           // ELO per score point
    adr?: number;             // ELO per ADR point (calculated from damage/rounds)
  };
  
  // Optional caps/limits
  maxAdjustment?: number;     // Maximum ELO adjustment per match (positive)
  minAdjustment?: number;     // Minimum ELO adjustment per match (negative)
  
  createdAt: number;
  updatedAt: number;
}
```

### Calculation Formula

```typescript
// After OpenSkill calculates base rating
const baseELO = openSkillToDisplayElo(newRating);

// Calculate stat-based adjustment
const statAdjustment = 
  (playerStats.kills * template.weights.kills || 0) +
  (playerStats.deaths * template.weights.deaths || 0) +
  (playerStats.assists * template.weights.assists || 0) +
  (playerStats.flashAssists * template.weights.flashAssists || 0) +
  (playerStats.headshotKills * template.weights.headshotKills || 0) +
  (playerStats.damage * template.weights.damage || 0) +
  (playerStats.utilityDamage * template.weights.utilityDamage || 0) +
  (playerStats.kast * template.weights.kast || 0) +
  (playerStats.mvps * template.weights.mvps || 0) +
  (playerStats.score * template.weights.score || 0) +
  (calculateADR(playerStats) * template.weights.adr || 0);

// Apply caps if defined
const cappedAdjustment = Math.max(
  template.minAdjustment || -Infinity,
  Math.min(template.maxAdjustment || Infinity, statAdjustment)
);

const finalELO = baseELO + cappedAdjustment;
```

### Example Templates

#### Template 1: "Pure Win/Loss" (Default)
```json
{
  "id": "pure-win-loss",
  "name": "Pure Win/Loss",
  "description": "Only team result affects ELO. No stat adjustments.",
  "enabled": false,
  "weights": {}
}
```

#### Template 2: "Kill-Focused"
```json
{
  "id": "kill-focused",
  "name": "Kill-Focused",
  "description": "Rewards fragging ability. Kills and headshots matter most.",
  "enabled": true,
  "weights": {
    "kills": 10,
    "deaths": -5,
    "headshotKills": 5,
    "assists": 2,
    "mvps": 15,
    "adr": 0.1
  },
  "maxAdjustment": 50,
  "minAdjustment": -30
}
```

#### Template 3: "Support-Focused"
```json
{
  "id": "support-focused",
  "name": "Support-Focused",
  "description": "Rewards support play. Assists, utility, and team play matter.",
  "enabled": true,
  "weights": {
    "assists": 8,
    "flashAssists": 5,
    "utilityDamage": 0.05,
    "kast": 0.5,
    "kills": 5,
    "deaths": -3,
    "mvps": 10
  },
  "maxAdjustment": 40,
  "minAdjustment": -20
}
```

#### Template 4: "Balanced Performance"
```json
{
  "id": "balanced-performance",
  "name": "Balanced Performance",
  "description": "Balanced approach rewarding all aspects of play.",
  "enabled": true,
  "weights": {
    "kills": 7,
    "deaths": -4,
    "assists": 5,
    "flashAssists": 3,
    "headshotKills": 3,
    "damage": 0.02,
    "kast": 0.3,
    "mvps": 12,
    "adr": 0.08
  },
  "maxAdjustment": 45,
  "minAdjustment": -25
}
```

## Database Schema

### `elo_calculation_templates` Table

```sql
CREATE TABLE IF NOT EXISTS elo_calculation_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  
  -- Stat weights (JSON)
  weights TEXT NOT NULL DEFAULT '{}',
  
  -- Optional caps
  max_adjustment INTEGER,
  min_adjustment INTEGER,
  
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### Modified `tournament` Table

Add field to store selected template:
```sql
ALTER TABLE tournament ADD COLUMN elo_template_id TEXT REFERENCES elo_calculation_templates(id);
```

### Modified `player_rating_history` Table

Add fields to track stat adjustments:
```sql
ALTER TABLE player_rating_history ADD COLUMN base_elo_after INTEGER;
ALTER TABLE player_rating_history ADD COLUMN stat_adjustment INTEGER;
ALTER TABLE player_rating_history ADD COLUMN template_id TEXT;
```

## Service Architecture

### `eloTemplateService.ts`

```typescript
class EloTemplateService {
  // CRUD operations
  async createTemplate(input: CreateTemplateInput): Promise<EloTemplate>
  async updateTemplate(id: string, input: UpdateTemplateInput): Promise<EloTemplate>
  async deleteTemplate(id: string): Promise<boolean>
  async getTemplate(id: string): Promise<EloTemplate | null>
  async getAllTemplates(): Promise<EloTemplate[]>
  
  // Template application
  async applyTemplate(
    templateId: string | null,
    baseELO: number,
    playerStats: PlayerStatLine
  ): Promise<number>
}
```

### Modified `ratingService.ts`

Update `updatePlayerRatings()` to:
1. Calculate base ELO using OpenSkill (existing)
2. Fetch player stats from `player_match_stats` table
3. Get tournament's selected template (or default "pure-win-loss")
4. Apply stat adjustments if template is enabled
5. Store both `base_elo_after` and `stat_adjustment` in history
6. Update player's `current_elo` with final adjusted value

## API Endpoints

### Template Management

- `GET /api/elo-templates` - List all templates
- `GET /api/elo-templates/:id` - Get template details
- `POST /api/elo-templates` - Create new template
- `PUT /api/elo-templates/:id` - Update template
- `DELETE /api/elo-templates/:id` - Delete template

### Tournament Integration

- `PUT /api/tournament/:id/elo-template` - Set template for tournament
- `GET /api/tournament/:id/elo-template` - Get tournament's template

## UI Components

### ELO Calculation Templates Page (`/elo-templates`)

- List of all templates (table/grid)
- Create new template button
- Edit/delete actions
- Preview template (show weights)
- Set as default option

### Template Editor Modal

- Template name and description
- Weight inputs for each stat:
  - Kills
  - Deaths (negative)
  - Assists
  - Flash Assists
  - Headshot Kills
  - Damage
  - Utility Damage
  - KAST
  - MVPs
  - Score
  - ADR
- Min/max adjustment caps
- Enable/disable toggle
- Preview calculation example

### Tournament Creation/Edit

- Add template selection dropdown
- Show template description
- Preview how template affects ELO
- Default: "Pure Win/Loss" (no adjustments)

## Implementation Phases

### Phase 1: Database & Service Layer
1. Create `elo_calculation_templates` table
2. Add `elo_template_id` to `tournament` table
3. Add stat adjustment fields to `player_rating_history`
4. Create `eloTemplateService.ts`
5. Create API routes for template management

### Phase 2: Rating Service Integration
1. Modify `updatePlayerRatings()` to fetch player stats
2. Add template application logic
3. Store base ELO and adjustments separately
4. Update rating history to include adjustments

### Phase 3: Admin UI
1. Create ELO Templates page
2. Create template editor modal
3. Add template selection to tournament creation
4. Add template preview/description

### Phase 4: Testing & Validation
1. Test with various templates
2. Verify stat adjustments are calculated correctly
3. Test edge cases (missing stats, extreme values)
4. Validate caps work correctly

## Considerations

### Statistical Validity

- OpenSkill's base rating remains statistically sound
- Stat adjustments are additive bonuses/penalties
- Caps prevent extreme adjustments
- Both base and adjusted ELO are stored for analysis

### Performance

- Stat adjustments are simple arithmetic (fast)
- Player stats are already stored in `player_match_stats`
- No additional database queries needed (stats fetched with match data)

### Fairness

- All players on winning team get same base ELO change
- Individual adjustments reward/punish performance
- Caps prevent excessive adjustments
- Default template (pure win/loss) remains available

### Backward Compatibility

- Default template (pure win/loss) ensures existing behavior
- Tournaments without template use default
- Rating history stores both base and adjusted values
- Can analyze impact of templates on ratings

## Future Enhancements

- Template presets (quick setup for common scenarios)
- Template testing/validation tools
- Historical analysis of template impact
- Per-tournament template customization
- Template sharing/export

