# Azure migration: working in the transition period

> **Temporary document.** It exists only while Novedu migrates between two Azure
> environments. When the migration is complete — the new environment is
> production and the old one is decommissioned — **delete this file and its
> entry in `AGENTS.md`**. Whatever is still true then (profile handling, login,
> access checks) moves into `docs/azure-runtime-env.md` first.

For every Novedu developer, and for Claude sessions working on a developer's
behalf. Read it before running any `az` command against either environment,
before changing how you run the app locally, and whenever a login has expired.

## Background: the migration

Novedu is moving to a different Azure tenant and subscription, and at the same
time from a single App Service to a two-stage setup (dev and prod) on Azure
Container Apps.

| | Old environment | New environment |
|---|---|---|
| Role right now | **Production.** Serves `novedu.at` to real users with real data — few of both | **Under construction.** Empty: nobody uses it, it holds no data |
| Hosting | App Service, image from Docker Hub | Container Apps, image from Azure Container Registry |
| Stages | one | `dev` (`dev.novedu.at`) and `prod` (`app.novedu.at`) |
| Database | Postgres server `db-pgnovedu`, database `novedu` | Postgres server `psql-novedu`, databases `novedu_dev` / `novedu_prod` |
| Documented in | every other doc in this repo (`docs/database.md`, `docs/images.md`, the `novedu-publish` skill, …) | `docs/azure-runtime-env.md`, plus this document for access and the transition rules |

**The stakes are low, and the migration is planned accordingly.** Novedu is an
MVP with a small user base: breaking changes are fine and outages are
acceptable, on `novedu.at` today and during cutover alike. So the migration
favours simple, understandable steps over zero-downtime techniques, and nobody
needs to engineer around a short interruption. What the small scale does *not*
relax is care for the data itself: it belongs to real students and teachers, so
it is neither lost nor exposed along the way.

The migration runs in separate steps, each finished before the next begins:

1. **Build the new environment** and prove both stages on empty databases. The
   old environment is not touched.
2. **Azure Foundry** in the new tenant.
3. **Cutover:** stop the old environment, transfer the database and the image
   files, move DNS for `novedu.at`, switch the CLI's default server and the
   repo's documentation to the new environment.
4. **Decommission** the old environment — and remove this document.

There is no infrastructure-as-code: the new environment is built from an ordered
runbook of `az` commands, dev first, prod as a replay. The design spec and the
runbook are working documents outside the repository (`docs/superpowers/specs`
is gitignored) — ask the developer leading the migration for them.

## Rules for the transition period

- **Production is the old environment until cutover.** Releases, hotfixes and
  production diagnostics work exactly as the other docs describe. Nothing about
  the migration changes how a feature gets shipped — including that a breaking
  change or a brief outage on `novedu.at` is acceptable.
- **Local development is unchanged.** Keep your `.env` as `.env.example` and
  `docs/database.md` describe it. Do not point a local app at the new
  environment for feature work: its stages are not announced as usable, and
  their databases are empty by design.
- **No production data in the new environment.** Transferring data and image
  files is the cutover step, done once and deliberately. The data set is small,
  but it is real student and teacher data: never copy it over "to try
  something".
- **Most developers need no access to the new environment at all.** Only get it
  if you take part in building or operating it.
- **Coordinate before you change anything there.** Without infrastructure-as-code,
  two people applying runbook steps at the same time collide silently. Read-only
  commands are always fine; anything that creates, changes or deletes a resource
  is agreed with the developer leading the migration first.
- **Group rights include prod.** Every member of the admin group is Owner of the
  new prod resource group and Postgres admin on `novedu_prod`. While that stage is
  empty, mistakes there cost nothing but a replay of the runbook; after cutover
  the same rights reach the real data, with no further change of rights in
  between.
- **Never mix the two environments in one `az` profile** (next section). A
  command that lands in the wrong tenant or subscription is the main operational
  risk of this period.

## The new environment's target

