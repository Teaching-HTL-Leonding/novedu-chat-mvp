# Azure runtime environment: how Novedu is run (new environment)

How the new two-stage Azure environment is put together, what each resource is
for, and how the `dev` and `prod` stages are kept apart. Read it before running
any `az` command against `rg-novedu-shared` / `rg-novedu-dev` /
`rg-novedu-prod`, before touching `scripts/db/provision-stage.*`, and before
adding the deployment workflows.

> **Status: under construction, not in use.** Novedu is in the middle of a
> transition period between two Azure environments. **Production is still the
> old environment**, which serves `novedu.at` and is what every other doc in
> this repo describes (`docs/database.md`, `docs/images.md`, the
> `novedu-publish` skill, …). Nothing described here serves a user, holds data,
> or is deployed to.
>
> **`docs/azure-access.md` is the entry point**: it carries the rules for the
> transition period, the tenant / subscription / admin-group ids, the separate
> `az` profile, and how to get access. Do not run anything here before reading
> it.
>
> | | |
> |---|---|
> | **Built so far** | the three resource groups; the shared Log Analytics workspace, Container Apps environment (incl. both storage definitions), container registry and Postgres server; per stage a Key Vault, a storage account with a provisioned image root, an Application Insights resource, a container app running a placeholder image, and a GitHub OIDC identity; every role assignment and both Postgres stage databases; the complete configuration of both stages — Key Vault secret values, the apps' secret references and environment variables, and both sign-in app registrations |
> | **Not built yet** | a Novedu image in the registry; the `/novedu-files` volume mount; target port 3000 and prod's fixed single replica; custom domains, managed certificates and DNS; the GitHub pipeline (build → dev, promote → prod); Azure Foundry in the new tenant; any production data |
>
> This block is updated as the build-out proceeds and removed once the
> environment is production. Each section below marks what is designed but not
> built.

## The staging concept

Two stages, **dev** and **prod**. Each stage owns everything that carries its
state or its rights; everything stateless and expensive to duplicate is shared.

| Per stage (isolated) | Shared between the stages |
|---|---|
| resource group, Key Vault, storage account + file share, Postgres database, App Insights, container app + its managed identity, GitHub deploy identity | Container Apps environment, Postgres *server*, container registry, Log Analytics workspace |

The isolation is what makes the shared parts safe: a stage's identity holds
rights only on its own stage's resources and can only connect to its own
database, so sharing a server or an environment never shares data.

| | dev | prod |
|---|---|---|
| Resource group | `rg-novedu-dev` | `rg-novedu-prod` |
| Container app | `ca-novedu-dev`, 0.5 vCPU / 1 GiB | `ca-novedu-prod`, 1 vCPU / 2 GiB |
| Database | `novedu_dev` | `novedu_prod` |
| Intended hostname | `dev.novedu.at` | `app.novedu.at` |
| Replicas | 0–1 (scales to zero) | 0–1 while on the placeholder image; exactly 1 once live |

The hostnames are **not built yet** — no custom domain, no managed certificate
and no DNS record exists, and both apps are reachable only under their
generated `*.austriaeast.azurecontainerapps.io` names.

Everything is in **Austria East**, and every resource carries the tags
`project=novedu` and `stage=shared|dev|prod`. There is **no
infrastructure-as-code**: the environment is built from an ordered runbook of
`az` commands, dev first, prod as an exact replay with different values. That
is why every change is coordinated (`docs/azure-access.md`).

## Shared resources (`rg-novedu-shared`)

### `log-novedu` — Log Analytics

One workspace, `PerGB2018`, 30 days retention. It takes the Container Apps
environment's logs and backs both stages' Application Insights resources.

### `cae-novedu` — Container Apps environment

Workload-profiles environment type using **only the built-in `Consumption`
profile**; no dedicated profile is ever added. No VNet, no separate managed
infrastructure resource group. Logs go to `log-novedu`.

Its children live in the shared group even though they belong to a stage — the
two **environment storage definitions**:

