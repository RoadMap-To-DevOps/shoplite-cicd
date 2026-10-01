# Exercise: Ship It: CI/CD into a Private AWS Network

**Topics:** Git and GitHub · GitHub Actions · CI/CD · AWS VPC (public and private subnets)
**Time:** about 6–8 hours · **Points:** 100, plus 15 bonus

---

## Scenario

You've joined **ShopLite**, a small startup. The team has a tiny Node.js service, which is in the `app/` folder of this starter. Right now someone copies it to a server by hand. Your job is to make it production-ready:

* The app must run on EC2 in a **private subnet**, so nobody on the internet can reach it directly.
* Public traffic gets in only through **one hardened host in a public subnet**. That host is a bastion that also runs an Nginx reverse proxy.
* Every pull request is **tested automatically**. Every merge to `main` is **deployed automatically**. A broken release must **never** take the site down.

### Ground rules (breaking any of these costs points)

| ❌ Not allowed | ✅ Do this instead |
|---|---|
| Docker or containers of any kind | Run Node.js directly under **systemd** |
| Terraform, CloudFormation, CDK or any other IaC | Build the network **by hand in the AWS Console**, so you understand every piece |
| A public IP on the app server | Put it in the private subnet and reach it **through the bastion** |
| Pushing directly to `main` | Use a feature branch, then a **Pull Request**, then merge |
| Committing keys, passwords or IPs to the repo | Use **GitHub Secrets / Variables** |
| AWS access keys in GitHub | Not needed. The pipeline only talks SSH. |

---

## Target architecture

```
                         Internet
                            │  HTTP :80                 GitHub Actions runner
                            ▼                                    │
                  ┌──────────────────┐                           │ ssh -J (jump)
┌─────────────────┤ Internet Gateway ├─────── VPC 10.0.0.0/16 ───┼────────────┐
│                 └────────┬─────────┘                           │            │
│  PUBLIC subnet 10.0.1.0/24 │                                   │            │
│  route: 0.0.0.0/0 → IGW    ▼                                   │            │
│        ┌─────────────────────────────┐ ◀───────────────────────┘            │
│        │ bastion  (public IP / EIP)  │                                      │
│        │  • nginx :80  reverse proxy │                                      │
│        │  • sshd  :22  jump host     │                                      │
│        └──────────────┬──────────────┘          ┌──────────────┐            │
│                       │ :3000 (HTTP)            │ NAT Gateway  │            │
│                       │ :22   (SSH)             └──────▲───────┘            │
│ ──────────────────────┼─────────────────────────────── │ ─────────────────  │
│  PRIVATE subnet 10.0.2.0/24                            │ outbound only      │
│  route: 0.0.0.0/0 → NAT                                │ (dnf install)      │
│        ┌──────────────▼──────────────┐                 │                    │
│        │ app server (NO public IP)   │─────────────────┘                    │
│        │  • node server.js :3000     │                                      │
│        │  • managed by systemd       │                                      │
│        └─────────────────────────────┘                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### What you are given

```
app/
  server.js          # starts the HTTP server on $PORT (default 8080)
  src/app.js         # routes: /  /health  /version
  test/app.test.js   # unit tests (node --test, no npm install needed)
  package.json       # npm test · npm run lint