| | |
|---|---|
| Tenant | `91fc072c-edef-4f97-bdc5-cfb67718ae3a` (accounts `@htl-leonding.ac.at`) |
| Subscription | **`Novedu`** — `165b0053-6959-416b-9edf-aa3f82f3f270` |
| Region | Austria East (`austriaeast`) |
| Admin group | Entra security group `novedu-dev` — `46ba6be3-7489-4233-af5a-5649680b3fda` |
| Resource groups | `rg-novedu-shared`, `rg-novedu-dev`, `rg-novedu-prod` — nothing else |

A login to this tenant may show further subscriptions (for example
`Leonie Chatbot`), and a fresh login can select one of them as the default. They
are unrelated: **always pin `Novedu` right after a login** and never create
anything elsewhere. The `Novedu` subscription itself also holds resource groups
that are not part of this environment (`Novedu`, `ai-tutor-questionaire`); leave
them alone.

### Getting access

You need an `@htl-leonding.ac.at` account and membership in the **`novedu-dev`**
group; ask a current member to have you added. All work runs on the group's
rights (Owner on the three resource groups, Key Vault Secrets Officer, Entra
admin of `psql-novedu`) — nobody needs a personal role assignment.

The few steps that need **Owner on the subscription** — creating the resource
groups, assigning the group as their Owner, registering resource providers — are
one-time steps done by a subscription Owner. All resource providers the
environment needs are registered.

## Two `az` profiles, never mixed

The `az` CLI keeps its login state in one directory, chosen by
`AZURE_CONFIG_DIR`. The new environment gets its own directory, and **every
developer uses the same one**, because the docs, scripts and agent instructions
in this repo rely on the name:

| Profile | `AZURE_CONFIG_DIR` | Logged in to |
|---|---|---|
| default | unset (`~/.azure`) | whatever you use otherwise — for developers with access to the old environment, its tenant |
| new environment | `~/.htl-azure-novedu` | tenant `91fc072c-…`, subscription `Novedu` |

The profile is selected **per command** by the environment variable; nothing is
ever switched globally, so a command without the variable can never reach the
new environment, and one with it can never reach the old:

```bash
AZURE_CONFIG_DIR=~/.htl-azure-novedu az <command>
```

In a script or a multi-command shell block, `export AZURE_CONFIG_DIR=~/.htl-azure-novedu`
once at the top. Never run `az login --tenant 91fc072c-…` or `az account set`
for the new subscription in the default profile.

`AzureCliCredential` shells out to `az` and inherits the variable, so it also
decides which identity a locally running app uses — one more reason to leave it
unset for everyday development.

## Logging in

Only a human can log in — it is an interactive Entra sign-in with MFA. The
refresh token lives in the profile directory, so a login lasts across sessions
until it expires or is revoked.

### On a machine with a browser

```bash
AZURE_CONFIG_DIR=~/.htl-azure-novedu az login --tenant 91fc072c-edef-4f97-bdc5-cfb67718ae3a
AZURE_CONFIG_DIR=~/.htl-azure-novedu az account set --subscription 165b0053-6959-416b-9edf-aa3f82f3f270
```

### Over SSH (no browser on the machine running `az`)

**The device-code flow does not work in this tenant**: the sign-in page answers
"You don't have access to this" even for an account that works fine in the
portal — the signature of a Conditional Access policy blocking the device-code
grant, while the browser flow is allowed. Without a display, `az login`
silently falls back to exactly that flow, so a plain `az login` over SSH always
fails this way. `--use-device-code` is never the fix.

Use the normal browser (authorization-code) flow instead, with the browser on
the local computer and the callback tunnelled to the remote `az`:

1. On the remote machine, start the login with a stand-in "browser" that only
   prints the sign-in URL. `DISPLAY` merely has to be non-empty so `az` picks
   the browser flow:

   ```bash
   DISPLAY=:0 BROWSER='echo %s' AZURE_CONFIG_DIR=~/.htl-azure-novedu \
     az login --tenant 91fc072c-edef-4f97-bdc5-cfb67718ae3a
   ```

   It prints a `https://login.microsoftonline.com/...` URL and keeps waiting.
   The URL contains `redirect_uri=http%3A%2F%2Flocalhost%3A<PORT>`; the port is
   random per login.

