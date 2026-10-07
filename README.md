# 1915 South DC Smart Scheduler

Weekly scheduling for Red Hills (9910), Loxley (9911), Kernersville (9912) and Covington (9913).

## Files
- `index.html` page shell and sign-in screen
- `styles.css` 1915 South branding
- `config.js` Firebase config, admins, version number (bump on every app.js change)
- `boot.js` sign-in (email + password, create account, confirm email, forgot password, ovApproved) and data layer
- `app.js` the scheduler
- `dc-roster-seed.js` empty on purpose. The roster is not kept in this public repo. Load it once with Team > Import starting roster (dc-starting-roster.json, kept off GitHub), then Paylocity uploads keep it current.
- `firestore-dc-rules.txt` rules to ADD to field-leader-1915

## Sign-in (no emails)
- Email + password, Create your account and Forgot password, same accounts as the Field Leader / DC Field App.
- No confirmation email and no email sign-in links (the free plan caps those).
- Access comes from lists an admin keeps: Team tab leader emails (saved to dcAccess), the Field Leader users list, or ovApproved. Frank and Andrew are always in.
- Someone not on a list sees "Almost in. Ask Frank or Andrew to add your email." Nothing is sent.
- Forgot password still sends a reset email, only when a person asks for one.

## Go live (about 15 minutes)
1. Create a new GitHub repo `dc-schedule` under fpina-1915South and upload these files.
2. Settings > Pages > deploy from `main`, root. It will be at https://fpina-1915south.github.io/dc-schedule/
3. In `config.js`, paste the `firebaseConfig` values from the DC Field App (project field-leader-1915).
   With apiKey empty the app runs in DEMO mode (data only in that browser).
4. Firebase console (field-leader-1915) > Authentication > Settings > Authorized domains:
   make sure `fpina-1915south.github.io` is listed (it already is if the DC Field App is on GitHub Pages).
5. Firestore > Rules: ADD the block from `firestore-dc-rules.txt`. Do not replace the existing rules.
6. Open the app as Frank, visit each of the 4 DCs once so their settings save.
7. Team tab: add each DC's leader emails so they can post (or leave `openPosting: true` during testing).

## Data
- `dcSettings/{dc}` standards, shift templates, markets and callout buffer, OT rules, blackout dates
- `dcTeams/{dc}` people[] (id, name, pos, dept, market, role, leader, active) and leaderEmails[]
- `dcWeeks/{dc}__{YYYY-MM-DD}` week starting Monday: volume, sched{id: {days[7], dpt[7]}}, posted, postedAt, postedBy, postReason
- Shift codes: "" off, "PTO", D Day, M Mid, N Night load, S Sat load, R Route, L Line-haul, "X:6.5-15" custom (decimal hours)

## Link to the DC Field App
- Weeks run Monday to Sunday. The doc ID uses the Monday (e.g. `9910_2026-10-12`), `days[]` is Monday first, and the doc carries `weekStartsOn: "Mon"`.
- Every draft save writes `dcschedule/{dcCode}_{weekStart}`  with `posted: false`.
- Posting writes it with `posted: true`. Edits after posting stay in the scheduler until the week is re-posted, so the floor keeps seeing the posted version.
- People go out as "Last, First" with Paylocity department, supervisor last name, real 24-hour times, lunch in hours, and a job key per day.
- Job keys: Pick > pick, Receiving > put, Rewrap > rewrap, Returns > disp, Shop > repair. Other teams and all leaders go out with job "".
- Line-haul shifts that end after midnight carry `nextDay: true`. Extra fields `team` and `leader` are included too.
- `emp` is blank until a Paylocity export with an employee ID column is uploaded on the Team tab.

## Red Hills shifts (confirmed Oct 6 2026)
- RT Returns 4:00a to 12:30p, W Rewrap 6:00a to 2:30p (2 per day), Y1 Recycle AM 4:00a to 12:30p (2), Y2 Recycle PM 7:30a to 4:00p (2)
- P Picking 6:00a to 2:30p, A Prep and Assembly 8:00a to 4:30p (8 per day), V Receiving 10:30a to 6:00p
- Supervisors: Octavious 5:30a to 1:00p, Zay 10:00a to 6:00p, Blake 9:00a to 5:30p, Tyler 7:00a to 4:30p
- Drivers 7:00a to completion (planned as 10 hrs). Loading night shift, Sat load and line-haul are still placeholders

## Smart build and leader changes
- "Smart build week" clears everything the engine set and rebuilds from volume, standards, usual shifts, OT limits, coverage rules and lunches.
- Anything a leader sets by hand on a day (position, time, PTO, Off) is locked with an orange dot. Smart build never changes it.
- "Let Smart build decide" on a day cell removes the lock and hands that day back.
- "Fill gaps only" adds shifts to cover need without touching anything already scheduled.
- "Copy last week" brings the shifts in as leader-set (locked). PTO is not copied.
- Stored as sched[id].lock[7].

## Lunches
- Every save re-staggers lunches for warehouse and shop shifts of 6+ hrs (30 min, unpaid).
- A lunch starts 3 to 5 hrs into the shift, in 15-minute steps.
- No more than 33% of a position at lunch at once (at least 1 allowed), and 1 leader at a time.
- Drivers and line-haul take lunch on the road and are not scheduled.
- A lunch set by hand on a day cell is locked (shown with *). "Re-stagger all lunches" unlocks and redoes them.
- Stored as sched[id].lunch[7] (decimal hour) and lunchLock[7]. Sent to the DC Field App as `lunchStart` "HH:MM" on each day.
- All of these numbers are on Settings > Lunch rules.

## How need is calculated (defaults, edit on Settings)
- Inbound: trailers x 8 labor hrs / 8 productive hrs
- Pick and Load: pieces / (pieces per hr x 8). Pieces default to next-day stops x 6 pieces per stop
- Outbound: 1 per 8 next-day routes
- Returns 6 per labor hr, Shop 1.5 repairs per labor hr, Inventory 1 per warehouse day
- Delivery: routes x 2 (driver + helper) plus callout buffer (10% in Jacksonville, Brunswick, Columbus, Macon, Dothan, Panama City)
- Line-haul (Red Hills): next-day remote routes / 2 boxes per run, worked the night before
- Warehouse flex people count toward any warehouse team

## Rules checked before posting
- OT: amber at 38 hrs, red over 40. Any day over 11 hrs. More than 5 days (2 days off)
- A leader on every warehouse shift
- PTO inside the Black Friday blackout (Nov 22 to Dec 5 by default)
- Routes next Monday with no Saturday load crew
- Routes above truck count
Red items can still be posted with a note.