| Definition | Storage account | Share | Access |
|---|---|---|---|
| `files-dev` | `stnovedudev` | `novedu-files` | ReadWrite |
| `files-prod` | `stnoveduprod` | `novedu-files` | ReadWrite |

The Azure Files mount is **key-based**, so each storage account's access key
sits in its environment storage definition. That is the one secret that cannot
live in Key Vault; one storage account per stage is what keeps it harmless,
because dev's key cannot open prod's share.

### `crnovedu` — Container Registry

Basic tier, **admin user disabled** (`crnovedu.azurecr.io`). The intended
repository is `novedu`; **no image is pushed yet**. Deployments are meant to
reference an immutable version tag, never `:latest`.

### `psql-novedu` — Postgres Flexible Server

| | |
|---|---|
| Version / SKU | 18, Burstable `Standard_B1ms`, 32 GB, storage auto-grow off |
| Backups | 7 days, no geo-redundant backup, no high availability |
| Network | public endpoint, TLS |
| Authentication | **Entra-only — password authentication is disabled** |
| Entra admin | the security group `novedu-dev` |
| Databases | `novedu_dev`, `novedu_prod` (both empty — no tables yet) |

The firewall is an "allow Azure services" rule plus one rule per developer
machine IP. Adding one:

```bash
AZURE_CONFIG_DIR=~/.htl-azure-novedu az postgres flexible-server firewall-rule create \
  -g rg-novedu-shared --server-name psql-novedu \
  --name <rule> --start-ip-address <ip> --end-ip-address <ip>
```

## Per-stage resources

Read `dev`/`prod` for `<stage>` throughout; the two stages differ only in the
values listed above.

### Container app `ca-novedu-<stage>`

Single-revision mode, external ingress, HTTPS only, system-assigned managed
identity, Consumption profile.

**Current state:** both apps carry their full Novedu configuration — secret
references and environment variables, see *Configuration* below — but still run
Microsoft's public placeholder image (`mcr.microsoft.com/k8se/quickstart`) on
target port 80, scale 0–1, with **no volume mount and no custom domain**. The
placeholder ignores the configuration; it is there so that the apps, and with
them their system-assigned identities, exist and can hold role assignments — an
identity cannot be granted anything before its app is created. Target port
3000, prod's fixed single replica and the `/novedu-files` volume mount are
**not built yet**.

### Key Vault `kv-novedu-<stage>`

RBAC mode, soft delete 90 days, no purge protection. The `novedu-dev` group is
Key Vault Secrets Officer, the stage's app identity is Key Vault Secrets User.
It holds the four secrets of *Configuration* below; a secret value is never
displayed, logged or written to a file on its way in (`docs/azure-access.md`).

### Storage account `stnovedudev` / `stnoveduprod`

StorageV2, `Standard_LRS`, TLS 1.2 minimum, no public blob access, shared-key
access enabled (the Azure Files mount needs it). One file share `novedu-files`
with a 100 GiB quota.

The share is already provisioned as an **image root**: an `images/` directory
plus the `.novedu-files-root` sentinel, whose bytes come from
`scripts/lib/image-root.mjs`. Both are written through the storage API rather
than by the app, because the image adapter never creates the root, `images/` or
the sentinel and has no fallback directory — see `docs/images.md`. The app's
`IMAGE_STORAGE_ROOT` already points at `/novedu-files`; the mount that would
make this share visible there is not built yet.

### Application Insights `appi-novedu-<stage>`

Workspace-based on `log-novedu`, one resource per stage, so each stage's
telemetry stays its own. The app reaches it through
`APPLICATIONINSIGHTS_CONNECTION_STRING`, a Key Vault reference to the stage's
own connection string (`docs/telemetry.md`).

### GitHub identity `id-novedu-gh-<stage>`

A user-assigned managed identity per stage for GitHub Actions OIDC, audience
`api://AzureADTokenExchange`:

| Identity | Federated credential subject |
|---|---|
| `id-novedu-gh-dev` | `repo:Teaching-HTL-Leonding/novedu-chat-mvp:ref:refs/heads/main` |
| `id-novedu-gh-prod` | `repo:Teaching-HTL-Leonding/novedu-chat-mvp:environment:production` |

