# GitHub Repo Publishing with Org Scaffolding — Specification

## Overview

This spec covers how Manifold publishes a locally vibe-coded application to GitHub as a fully production-ready repository. It handles repo creation, org-standard scaffolding injection, branch rulesets, and identity/permission setup — replacing the need for Backstage's "New GitHub repository" template.

---

## Context: How Backstage Does It Today

The `vipps-configuration` repo contains Backstage scaffolder templates that create new GitHub repos via a self-service UI. The key template is:

```
vipps-configuration/backstage-catalog/templates/github-repo-template/github-repo-template-v2.yaml
```

It performs 13 steps across four phases:

| Phase | What happens | How |
|-------|-------------|-----|
| Scaffolding | Copies skeleton files (K8s manifests, workflows, Dockerfile, Bicep, catalog-info.yaml) into the new repo | `fetch:template` / `fetch:plain` actions reading from `common-files/skeleton/` |
| Repo creation | Creates a GitHub repo with branch protection, code owner reviews, merge settings | `publish:github` action (calls GitHub API directly) |
| Identity & permissions | Creates Azure service principals, sets team ownership, applies security hardening | `github:actions:dispatch` triggering workflows in the `vce-infra` repo |
| Catalog registration | Registers the new repo as a Backstage component | `catalog:register` action |

### Skeleton Templates Location

```
vipps-configuration/backstage-catalog/templates/common-files/
├── default-files/
│   └── catalog-info.yaml
└── skeleton/
    ├── docs/README.md
    ├── manifests/
    │   ├── k8s/
    │   │   ├── base/
    │   │   │   ├── kustomization.yaml
    │   │   │   ├── {{ appName }}-service.yaml       (VippsService CRD)
    │   │   │   ├── kustomizeconfig/
    │   │   │   └── openApiSwagger/
    │   │   └── overlays/
    │   │       ├── uat/
    │   │       ├── mt/
    │   │       └── prod/
    │   └── api/kong/{{ appName }}/
    ├── vmjob/k8s/                                    (batch job config)
    ├── infrastructure/main.bicep                     (Azure infra)
    └── (GitHub workflows, Dockerfile, dependabot)
```

Template placeholders use Nunjucks syntax: `${{ values.appName }}`, `${{ values.adminTeam }}`, etc.

### Template Input Parameters

The Backstage form collects these values (relevant for VCE deployable use case):

| Parameter | Description | Example |
|-----------|-------------|---------|
| `repoName` | GitHub repo name (kebab-case) | `my-service` |
| `ownerTeam` | Team that owns the repo | `team-payments` |
| `system` | Backstage system classification | `payments-system` |
| `appName` | Unique application name | `my-service-app` |
| `appNamespace` | Kubernetes namespace | `payments` |
| `dockerPort` | Container port | `8080` |
| `internetPort` | Service port | `80` |
| `replicaCount` | Pod replicas | `3` |
| `cpuRequest` | CPU in milliCores | `200m` |
| `memRequest` | Memory in MB | `60` |

### GitHub API Calls Made by Backstage

The `publish:github` action makes multiple GitHub API calls:

1. `POST /orgs/vippsas/repos` — create the repo (internal visibility)
2. Push scaffolded content to repo
3. `PUT /repos/vippsas/{repo}/branches/main/protection` — with settings:
   - `requireCodeOwnerReviews: true`
   - `requiredApprovingReviewCount: 1`
   - `dismissStaleReviews: true`
   - `requireLastPushApproval: true`
   - `requireBranchesToBeUpToDate: true`
   - `deleteBranchOnMerge: true`

