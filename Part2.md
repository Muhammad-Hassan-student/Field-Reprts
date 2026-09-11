# Part 2 — taking the system off one laptop

The goal is not "make it good". The goal is: if this person disappears for
a week, nobody is blocked, and nothing quietly breaks.

That reorders everything. Bus factor is the first problem, not
infrastructure. The person is unreachable, so I cannot ask them anything.
Whatever I do has to work without their cooperation.

## First hour: find out what is actually on that laptop

Before changing anything, I would sit with whatever I can find — the
laptop's shell history, the Vercel project, the Postgres connection
string, the cron entries, any `.env` file, any deploy script. I want a
written list of: what runs where, what talks to what, what has a secret,
and what runs on a schedule.

This is the step people skip, and it is the step that decides whether the
next six days are calm or a firefight. I would write it down in a shared
doc that lives in the repo, not in my head.

If the person is already unreachable when I start, this changes: I would
go straight to Vercel's audit log and the Postgres provider's dashboard
to reconstruct the picture from what already exists.

## First day: get a second person on every access

Everything that currently has one holder gets a second holder:

- Vercel: add one other person as a member on the project, not just the
  team. Confirm they can deploy.
- GitHub: org ownership if it is a personal repo. At minimum, a second
  admin.
- Postgres: a second user with the same role, credentials stored in the
  team password manager, not in a chat message.
- Secrets: copy everything from the laptop's `.env` into Vercel's
  environment variables and into the password manager. The laptop stops
  being the source of truth.
- Cron: find every scheduled job. If it runs on the laptop, move it. If
  it runs on Vercel Cron, confirm it is defined in `vercel.json` or the
  dashboard and not in a shell script only that person has.

By the end of the first day, two people can deploy, two people can read
the secrets, and the cron jobs are visible in a place more than one
person can see.

## First week: make the system tell on itself

Once access is shared, the next risk is silence. I want the system to
tell the team when something is wrong, not to rely on someone noticing.

- Uptime check on the app and on the cron endpoints. Alert to a shared
  channel, not to one person's phone.
- Error tracking (Sentry or similar) with the same shared destination.
- A daily summary of cron runs — did they run, did they succeed. A cron
  that silently stops is the worst kind of failure.
- A one-page runbook in the repo: what this system is, where each part
  lives, what the common failures are, who to contact. Written for
  someone who has never touched it.

## What I would deliberately leave until later

- **Infrastructure as code.** Terraform or Pulumi for a Vercel + Postgres
  setup is not where the risk is. The risk is people, and IaC does not
  fix people. Revisit once the team is stable.
- **Multi-region or HA Postgres.** The current system is a single Vercel
  project talking to a single Postgres. Adding failover now adds a second
  system to understand. Do it after the runbook exists, not before.
- **A full observability stack.** Metrics, traces, dashboards. Useful,
  but the failure mode here is "cron stopped three days ago and nobody
  noticed", and one uptime check plus one daily summary catches that.
- **Rewriting the deploy process.** If `vercel deploy` works and two
  people can run it, a bespoke CI pipeline is not the priority. Leave it.
- **Rotating every secret "just in case".** Rotation is worth doing once
  the shared store is the source of truth, not as a first move. Doing it
  first, while access is still single-holder, is how you lock yourself
  out.

## What I would not leave

- A second person on every access. This is the whole point.
- Every secret in a place more than one person can read.
- Every cron job visible somewhere other than one laptop.
- One shared alert destination that is not one person's phone.
- One page of writing that explains what the system is.

Everything else can wait a week.