Both are **inert**: no workflow uses them. A federated token is issued only for
the exact subject above, so a fork PR cannot obtain one and `qa.yml` stays
secret-free (`docs/ci-security.md`).

## Identity and access

The complete list of role assignments — there are no others, and **no identity
of one stage holds any right on the other stage's resources**:

| Principal | Rights |
|---|---|
| group `novedu-dev` | Owner on the three resource groups; Key Vault Secrets Officer on both vaults; Entra admin of `psql-novedu` |
| `ca-novedu-<stage>` (system-assigned MI) | AcrPull on `crnovedu`; Key Vault Secrets User on **its own** stage's vault; a Postgres role in **its own** stage's database |
| `id-novedu-gh-dev` | AcrPush on `crnovedu`; Contributor on the resource `ca-novedu-dev` |
| `id-novedu-gh-prod` | AcrPull on `crnovedu`; Contributor on the resource `ca-novedu-prod` |

Only the dev GitHub identity may push images; the prod one only pulls and
updates its own app, so a promotion can never introduce a new image.

Human access runs entirely on the group's rights — nobody needs a personal role
assignment. Group membership therefore includes prod; see
`docs/azure-access.md` for what that means during the transition period.

## Configuration

Both stages are configured in full: every secret sits in the stage's own Key
Vault, the container app references it there, and the plain settings are on the
app. Read `dev`/`prod` for `<stage>` throughout.

### Secrets

Four secrets per stage, under **identical names in both vaults**. Each is wired
into the container app as a Key Vault reference,
`keyvaultref:<versionless secret URI>,identityref:system`, so the app resolves
it when a revision starts, using its own system-assigned identity — which is
Key Vault Secrets User on its own stage's vault only. The reference is
versionless, so a new secret version needs no change to the app.

| Key Vault secret | App secret | Environment variable | Value |
|---|---|---|---|
| `AUTH-SECRET` | `auth-secret` | `AUTH_SECRET` | dev: the same value as the old environment. prod: its own, randomly generated (32 bytes, base64) |
| `AZURE-CLIENT-SECRET` | `azure-client-secret` | `AZURE_CLIENT_SECRET` | dev: the secret of the registration *Novedu Chat MVP*, shared with the old environment. prod: the secret `novedu-prod` of *Novedu Chat (prod)*, expiring 2028-09-20 |
| `SCCH-API-KEY` | `scch-api-key` | `SCCH_API_KEY` | the one SCCH key — the **only** secret that is identical in both stages and the old environment |
| `APPLICATIONINSIGHTS-CONNECTION-STRING` | `appinsights-connection-string` | `APPLICATIONINSIGHTS_CONNECTION_STRING` | the stage's own `appi-novedu-<stage>` |

Apart from the SCCH key every secret is per stage, so compromising dev's vault
tells nobody anything about prod.

### Environment variables

Plain values on the container app, beside the four secret references:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://ca-novedu-<stage>@psql-novedu.postgres.database.azure.com/novedu_<stage>?sslmode=require` |
| `AUTH_URL` | `https://<the app's FQDN>/api/auth` |
| `CODE_ORIGIN` | `https://<the app's FQDN>` |
| `AZURE_TENANT_ID` | `91fc072c-edef-4f97-bdc5-cfb67718ae3a` (both stages) |
| `AZURE_CLIENT_ID` | dev `4d44fc4b-0434-4981-9765-62e2074ceecb`, prod `d36756ba-5d79-4809-8a01-896d02639a34` |
| `TEACHER_GROUP_ID` | `1adac4e1-be54-458c-90ef-318d89f83317` (both stages) |
| `SCCH_BASE_URL` | `https://llm2go-api.scch.at/v1` |
| `IMAGE_STORAGE_ROOT` | `/novedu-files` |
| `OTEL_SERVICE_NAME` | `novedu-chat-<stage>` |