.github/workflows/   # empty - you write the pipelines
```

The app has **zero npm dependencies**, so a release is just a `.tar.gz` of the `app/` folder. The app's contract:

| Endpoint | Returns |
|---|---|
| `GET /health` | `200 {"status":"ok"}`, used for health checks |
| `GET /version` | `{"version":"<git sha>","hostname":"ip-10-0-2-x"}`, read from a `VERSION` file in the release folder |
| `GET /` | an HTML page showing the version and the hostname |

Try it locally first:

```bash
cd app && npm test && PORT=3000 npm start
```

---

## Part 1: GitHub repository and workflow (10 pts)

1. Create a **new GitHub repository** named `shoplite-cicd`. Push this starter to it as your first commit on `main`.
2. Add a sensible `.gitignore` (`node_modules/`, `*.tar.gz`, `*.pem`, `.env`).
3. Protect `main` with a **branch protection rule** (or ruleset):
   * Require a pull request before merging.
   * Require status checks to pass. You'll pick your CI job in Part 4.
   * Block force pushes and deletion.
4. From now on, **every change** goes through a feature branch (`feature/...`, `fix/...`) and a PR with a clear description. Write meaningful commit messages, for example `feat: add CD workflow`, not `update`.

> ✅ **Check:** `git push origin main` from your laptop is **rejected**.

---

## Part 2: Build the VPC by hand (25 pts)

Use the **AWS Console** and **one region** for everything. Name every resource with your name as a prefix, for example `jdoe-vpc`.

| # | Resource | Requirements |
|---|---|---|
| 1 | **VPC** | `10.0.0.0/16`, DNS hostnames **enabled** |
| 2 | **Public subnet** | `10.0.1.0/24`, AZ *a*, auto-assign public IPv4 **on** |
| 3 | **Private subnet** | `10.0.2.0/24`, same AZ, auto-assign public IPv4 **off** |
| 4 | **Internet Gateway** | Attached to your VPC |
| 5 | **NAT Gateway** | In the **public** subnet, with a new Elastic IP |
| 6 | **Public route table** | `0.0.0.0/0 → IGW`, associated with the public subnet |
| 7 | **Private route table** | `0.0.0.0/0 → NAT Gateway`, associated with the private subnet |
| 8 | **SG `bastion-sg`** | Inbound: `80` from `0.0.0.0/0`; `22` from `0.0.0.0/0` (see Q4) |
| 9 | **SG `app-sg`** | Inbound: `3000` **and** `22` **only from `bastion-sg`** (reference the SG, not a CIDR) |
| 10 | **Key pair** | One key pair (`.pem`). **Never commit it.** |
| 11 | **EC2 `bastion`** | Amazon Linux 2023, `t3.micro`, public subnet, `bastion-sg`, plus an **Elastic IP** so its address never changes |
| 12 | **EC2 `app-1`** | Amazon Linux 2023, `t3.micro`, **private** subnet, `app-sg`, **no public IP** |

> 💡 Do **not** use the "VPC and more" wizard. Create each piece yourself so you see how they connect.

> ✅ **Check:** `app-1` shows **no** public IPv4 address in the console, and the private route table shows **no** route to the IGW.

---

## Part 3: Prepare the servers (10 pts)

### 3a. SSH through the bastion from your laptop

```bash
ssh -i jdoe.pem -J ec2-user@<BASTION_EIP> ec2-user@<APP_PRIVATE_IP>
```

You'll need the key on the bastion side too. Look up `ssh-agent` and `ssh -A`, or use `-J` with an `IdentityFile` in `~/.ssh/config`. Don't copy the `.pem` onto the bastion.

### 3b. App server (one-time setup)
* Install Node.js: `sudo dnf install -y nodejs`. This only works if your NAT gateway works. Why?
* Create a system user `webapp` and the directory `/opt/webapp/releases`.

### 3c. Bastion (one-time setup)
* Install **Nginx**. Configure it as a **reverse proxy**: `:80` forwards to `http://<APP_PRIVATE_IP>:3000`.
* Until the first deploy, `http://<BASTION_EIP>/` returns **502 Bad Gateway**. That's expected. Explain why in `ANSWERS.md`.

> 💡 You may paste one-time setup commands into the EC2 **User data** box at launch.

---

## Part 4: Continuous Integration (20 pts)

Create `.github/workflows/ci.yml`:

* **Triggers:** `pull_request` to `main`, and pushes to any branch **except** `main`.
* **Job `test`:** a **matrix** over Node **18, 20 and 22** that runs `npm run lint` and `npm test` inside `app/`.
* **Job `scripts`:** runs `shellcheck` on every `*.sh` file you write.
* Use least-privilege `permissions:` (`contents: read`).
* Make the `test` jobs a **required status check** in your branch protection.

> ✅ **Proof:** open a PR that **breaks a test** on purpose (for example, change `/health` to return 500). Screenshot the PR showing **merge blocked**. Then fix it in the same PR.

---

## Part 5: Continuous Deployment (25 pts)

Create `.github/workflows/cd.yml`, triggered on **push to `main`** and **`workflow_dispatch`**.

### Job 1: `build`
1. Check out the code, set up Node 20, and run the tests again. Never deploy untested code.
2. Write the commit SHA into `app/VERSION`.
3. Package the app as `webapp-<sha>.tar.gz`, without the tests.
4. Upload it with `actions/upload-artifact`.