2. On the local computer, forward that port to the remote machine:

   ```bash
   ssh -N -L <PORT>:localhost:<PORT> <remote-host>
   ```

3. Open the printed URL in the local browser and sign in. Entra posts the result
   to `localhost:<PORT>`, the tunnel delivers it to the waiting `az`, and the
   login completes. If the final page cannot connect, the tunnel was not up yet:
   start it and reload that page.

4. Pin the subscription (`az account set`, as above) and close the tunnel.

**Never leave a second `az login` pending against the same profile.** A login
that fails or times out — a device-code attempt expires after about 15 minutes —
clears the profile's subscription list on its way out, and takes a working login
with it: every command then answers "Please run 'az login'". The only way back is
a new login; the profile files are not repaired by hand. Cancel an abandoned
attempt (Ctrl+C) before starting another.

A Claude session can run step 1 itself as a background command, read the URL and
port from its output, and hand steps 2–3 to the developer; it is notified when
the login completes.

## Verifying access

Read-only; run after every login and at the start of a work session.

```bash
export AZURE_CONFIG_DIR=~/.htl-azure-novedu
SUB=165b0053-6959-416b-9edf-aa3f82f3f270
GRP=46ba6be3-7489-4233-af5a-5649680b3fda

# 1. Right tenant, right subscription (Novedu), enabled
az account show --query "{name:name,id:id,tenant:tenantId,state:state,user:user.name}" -o json

# 2. Admin group: security-enabled, and the caller is a member (expected: true)
ME=$(az ad signed-in-user show --query id -o tsv)
az ad group show --group $GRP --query "{name:displayName,securityEnabled:securityEnabled}" -o json
az ad group member check --group $GRP --member-id "$ME" --query value -o tsv

# 3. Effective rights, own and through groups. Expected: Owner on the three
#    rg-novedu-* groups via novedu-dev; a subscription Owner also sees that scope.
az role assignment list --assignee "$ME" --all --include-groups \
  --query "[].{role:roleDefinitionName,scope:scope}" -o table

# 4. Resource providers the environment needs (expected: Registered)
for p in Microsoft.App Microsoft.OperationalInsights Microsoft.DBforPostgreSQL \
         Microsoft.ContainerRegistry Microsoft.KeyVault Microsoft.Storage \
         Microsoft.Insights Microsoft.ManagedIdentity; do
  printf "%-32s %s\n" $p "$(az provider show -n $p --query registrationState -o tsv)"
done

# 5. Tokens can be issued: ARM, and Postgres (Entra auth to psql-novedu).
#    Query the expiry only — never print a token.
az account get-access-token --query expiresOn -o tsv
az account get-access-token --resource-type oss-rdbms --query expiresOn -o tsv
```

Austria East offers every resource type the environment uses — Container Apps
environments, apps and managed certificates, Log Analytics, Postgres Flexible
Server (versions up to 18; Burstable `Standard_B1ms` and `Standard_B2s`),
Container Registry, Key Vault, Storage, Application Insights, user-assigned
identities. Re-check Postgres with
`az postgres flexible-server list-skus -l austriaeast` if a SKU change is planned.

## CLI extensions

Extensions are installed **per profile**: the new-environment profile does not
see the ones in `~/.azure`. `az containerapp` works from the core CLI and needs
none. The extension this profile does need is `application-insights`, for any
`az monitor app-insights` command:

```bash
AZURE_CONFIG_DIR=~/.htl-azure-novedu az extension add -n application-insights
```

## What stays with a human

- The login itself (above).
- Typing or pasting a secret value: a person enters it directly into Key Vault
  (`az keyvault secret set ... --file /dev/stdin -o none`, or the portal). A
  Claude session may only move a value it never sees — piped from its source
  into Key Vault inside one command, with no output — and checks names, lengths
  and hashes, never values. No secret value appears in a session or its
  transcript.
- DNS records for the stage hostnames.

Tokens are never printed, logged, or written to files by a Claude session;
checks query metadata such as `expiresOn` only.