`DATABASE_URL` carries **no password**: the app authenticates with its managed
identity token (`lib/db/pool.ts`, `docs/database.md`).

The FQDN is the app's generated Container Apps hostname —
`ca-novedu-dev.salmonmeadow-98d2bbff.austriaeast.azurecontainerapps.io` and
`ca-novedu-prod.salmonmeadow-98d2bbff.austriaeast.azurecontainerapps.io`. No
custom domain is bound; binding one means changing `AUTH_URL` and
`CODE_ORIGIN` and adding the new callback to that stage's app registration.

### Deliberately not set

- **`AZURE_FOUNDRY_ENDPOINT`, `OPENROUTER_API_KEY` / `OPENROUTER_BASE_URL`** —
  the new stages run on **SCCH only**. A provider's variables are its switch:
  without them the app boots normally, `providerUnavailableReason` reports the
  provider as not configured (visible on `/health`), every default provider
  is SCCH, and an activity or code that names Azure Foundry or OpenRouter is
  rejected as unavailable on these stages (`docs/ai-models.md`).
- **`STORAGE_TENANT_ID`** — it only pins the tenant of a local `az` credential
  and means nothing to a managed identity.
- **`OTEL_EXPORTER_OTLP_ENDPOINT`** — it would win over the Application
  Insights connection string; telemetry goes to Azure Monitor
  (`docs/telemetry.md`).

### Sign-in app registrations

Sign-in runs against the tenant that hosts the environment, through two Entra
app registrations in it:

| Registration | Client id | Used by | Redirect URIs |
|---|---|---|---|
| *Novedu Chat MVP* | `4d44fc4b-0434-4981-9765-62e2074ceecb` | `ca-novedu-dev`, the old environment, local development | the dev callback `https://<dev FQDN>/api/auth/callback/microsoft` beside the old environment's and localhost's |
| *Novedu Chat (prod)* | `d36756ba-5d79-4809-8a01-896d02639a34` | `ca-novedu-prod` | the prod callback only |

Both are single-tenant, carry `groupMembershipClaims: All` with the optional
`groups` claim on the id and the access token — that is what `TEACHER_GROUP_ID`
is matched against — request Graph `User.Read` with per-user consent, and grant
no implicit flow.

Accounts are keyed by the Entra `oid`, which is tenant-wide, so the same person
is the same user under both registrations; the two stages nevertheless share no
data, because each has its own database (`docs/auth.md`).

### Setting or rotating a secret

The value goes in on stdin — never in an argument, and never displayed, in a
terminal or a Claude session (`docs/azure-access.md`):

```bash
export AZURE_CONFIG_DIR=~/.htl-azure-novedu

az keyvault secret set --vault-name kv-novedu-<stage> --name <NAME> \
  --file /dev/stdin --encoding utf-8 -o none
```

Because the app's reference is versionless, the new value is picked up by the
next revision — or immediately with
`az containerapp revision restart -g rg-novedu-<stage> -n ca-novedu-<stage> --revision <revision>`.

A client secret expires, so check it before it does:

```bash
az ad app credential list --id <client id> \
  --query "[].{name:displayName,end:endDateTime}" -o table
```

## Postgres roles and stage isolation

Both stages live on one server, so the stage boundary is a **privilege, not a
network rule**. Each stage is provisioned with

```bash
AZURE_CONFIG_DIR=~/.htl-azure-novedu node scripts/db/provision-stage.mjs <dev|prod>
```

and verified with the same command plus `--check`. The runner substitutes the
stage's identifiers into `scripts/db/provision-stage.sql`, picks the database
each block runs on, and skips the two statements Postgres cannot express
idempotently, so **re-running is safe**; `--check` changes nothing and exits 1
when an expectation fails. The password is an Entra access token fetched from
the ambient `az` profile — which is why the script refuses to run without
`AZURE_CONFIG_DIR`.

Per stage it produces:

- the app's managed identity registered as the Postgres role
  `ca-novedu-<stage>` — a plain login role with exactly the privilege model of
  `docs/database.md`: `CONNECT` + `CREATE` on its database, `USAGE` + `CREATE`
  on the schemas `public` and `mastra`, owning what it creates at boot;
