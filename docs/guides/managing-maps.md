# Managing Maps and Map Pools

Complete guide to managing maps and creating custom map pools for your tournaments.

---

## Overview

The Maps & Map Pools page allows you to:

- ✅ Add custom maps with images
- ✅ Create reusable map pools
- ✅ Select map pools during tournament creation
- ✅ Use the default Active Duty pool (7 competitive maps)

**Access:** Navigate to **Maps** in the sidebar

---

## Maps Tab

### Viewing Maps

The Maps tab displays all available maps in your system:

- **Map Cards** - Visual cards showing map image (if available) and display name
- **Map ID** - Internal identifier (e.g., `de_dust2`, `de_mirage`)
- **Display Name** - User-friendly name (e.g., "Dust II", "Mirage")

### Adding a New Map

1. Click **"Add Map"** button (top right)
2. Fill in the form:

   **Map ID** (required):
   - Lowercase letters, numbers, and underscores only
   - Example: `de_dust2`, `cs_italy`, `de_mirage`
   - Cannot be changed after creation

   **Display Name** (required):
   - User-friendly name shown in UI
   - Example: "Dust II", "Mirage", "Ancient"

   **Map Image** (optional):
   - Upload PNG, JPG, GIF, or WebP (max 5MB)
   - Or click **"Fetch from GitHub"** to auto-download from [ghostcap-gaming/cs2-map-images](https://github.com/ghostcap-gaming/cs2-map-images)
   - Preview shown before saving

3. Click **"Create"**

### Editing a Map

1. Click on any map card
2. Click **"Edit"** in the actions modal
3. Modify display name or image
4. Click **"Update"**

> **Note:** Map ID cannot be changed after creation

### Deleting a Map

1. Click on the map card
2. Click **"Delete"** in the actions modal
3. Confirm deletion

> **Warning:** Deleting a map removes it from all map pools that use it

---

## Map Pools Tab

### Viewing Map Pools

The Map Pools tab shows:

- **Default Pool** - Active Duty pool (7 competitive maps) - marked with "Default" chip
- **Custom Pools** - Your created pools showing:
  - Pool name
  - Number of maps
  - First 5 maps as chips (+X more if applicable)

### Creating a Map Pool

1. Switch to **"Map Pools"** tab
2. Click **"Create Map Pool"** button
3. Fill in:

   **Map Pool Name** (required):
   - Example: "My Custom Pool", "Aim Maps Only", "All Maps"

   **Select Maps** (required, at least 1):
   - Use the autocomplete dropdown
   - Type map name or select from list
   - Selected maps appear as chips
   - Click **"Add all"** to select every available map

4. Click **"Create"**

### Editing a Map Pool

1. Click on any map pool card
2. Click **"Edit"** in the actions modal
3. Modify name or map selection
4. Click **"Update"**

### Deleting a Map Pool

1. Click on the map pool card
2. Click **"Delete"** in the actions modal
3. Confirm deletion

---

## Using Map Pools in Tournaments

### During Tournament Creation

When creating a tournament with **BO1**, **BO3**, or **BO5** format:

1. Navigate to **Step 3: Map Pool**
2. Select from dropdown:

   **Options:**
   - **Active Duty** - Default 7 competitive maps (recommended for veto)
   - **Your Custom Pools** - Any pools you've created
   - **Custom** - Manually select maps for this tournament

3. If selecting **Custom**:
   - Use autocomplete to choose maps
   - Click **"Add All"** to select all available maps
   - Click **"Save Map Pool"** to create a new pool from your selection

### Map Pool Requirements

**For Veto Formats (BO1/BO3/BO5):**
- ⚠️ **Exactly 7 maps required** for proper veto flow
- System shows warning if pool has ≠ 7 maps
- Active Duty pool automatically has 7 maps

**For Round Robin/Swiss:**
- Any number of maps allowed
- Maps rotate automatically

### Map Pool Selection Tips

**Best Practices:**

- ✅ Use **Active Duty** for standard competitive tournaments
- ✅ Create custom pools for specific map sets (e.g., "Aim Maps", "Old School")
- ✅ Save frequently used combinations as pools
- ✅ Name pools descriptively (e.g., "7 Map Competitive", "5 Map Pool")

---

## Map Images

### Automatic Image Fetching

When creating a map, you can fetch images automatically:

1. Enter Map ID (e.g., `de_dust2`)
2. Click **"Fetch from GitHub"**
3. System downloads from [ghostcap-gaming/cs2-map-images](https://github.com/ghostcap-gaming/cs2-map-images)
4. Image preview appears if found

### Manual Image Upload

1. Click **"Upload Image"**
2. Select PNG, JPG, GIF, or WebP file
3. Max size: 5MB
4. Preview shown before saving

### Image Display

- Maps show image in cards (if available)
- Placeholder icon shown if no image
- Images used in map veto interface
- Images displayed on team match pages

---

## Default Active Duty Pool

The **Active Duty** pool includes 7 competitive maps:

1. Ancient
2. Anubis
3. Dust II
4. Inferno
5. Mirage
6. Nuke
7. Vertigo

This pool is:
- ✅ Always available
- ✅ Pre-configured with 7 maps
- ✅ Recommended for BO1/BO3/BO5 tournaments
- ✅ Cannot be edited or deleted

---

## Troubleshooting

### Map Pool Has Wrong Number of Maps

**For Veto Formats:**
- System requires exactly 7 maps
- Warning shown if pool has ≠ 7 maps
- Create new pool with 7 maps or use Active Duty

### Map Image Not Showing

- Check image URL is valid
- Try re-uploading image
- Use "Fetch from GitHub" for standard maps
- Ensure file is < 5MB

### Can't Delete Map

- Map may be in use by active tournament
- Remove from all map pools first
- Check if map is in default Active Duty pool (cannot remove)

### Map Pool Not Appearing in Tournament

- Ensure map pool has at least 1 map
- Check tournament format supports map pools
- Verify map pool wasn't deleted

---

## Next Steps

- 🎮 **[First Tournament](first-tournament.md)** - Create your first tournament with custom maps
- 🗺️ **[Map Veto System](../features/map-veto.md)** - Learn about the veto process
- 📖 **[Running Matches](running-matches.md)** - Manage matches with your map pools

