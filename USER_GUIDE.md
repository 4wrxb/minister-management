# Ministry Management System - User Guide

## Overview

This application streamlines the process of assigning ministry positions during State vs State (SVS) events in Whiteout Survival based on player resources and time preferences.

## For Players

### Application Closing Time

Your minister may set a deadline for new applications. The home page displays the status:
- **Green text** - Applications are open (shows when they close)
- **Red text** - "Applications closed" (new submissions are no longer accepted)

After the deadline, the "Submit New Application" card is grayed out and the form shows an "Applications closed" message. However, **existing players can still update** their submissions using their FID. The status auto-refreshes every 30 seconds.

### Submitting Your Application

1. **Navigate to the home page**
2. **Click "Submit New Application"** (only available while applications are open)
3. **Step 1: Enter Your Information**
   - Player ID/FID (required - this is your unique identifier, you'll need it to update later)
   - Click **"Load from WOS"** to auto-fill your game name, avatar, and furnace level from the WOS API
   - Game Name (required - auto-filled if you use Load from WOS, but editable)
   - Alliance Tag (required, 3 characters max - displayed as `[TAG]` next to your name)
   - All your speedups in days
   - Your fire crystals, refined fire crystals, and shards (fire crystal fields may be hidden depending on admin settings)
   - **Note:** If you try to leave the form with unsaved changes, you will be asked to confirm

4. **Step 2: Select Time Preferences**
   - Select all times (UTC) when you're available
   - **Select ALL times you could possibly be available** - more slots means a better chance of being assigned
   - Time slots are color-coded with a **heat map**: blue = low demand, yellow = medium, red = high demand. Choosing less popular times improves your chances.
   - Click any time to select/deselect

5. **Step 3: Review and Confirm**
   - Double-check all information (including your avatar preview and alliance tag)
   - Click "Submit" when ready

6. **Success!**
   - Your application has been submitted
   - Remember your Player ID (FID) - you'll need it to update your submission later

### Understanding Your Assignment

- Assigned times may be **+/- 20 minutes** from the hour you selected. For example, if you selected 14:00, your actual slot could be 13:40-14:20.
- Assignments are **subject to change** until the schedule is finalized.
- If the schedule is published but applications are still open, you will see an amber banner warning that assigned times may still change.

### Viewing the Published Schedule

Once your minister publishes the schedule, you can view your assigned time slot on the **Published Schedule** page, accessible from the home page.

### Player Guide

A comprehensive in-app **Player Guide** is available at `/guide`, accessible from the home page. It covers the submission process, time preferences, point calculations, and tips.

### Updating Your Submission

1. **Click "Update Your Submission" from home page** (available even after applications close)
2. **Enter your Player ID (FID)**
3. **Click "Load My Data"**
4. **Edit your information**
5. **Note:** You will see a disclaimer that assignments are subject to change
6. **Click "Update" to save changes**

## For Ministers/Admins

### Logging In

1. **Click "Minister Administration" from home page**
2. **Enter your password**
   - Admin password: Full access
   - Minister password: Full access (same permissions)
3. **Click "Login"**

### Managing Players

1. **Go to "Players" tab**
2. **View all submissions** in a sortable table
   - Click column headers to sort
   - Use search box to find specific players (searches name, FID, and alliance tag)
   - View calculated points for each day
   - Player avatars and alliance tags `[TAG]` are displayed next to names

3. **Edit a Player**
   - Click the edit icon (pencil)
   - Modify any information (including alliance tag)
   - Click "Save"

4. **Delete a Player**
   - Click the delete icon (trash)
   - Confirm deletion

5. **Remove All Players**
   - Click "Remove All" to clear all player data
   - Requires confirmation (must type "DELETE" to confirm)

### Managing Assignments

1. **Go to "Assignments" tab**
2. **Select Day:**
   - Monday (Construction)
   - Tuesday or Friday (Research - configurable in Settings)
   - Thursday (Troop Training)

3. **Auto-Assign Players:**
   - Click "Auto Assign" button
   - System will automatically assign players based on:
     - Their point calculations
     - Their time preferences
     - Highest points get priority
   - **Locked (sticky) players are preserved** - they will not be moved during auto-assign
   - Player cards show avatar, furnace level icon, alliance tag, and points

4. **Sticky (Locked) Assignments:**
   - Click the **lock icon** on any player card to lock them into their current time slot
   - Locked players are preserved when you run auto-assign again
   - Useful for VIPs, officers, or players with strict availability
   - Click the lock icon again to unlock

5. **Manual Adjustments:**
   - Drag and drop players between time slots
   - Drag players to "Unassigned" area to remove them
   - Drag unassigned players to time slots to assign them
   - Time slots show a **heat map** visualization (blue=low demand, yellow=medium, red=high demand)

6. **Publishing Schedules:**
   - Click **"Publish"** to make a day's schedule visible to players on the Published Schedule page
   - Each day can be published or unpublished independently
   - Click **"Unpublish"** to hide a day's schedule from players
   - If applications are still open when the schedule is published, players see an amber disclaimer that times may change

7. **Export to Excel:**
   - Click "Export to Excel" button
   - Downloads a multi-tab workbook with:
     - **Monday** tab - Construction day assignments
     - **Tuesday/Friday** tab - Research day assignments
     - **Thursday** tab - Troop training day assignments
     - **Unassigned** tab - Players not assigned to any day
   - Each tab includes: Time Slot, FID, Alliance, Game Name, all resource columns, and Points

8. **Export/Import Players (JSON):**
   - **Export**: Download all player data as a JSON file for backup
   - **Import**: Restore player data from a previously exported JSON file
   - Useful for backups before major changes or migrating between environments

### Settings Tab

The **Settings** tab in the admin dashboard provides configuration options:

1. **State Number** - Set your state number to display a dynamic "Welcome, State {N}" message on the home page
2. **Application Closing Time** - Set a deadline (date and time) after which new player submissions are blocked. Existing players can still update their submissions. The home page shows the countdown in green (open) or a red "Applications closed" message.
3. **Research Day Toggle** - Switch the research day between **Tuesday** and **Friday** to match your state's SVS schedule
4. **Show Fire Crystal Fields** - Toggle whether fire crystal resource fields appear in the player submission form. Useful if your state does not use fire crystals for point calculations.

### Admin Guide

A comprehensive in-app **Admin Guide** is available at `/admin/guide`, accessible from the admin dashboard. It covers all admin features including player management, auto-assignment, publishing, settings, and best practices.

## Point Calculation System

### Monday - Construction Day
- **1 point** per minute of construction speedups
- **1 point** per minute of general speedups
- **30,000 points** per refined fire crystal
- **2,000 points** per fire crystal

### Tuesday - Research Day
- **1 point** per minute of research speedups
- **1 point** per minute of general speedups
- **1,000 points** per fire crystal shard

### Thursday - Troop Training Day
- **1 point** per day of troop training speedups

## Time Slots

- All times are in **UTC timezone** (use the timezone selector in the form to preview them in your local time)
- **Player submission:** select hourly preferences (`00:00`–`23:00`); preferences are saved per-day (construction / research / troop)
- **Assignment slots:** the auto-assigner uses a fixed list of **49 thirty-minute slots anchored at end-of-day (23:50)** rather than midnight. The sequence is `23:50, 00:20, 00:50, 01:20, ..., 23:20, 23:50+`, where `23:50` is the pre-midnight slot and `23:50+` is the end-of-day slot (shown as `23:50 (+1d)` in exports).
- **±20 minute tolerance:** each hour you select maps to three candidate 30-min slots within ±20 minutes — e.g. selecting `14:00` makes you eligible for `13:50`, `14:20`, or `14:50`. You get the first one that's empty (highest-points players first).
- Time slots display a **heat map** during selection, showing how many other players have chosen each slot
- Your selected timezone only affects how times are displayed in the frontend; all saved scheduling data remains UTC

## Tips

### For Players
- **Be honest** about your resources
- **Select ALL available time slots** to increase chances of assignment - the more flexible you are, the better
- **Use the heat map** to see which times are less competitive
- **Update regularly** if your resources change
- **Note your FID** so you can update later
- **Check the Player Guide** (`/guide`) for detailed instructions
- **Remember the +/- 20 minute tolerance** - your actual slot may differ slightly from the hour you selected

### For Ministers
- **Configure Settings first** - set your state number, closing time, and research day before collecting submissions
- **Set an application closing time** to enforce a deadline for new submissions
- **Run auto-assign first** to get the optimal initial assignment
- **Lock key players** before re-running auto-assign to preserve important assignments
- **Make manual adjustments** as needed for special circumstances
- **Publish schedules per day** when assignments are finalized
- **Export players to JSON** before making major changes (as a backup)
- **Export to Excel** before finalizing for record-keeping
- **Check unassigned players** and try to accommodate them manually
- **Check the Admin Guide** (`/admin/guide`) for detailed instructions

## Troubleshooting

### Can't Find My Submission
- Make sure you're using the correct Player ID (FID)
- Check that you submitted successfully (you should have seen a success message)
- Contact your minister if the issue persists

### Wrong Information Submitted
- Use "Update Your Submission" feature
- Enter your FID and update the information

### Not Getting Assigned
- Check if you selected enough time slots
- Consider increasing your resources
- Speak with your minister about manual assignment

### Assignment Not Showing Up
- Ensure you submitted your application before the deadline
- Check your point calculation - you may need more resources
- Contact your minister for manual assignment

## Language Support

The application supports:
- 🇬🇧 English
- 🇰🇷 Korean (한국어)
- 🇨🇳 Chinese (中文)
- 🇹🇷 Turkish (Türkçe)
- 🇸🇦 Arabic (العربية)

Use the language selector in the top-right corner to change languages.

The frontend localization layer also formats dates and numbers per language, so point totals and closing times follow the selected locale.

## Support

For technical issues or questions:
- Contact your state's technical administrator
- Report bugs on GitHub (if applicable)

## Best Practices

### Before SVS
1. Admin configures Settings (state number, research day, closing time)
2. Players submit their information before the closing deadline
3. Ministers review all submissions in the Players tab
4. Run auto-assignment for each day
5. Lock key assignments using sticky/lock icons
6. Make manual adjustments as needed
7. Publish schedules per day when finalized
8. Export final assignments to Excel
9. Share with all alliances

### During SVS
- Players can update their information if resources change (even after closing time)
- Ministers can quickly reassign if needed
- Lock important assignments before re-running auto-assign
- Unpublish, adjust, and re-publish schedules as needed
- Export updated assignments as needed

### After SVS
- Export players to JSON for backup
- Keep Excel export for records
- Thank players for participation
- Review process for improvements

## Security Notes

- Never share your minister password
- Change default passwords immediately
- Only share your FID with trusted state members
- Log out after using the admin panel