> **Note:** Manifold intentionally does NOT replicate these strict settings. See [Decision 3](#decision-3-lightweight-branch-protection-via-github-rulesets).

### Workflow Dispatches to vce-infra

After repo creation, Backstage dispatches these workflows:

| Workflow | Purpose | Inputs |
|----------|---------|--------|
| `github-service-principals-workflow.yml` | Create Azure identities (service principals) | `namespaceName`, `gitHubRepoName` |
| `github-convert-admin-to-owner.yml` | Set team as repo owner | `repoName`, `teamName` |
| `github-harden-repo.yml` | Apply security hardening | `repoName` |
| `github-add-all-employees-write.yml` | Grant org-wide write access (optional) | `repoName` |
| `github-set-repo-deployable-false.yml` | Mark non-deployable repos (docs only) | `repoName` |

---

## Chosen Approach for Manifold

### Decision 1: Repo Creation — Direct GitHub API

Manifold calls the GitHub API directly to create repos, configure rulesets, and dispatch vce-infra workflows. No dependency on Backstage.

**Rationale:** The "hard part" (identities, hardening, permissions) is already in vce-infra workflows — Manifold just dispatches them. The GitHub API calls for repo creation and rulesets are straightforward.

### Decision 2: Scaffolding — Inject at Setup Time from Backstage Skeletons

At project setup time (when the user creates a new app in Manifold), Manifold reads the skeleton templates from `vipps-configuration/backstage-catalog/templates/common-files/skeleton/`, renders them with the project's values, and injects them into the local repo. The scaffolding files live alongside the vibe-coded application from the start.

**Rationale:** Single source of truth for org-standard files. The app is complete and deployment-ready before it's ever pushed. No post-push steps needed.

### Decision 3: Lightweight Branch Protection via GitHub Rulesets

Instead of Backstage's strict branch protection (required PRs, code owner reviews, approval counts), Manifold uses a GitHub Ruleset with minimal rules designed for non-tech users who need to explore and iterate freely.

**Ruleset: "Deployable Branch Protection"**

| Setting | Value |
|---------|-------|
| Enforcement | Active |
| Bypass | Repository admin role — Always allow |
| Target | Default branch (`main`) |
| Restrict deletions | Yes |
| Block force pushes | Yes |
| Require PRs | **No** |
| Require code reviews | **No** |
| Require status checks | **No** |
| Require signed commits | **No** |

The repo creator (once made admin via the team ownership workflow) can push directly to `main` with zero friction. The only guardrails prevent destructive actions (deleting `main`, rewriting history) that a non-tech user would never intentionally do.

**Rationale:** Manifold's target users are non-tech people exploring and vibe-coding. Requiring PRs and code reviews would block them entirely. The old branch protection API (`PUT /repos/.../branches/main/protection`) is replaced by the Rulesets API (`POST /repos/{owner}/{repo}/rulesets`) which offers more granular control and admin bypass.

---

## Implementation Design

### Phase 1: Skeleton Template Rendering

#### Template Source Access

Manifold needs to read the skeleton templates from `vipps-configuration`. Options:

| Method | Pros | Cons |
|--------|------|------|
| GitHub API at runtime | Always latest templates | Network dependency, needs auth |
| Git submodule | Pinned version, offline access | Requires explicit updates |
| Periodic sync/cache | Fresh templates, works offline after first fetch | Complexity |

**Recommendation:** GitHub API with local cache. Fetch on first use, cache for 24h, allow manual refresh.

#### Template Rendering

The skeleton files use Nunjucks-style `${{ values.appName }}` placeholders. Manifold needs:

- A template renderer that handles `${{ values.* }}` and `${{ parameters.* }}` syntax (Bicep files use `parameters.*`)
- **Computed expressions** — some templates use arithmetic: `${{ values.cpuRequest * 1.5 }}` for CPU limits
- File/directory name templating (e.g., `${{ values.appName }}-service.yaml` → `my-app-service.yaml`, `kong/${{ values.appName }}/` → `kong/my-app/`)
- Ability to handle conditional file inclusion based on use case

#### Values Collection

During project setup, Manifold collects deployment configuration via its setup wizard:

| Value | Source | Hardcoded | Used In |
|-------|--------|-----------|---------|
| `appName` | From the project name | | 30+ files — resource names, labels, Kong routes, filenames |
| `repoName` | From the project name (kebab-case) | | `main.bicep` (GitHub URL in Azure infra) |
| `adminTeam` | User selects from org teams (GitHub API) | | VippsService, VmJob, Bicep owner tag |
| `description` | From the user's first prompt when creating the app | | `docs/README.md` |
| `appNamespace` | Hardcoded | **TBD** (playground namespace) | `kustomization.yaml` files, Kong upstream FQDN |
| `dockerPort` | Hardcoded | **8080** | VippsService spec, liveness/readiness probes |
| `internetPort` | Hardcoded | **80** | VippsService service port, Kong upstream |
| `replicaCount` | Hardcoded | **1** | VippsService spec |
| `cpuRequest` | Hardcoded | **100m** | Resource requests; limits auto-calculated as `cpuRequest * 1.5` (150m) |
| `memRequest` | Hardcoded | **32** | Resource requests and limits (32 MB) |

Only `appName`, `adminTeam`, and `description` require user input. Everything else is hardcoded to sensible playground defaults — no "Advanced" section needed.

### Phase 2: GitHub Repo Publishing

When the user clicks "Push to GitHub", Manifold executes these steps in order:

**Step 1 — Create GitHub repo**
```
POST /orgs/vippsas/repos
{ name, visibility: "internal", auto_init: false }
```

**Step 2 — Push local repo** (user's code + scaffolding)
```
git remote add origin <repo-url>
git push -u origin main
```

**Step 3 — Dispatch: set team ownership**
Makes creator's team admin — required before ruleset so the creator can bypass it.
```
POST /repos/vippsas/vce-infra/actions/workflows/github-convert-admin-to-owner.yml/dispatches
{ ref: "master", inputs: { repoName, teamName } }
```

**Step 4 — Create branch ruleset**
```
POST /repos/vippsas/{repo}/rulesets
{
  name: "Deployable Branch Protection",
  enforcement: "active",
  bypass_actors: [{
    actor_type: "RepositoryRole",
    actor_id: 5,
    bypass_mode: "always"
  }],
  target: "branch",
  conditions: {
    ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] }
  },
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" }
  ]
}
```
> `actor_id: 5` = Repository admin role. The team ownership dispatch (step 3) must complete before the creator can push again — without admin status, the ruleset would block force pushes even for the creator.

**Step 5 — Dispatch: create Azure identities**
```
POST /repos/vippsas/vce-infra/actions/workflows/github-service-principals-workflow.yml/dispatches
{ ref: "master", inputs: { namespaceName, gitHubRepoName } }
```

**Step 6 — Dispatch: security hardening**
```
POST /repos/vippsas/vce-infra/actions/workflows/github-harden-repo.yml/dispatches
{ ref: "master", inputs: { repoName } }
```

**Step 7 — (Optional) Dispatch: org-wide write access**
```
POST /repos/vippsas/vce-infra/actions/workflows/github-add-all-employees-write.yml/dispatches
{ ref: "master", inputs: { repoName } }
```

**Step 8 — Register in Backstage catalog** (optional — could be auto-discovered)

### Phase 3: UX for Non-Tech Users

#### Setup Wizard (at project creation)

Minimal form — only what can't be inferred:

- **App name** — pre-filled from project name
- **Team** — dropdown of org teams (fetched from GitHub)

Description is extracted automatically from the user's first prompt (the one that kicks off app creation). Namespace, ports, replicas, and resources are hardcoded to playground defaults (see [Values Collection](#values-collection)). No "Advanced" section — fewer choices means fewer blockers for non-tech users.

#### Publish Button

A "Publish to GitHub" button in the status bar, shown when:

- The project has a local git repo
- The repo has no remote configured
- Deployment config values are set

#### Publish Flow UX

1. User clicks "Publish to GitHub"
2. Progress panel shows each step with status indicators
3. On success: toast with link to the GitHub repo
4. On failure: clear error message with the step that failed

---

## Relationship to Existing Git Integration Spec

This spec extends the existing `git-integration.md` spec. The git integration spec covers commit, PR, and conflict resolution for repos that are already connected to GitHub. This spec covers the initial publishing — going from local-only to GitHub-hosted.

The flow is: **Setup (this spec)** → **Commit/PR/Conflict (git-integration spec)**

---

## Open Questions

1. Should Manifold register the new repo in the Backstage catalog automatically, or leave that to auto-discovery?
2. How should Manifold authenticate with GitHub? OAuth app, GitHub App, or personal access token?
3. Should the setup wizard allow selecting different use cases (deployable vs. docs-only vs. shared code) like Backstage does, or default to "deployable with VCE"?
4. How often should the skeleton template cache refresh? 24h? On each app creation?
5. Should Manifold validate that the chosen namespace/app name doesn't conflict with existing resources before publishing?