- the database owned by the group role, not by the app role;
- `revoke create on schema public from public`;
- `revoke connect on database … from public`, so a stage's identity cannot even
  open a connection to the other stage's database.

**Humans connect as the group.** A group member logs in with the group name
`novedu-dev` as the Postgres user and their own Entra token as the password, so
every developer's connection string is identical.

**Dev only:** the group is a member of `ca-novedu-dev` and

```sql
alter role "novedu-dev" in database novedu_dev set role = 'ca-novedu-dev';
```

makes every group session act as the dev app role automatically — a fresh
session reports `current_user=ca-novedu-dev`, `session_user=novedu-dev`. Objects
created by a developer's local boot are therefore owned by the app role from
the start, and the **ownership hazard** of `docs/database.md` cannot occur in
`novedu_dev`. The flip side: admin work inside that database starts with `SET
ROLE NONE` (which the provisioning script does itself). `novedu_prod` has no
such default; there the group is a plain admin.

## Deploying and running (design — not built yet)

None of this exists yet; it is the shape the environment is built towards.

One image is built once per commit on `main` and pushed to `crnovedu` under an
immutable version tag. That image is deployed to dev automatically, and **the
very same image** is promoted to prod by a manual step — prod never gets a
separately built artifact. Database migrations run at app boot, per stage, so
deploying to a stage migrates that stage's database.

Constraints the design has to respect:

- **One replica per stage is a hard limit** (dev 0–1, prod exactly 1 once
  live). The Drizzle migrator takes no lock, and the pool maximum of 20
  connections (`lib/db/pool.ts`) is sized against what a `Standard_B1ms`
  offers (50).
- **Single-revision mode** keeps the old revision serving until the new one is
  ready, so a failed boot-time migration leaves the stage on its previous
  revision.
- **Default TCP probes.** `/api/health` is teacher-only and cannot serve as a
  probe.
- **Dev scales to zero**, so the first request after an idle period pays a cold
  start that includes the boot-time migration check.

## Reviewing the environment

Read-only; safe at any time, unlike anything that creates or changes a
resource (`docs/azure-access.md`).

```bash
export AZURE_CONFIG_DIR=~/.htl-azure-novedu

# What exists, per resource group
for rg in rg-novedu-shared rg-novedu-dev rg-novedu-prod; do
  echo "== $rg"; az resource list -g $rg -o table
done

# Every role assignment in the environment
az role assignment list --all \
  --query "[?contains(scope,'rg-novedu-')].{principal:principalName,type:principalType,role:roleDefinitionName,scope:scope}" \
  -o table

# Postgres is Entra-only (password auth disabled)
az postgres flexible-server show -g rg-novedu-shared -n psql-novedu --query authConfig

# The environment's storage definitions
az containerapp env storage list -g rg-novedu-shared -n cae-novedu -o table

# The GitHub OIDC federated credentials, per stage
az identity federated-credential list \
  -g rg-novedu-<stage> --identity-name id-novedu-gh-<stage> -o table

# Which secrets a vault holds — names only, never values
az keyvault secret list --vault-name kv-novedu-<stage> --query "[].name" -o tsv

# How the app resolves them: reference URI and the identity used
az containerapp show -g rg-novedu-<stage> -n ca-novedu-<stage> \
  --query "properties.configuration.secrets[].{name:name,keyVaultUrl:keyVaultUrl,identity:identity}" \
  -o table

# The app's environment variables (secret-backed ones show only the secret name)
az containerapp show -g rg-novedu-<stage> -n ca-novedu-<stage> \
  --query "properties.template.containers[0].env" -o table

# Database, app role, grants and cross-stage isolation, per stage
node scripts/db/provision-stage.mjs <stage> --check
```

`az containerapp` works from the core CLI. The extension this profile needs is
`application-insights`, for any `az monitor app-insights` command; extensions
are installed per profile (`docs/azure-access.md`).