### Job 2: `deploy` (`needs: build`)
1. Use a GitHub **Environment** called `production`. Show the site URL on the run page.
2. Download the artifact.
3. Load the SSH key from a **secret** and connect to the app server **through the bastion** with `ssh -J`.
4. On the server, implement a **release-folder deployment**:
   ```
   /opt/webapp/releases/<sha>/   ← unpack each release here
   /opt/webapp/current  →  symlink to the live release
   ```
   Then `systemctl restart webapp`.
5. Run the app under **systemd**:
   * Write a `webapp.service` unit **in your repo** (`deploy/webapp.service`) and have the pipeline install it.
   * It runs as user `webapp` with `PORT=3000` and `Restart=always`.
6. **Health check:** after the restart, poll `http://localhost:3000/health`. If it doesn't pass within about 30 seconds, **switch the symlink back** to the previous release, restart, and **fail the job**.
7. **Smoke test** from the runner: `curl http://<BASTION_EIP>/version` must return the new SHA.
8. Add a `concurrency:` group so two deployments can never run at once.

### GitHub configuration you need

| Kind | Name | Value |
|---|---|---|
| Secret | `SSH_PRIVATE_KEY` | contents of your `.pem` |
| Variable | `BASTION_HOST` | bastion Elastic IP |
| Variable | `APP_HOSTS` | app server private IP (space-separated if more than one) |
| Variable | `SSH_USER` | `ec2-user` |

> 💡 Put the deploy logic in `scripts/*.sh` files, not giant inline YAML. That makes the scripts testable and lets `shellcheck` check them.

> ✅ **Check:** `http://<BASTION_EIP>/` shows your page with the **same SHA** as the latest commit on `main`.

---

## Part 6: Prove it works (10 pts)

Record each scenario with screenshots in `ANSWERS.md`:

1. **Happy path:** change the heading in `src/app.js`, open a PR, CI goes green, merge. CD deploys and the new heading is live.
2. **Bad release:** merge a change where the app **crashes on start**, for example `throw new Error('boom')` at the top of `server.js`. Keep the unit tests passing so CI doesn't catch it. Show that:
   * the deploy job **fails**, and
   * the site **still serves the previous version** because the automatic rollback worked.
3. **Manual rollback:** run the CD workflow with `workflow_dispatch`, passing an older commit SHA as input. Show that the old version is live.

---

## Questions: answer these in `ANSWERS.md`

1. Why does the app server live in a private subnet? Name **two** concrete attacks this prevents.
2. What breaks if you delete the `0.0.0.0/0 → NAT` route from the private route table? What keeps working?
3. Why does `app-sg` reference `bastion-sg` instead of the CIDR `10.0.1.0/24`?
4. GitHub-hosted runners have changing IPs, so port 22 on the bastion is open to the world. What's the risk, and name **two** ways to close it.
5. What's the difference between a GitHub **Secret** and a **Variable**? Why is the bastion IP a variable?
6. How does the symlink approach make a rollback almost instant compared with re-copying files?
7. What does `concurrency` protect you from? Describe a failure that could happen without it.
8. The NAT Gateway is billed by the hour. Which parts of this setup still work if you delete it after deployment?

---

## Bonus (up to +15)

| Points | Challenge |
|---|---|
| +5 | **High availability:** add a second private subnet `10.0.3.0/24` in another AZ with `app-2`, add both to the Nginx `upstream`, and make the pipeline do a **rolling deploy**, one server at a time, stopping on the first failure. |
| +3 | **Approval gate:** add a required reviewer to the `production` environment. |
| +3 | **Pinned host keys:** store `known_hosts` as a secret instead of `StrictHostKeyChecking=accept-new`. |
| +2 | **Release notes:** the CD run writes a job summary (`$GITHUB_STEP_SUMMARY`) with the version, commit message and deploy time. |
| +2 | **Status badge:** add CI/CD badges to your repository README. |

---

## Submission

* A link to your GitHub repository, public or with your instructor added as a collaborator. It contains:
  * `.github/workflows/ci.yml`, `.github/workflows/cd.yml`
  * `scripts/` (deploy scripts) and `deploy/webapp.service`
  * `ANSWERS.md` with answers and screenshots: VPC resource map, both route tables, both security groups, the blocked PR, a green CD run, the failed-but-rolled-back run, and the live page.
* **No** `.pem` files, IPs or passwords anywhere in the git history.

## 💸 Cleanup (do this, it's real money)

When you're graded, **in this order**: terminate both instances, **delete the NAT Gateway**, **release both Elastic IPs**, delete the IGW, subnets, route tables, SGs and VPC. A forgotten NAT Gateway costs about **US$1+/day**.
