# Hostel Bed Allocation System

[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Mobile](https://img.shields.io/badge/Mobile-Phone_&_Tablet-000000?style=for-the-badge&logo=android&logoColor=white)](https://simpleicons.org/)
[![Web](https://img.shields.io/badge/Web-Laptop_&_Desktop-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://simpleicons.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

Design documentation for a system to manage bed allocation in a hostel, plus a
complete **command-line implementation** (Node.js + SQLite) of the requirements
below.

## Implementation (CLI + SQLite)

The repository contains a working, scriptable CLI backed by a single SQLite file.

- **Stack:** Node.js >= 20 (ESM) + SQLite via `better-sqlite3`, with `commander`
  for commands and `inquirer` for the interactive menu. No web/mobile UI.
- **Database:** `data/hostel.db` (git-ignored), overridable with the
  `HOSTEL_DB_PATH` environment variable. Foreign keys are enforced on every
  connection and the schema is idempotent.
- **Access control:** three roles (`admin`, `warden`, `clerk`) with
  permission-checked services; passwords are hashed with scrypt.

### Install

```bash
node --version        # must be >= 20
npm install
```

> If your npm configuration skips install scripts, the `better-sqlite3` native
> binary may be missing; run `npm rebuild better-sqlite3` to build it.

### Create and populate the database

```bash
npm run init          # create the schema in data/hostel.db
npm run seed          # optional: load demo hostels, students, fees and stays
npm start             # open the interactive menu
```

`seed` creates demo `admin`, `warden` and `clerk` accounts. Passwords are random
by default; supply them for repeatable runs:

```bash
node bin/hostel.js seed \
  --admin-password "AdminPass123" \
  --warden-password "WardenPass12" \
  --clerk-password "ClerkPass123"
```

To start over from scratch use `npm run init -- --force` (deletes the database
file first).

### Sign in for a command

Commands that change data authenticate as a user. Provide credentials with
`--user`/`--password`, with the `HOSTEL_USER`/`HOSTEL_PASSWORD` environment
variables, or let the CLI prompt when attached to a terminal. The default user
is `admin`.

```bash
node bin/hostel.js dashboard --user admin --password "AdminPass123"

HOSTEL_USER=warden HOSTEL_PASSWORD="WardenPass12" node bin/hostel.js availability

node bin/hostel.js menu          # interactive (same as `npm start`)
```

### Roles

| Role | Capabilities |
| --- | --- |
| `admin` | everything: users, settings, inventory, students, fees, allocation, stays, reports, and revealing private health notes |
| `warden` | hostel inventory, students, fees, allocation, check-in/out, reports, revealing private health notes |
| `clerk` | front desk: students, fees, allocation, check-in/out, reports |

### Fee eligibility rule

A student becomes eligible for a bed only once the recorded deposits reach the
configured **first deposit** amount (`settings.first_deposit_amount`, default
`50000 TZS`). Eligibility is always re-derived from the payment rows — never
cached — so corrections take effect immediately. `checkin` accepts an
`--override` (warden/admin only) that is recorded as a supervisor override.

### Privacy of health data

- `students.health_notes` and the per-condition `notes` are **never printed by
  normal read paths**; listings only show *that* a student has special needs.
- Full text requires the `health.reveal` permission (`students show <student>
  --reveal`) and **every reveal is written to the audit trail**.
- The allocator reads requirement **codes and levels only** (for example
  `GROUND_FLOOR`/`required`), so medical needs are honoured without exposing
  details. `required` codes hard-block beds; `preferred` codes only affect the
  ranking and can be overridden manually with a recorded reason.

### Command reference

**Read-only (no sign-in required)**

| Command | Purpose |
| --- | --- |
| `dashboard` | top-level counters and occupancy summary |
| `availability [-H <hostel>]` / `rooms [-H <hostel>] [--only-free]` | availability per hostel / per room |
| `free-beds [-H <hostel>]` | list every free bed |
| `occupancy [-H <hostel>]` | occupancy per hostel |
| `residents [-H <hostel>] [--assigned]` | current (checked-in) residents |
| `who-is-where [-H <hostel>]` | student → room/bed map |
| `unallocated` / `needs [-H <hostel>]` | students without a bed / special-needs overview |
| `inventory-check` | declared vs. actual room/bed counts |
| `hostels list` / `hostels show <hostel>` | hostel inventory / rooms and beds |
| `students list [-s <text>] [-g <gender>] [-y <year>]` | list or search students |
| `students show <student> [--reveal] [-u] [-p]` | profile (health detail needs `--reveal`) |
| `students requirements list <student>` | recorded requirements (codes only) |
| `fees status [--shortfall]` / `fees list <student>` | fee status / a student's payments |
| `eligibility <student>` | explain why a student is (not) eligible |
| `audit [-n <n>] [-a <action>]` / `logs [-n <n>]` | audit trail / stay history |
| `roles` / `db-info` / `settings list` | role table / database info / settings |

**Require authentication** (`-u/--user`, `-p/--password`, or the env vars)

| Command | Purpose |
| --- | --- |
| `hostels add --name <name> --gender <Male\|Female\|Mixed> --rooms <n> --beds <n> [--category <ALL\|Form 1\|Year 1\|...>] [--rooms-per-floor <n>] [--description <text>]` | register a hostel and generate its rooms/beds |
| `hostels add-room <hostel> --number <room> --capacity <n> [--floor <n>] [--amenities <FAN,QUIET,...>]` | add a room |
| `hostels add-bed <roomId> [--label <B#>] [--bunk <LOWER\|UPPER\|SINGLE>]` | add a bed |
| `hostels amenities <roomId> --set <list>` / `hostels room-status <roomId> [--close\|--open]` / `hostels bed-status <bedId> [--disable\|--enable]` | manage room/bed attributes |
| `students add --code <id> --name <name> --gender <g> --year <year/form> [--phone] [--email] [--health-notes <text>]` | register a student |
| `students update <student> [--name] [--gender] [--year] [--phone] [--email] [--activate\|--deactivate]` | update a student |
| `students health-notes <student> [--set <text>\|--clear]` | set/clear private notes |
| `students requirements add <student> --code <CODE> [--level <required\|preferred>] [--notes <text>]` | record a requirement |
| `students requirements remove <conditionId> [--yes]` / `students deactivate <student>` / `students delete <student> [--yes]` | maintain records |
| `fees add <student> --amount <n> [--type <first_deposit\|balance\|other>] [--method <...>] [--reference] [--date <yyyy-mm-dd>] [--note]` | record a deposit |
| `fees delete <paymentId> [--yes]` | correct a payment |
| `allocate <student> [-H <hostel>]` | auto-assign the best suitable bed |
| `assign <student> --bed <bedId> [--override] [--reason <text>]` | assign a specific bed |
| `suggest <student> [-n <n>]` | rank suitable free beds |
| `move <student> --bed <bedId>` / `cancel <allocationId> [--reason <text>]` | move / cancel an assignment |
| `checkin <student> [--override] [--note <text>]` / `checkout <student> [--note <text>] [--cancel]` | arrive / leave (check-out frees the bed) |
| `users add --username <u> --name <name> --role <admin\|warden\|clerk> --password <pw> [-u <admin>] [-p <adminPassword>]` | create an account (the first needs no auth) |
| `users list` / `users passwd <username> --new-password <pw>` / `users role <username> --role <role>` / `users active <username> [--enable\|--disable]` | manage users |
| `settings set <key> <value>` / `setup` | change policy (e.g. `first_deposit_amount 75000`) |

### Project structure

```text
bin/hostel.js          CLI entry point (error handling, exit codes)
src/config.js          domain constants, paths, default settings
src/db/schema.sql      full schema: tables, foreign keys, indexes, views
src/db/connection.js   SQLite connection (FK + WAL) and schema bootstrap
src/db/seed.js         demo data loader
src/services/          business logic: auth, hostel, student, fee, eligibility,
                       allocation, stay, report, settings, audit, matching
src/security/          roles, permissions, scrypt password hashing
src/cli/               commander commands, interactive menus, prompts, UI
test/                  node:test suites
```

### Tests

```bash
npm test
```

The suites run against a throwaway database (they set `HOSTEL_DB_PATH` to a
temporary file) and cover room/bed distribution, the fee threshold, gender/year
and health rules, double-booking protection, the check-in/check-out lifecycle,
privacy masking and role-based authorization.

## 1. System Requirements

### 1.1 Technical Requirements

**a. Languages / Stack**

- JavaScript
- Supabase / SQLite

> Flexible as it allows cross-platform support.

**b. Database Type**

- **Relational database** — allows answering documentational queries, e.g.:
  - Which student belongs to which room?
  - Number of students per room / hostel / etc.

**c. Supported Devices**

- Phones
- Laptops

### 1.2 User Requirements

a. **Fee registration** — at least first deposit required
b. **Student ID** — identity of payer, name, gender
c. **Hostel inventory** — names of hostels, number of rooms in each hostel, and number of beds
d. **Hostel categorization** — which hostels are male or female, for what year / form, or whatever separates them accordingly

### 1.3 Functional Requirements

a. Registering a student
b. Registering the hostels
c. Checking in
d. Checking out
e. Finding out availability
f. Assessing eligibility — whether students have paid
g. Assigning students to rooms — taking into consideration health and sensitivity issues

### 1.4 Legal & Ethical Requirements

- Keeping track of health conditions with privacy
- Protect data against unauthorized access (authentication)

## 2. Design Diagrams

### 2.1 ERD — Entity Relationship Diagram

> TODO: Add entity relationship diagram.

### 2.2 Use Case Diagram

Shows how each user relates to their roles / functional requirements.

> TODO: Add use case diagram.

### 2.3 Class Diagram

Keeps information and shows data types.

> TODO: Add class diagram.

## 3. Contributors

| Role | Name | Email |
| ------ | ------ | ------- |
| Owner | Success | <successmwita22@gmail.com> |
| Contributor | AQUA SLOVIC | <aquaslovic@gmail.com> |
| Contributor | Muzika | <muzikamigochi129@gmail.com> |
| Contributor | Bleggo 7 | <bleggobandz@gmail.com> |
| Contributor | dnlmgwi | <pdmgawi@gmail.com> |

## 4. License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
