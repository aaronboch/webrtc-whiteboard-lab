# VM Setup (Debian 13 arm64, from a fresh TTY)

This guide takes a freshly installed Debian 13 (trixie) arm64 VM in UTM from the text console to a complete working environment. After it, nothing else should need installing: project dependencies (Python packages, npm packages) are installed per project by `uv` and `npm`.

Later these commands go into `harness/setup_vm.sh` (milestone step 0.2).

---

## 1. sudo for your user

If you set a root password during installation, your user is not in the `sudo` group yet. Log in as your user, then run:

```sh
su -                              # enter the root password
apt update
apt install -y sudo
usermod -aG sudo <your-user>
exit
```

Log out and back in (`exit`, then log in again) so the group change takes effect. Check with `sudo whoami`, which should print `root`.

> If you left the root password empty during installation, sudo is already set up and you can skip this section.

## 2. Everything in one go

```sh
sudo apt update && sudo apt full-upgrade -y

sudo apt install -y \
  kde-plasma-desktop sddm konsole dolphin kate \
  spice-vdagent qemu-guest-agent \
  x11-xserver-utils \
  iproute2 iputils-ping kmod ethtool \
  git curl wget ca-certificates gnupg unzip build-essential \
  nodejs npm \
  python3 \
  openssh-server \
  htop tmux jq
```

What each group is for:

| Packages | Purpose |
|---|---|
| `kde-plasma-desktop sddm konsole dolphin kate` | Minimal KDE Plasma, the login manager, a terminal, a file manager and an editor. Use `task-kde-desktop` instead for the full KDE suite (much bigger). |
| `spice-vdagent qemu-guest-agent` | UTM integration: shared clipboard, automatic display resize, clean shutdown. |
| `x11-xserver-utils` | Provides `xhost`, needed so Chrome running as root can open windows (`xhost +SI:localuser:root`). |
| `iproute2` | `ip` (network namespaces, veth, bridge) and `tc` (netem). netem itself is the kernel module `sch_netem`, which ships with Debian's default kernel. |
| `iputils-ping kmod ethtool` | `ping` for checking netem, `modprobe`/`lsmod` for kernel modules, `ethtool` for checking interface offloads if needed. |
| `git curl wget ca-certificates gnupg unzip build-essential` | General development tools. `build-essential` covers the odd npm package that compiles native code. |
| `nodejs npm` | For the web app (Vite + TypeScript). Debian 13 ships Node 20.19, which current Vite needs at minimum. |
| `python3` | System Python. The project itself uses `uv`, which manages its own Python version. |
| `openssh-server` | Lets you work from the Mac's terminal: `ssh <user>@<vm-ip>`. Optional but very convenient. |
| `htop tmux jq` | Monitoring, terminal multiplexing (long overnight campaigns), and reading JSON logs. |

## 3. Google Chrome (arm64)

```sh
cd /tmp
wget https://dl.google.com/linux/direct/google-chrome-stable_current_arm64.deb
sudo apt install -y ./google-chrome-stable_current_arm64.deb
sudo apt-mark hold google-chrome-stable     # no auto-updates mid-campaign
google-chrome --version
```

- If that URL doesn't work, download the arm64 `.deb` from Google's Chrome download page.
- Installing the `.deb` also adds Google's apt repository and pulls in every library Chrome needs. Playwright's `install-deps` isn't required, because we use the system Chrome.
- To update Chrome deliberately later (e.g. between campaigns), run:
  ```sh
  sudo apt-mark unhold google-chrome-stable
  sudo apt install --only-upgrade google-chrome-stable
  sudo apt-mark hold google-chrome-stable
  ```

## 4. uv (Python tooling)

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc           # or open a new terminal
uv --version
```

`uv` installs into `~/.local/bin`. Python packages (`playwright`, `aiohttp`, `pyyaml`, `pandas`, `matplotlib`) are not installed system-wide. They come from the project's `pyproject.toml` via `uv sync`.

You don't need `playwright install`, because we use the system Chrome and not Playwright's bundled browsers.

## 5. Start the desktop

```sh
sudo systemctl enable --now ssh
sudo systemctl set-default graphical.target
sudo reboot
```

After the reboot, SDDM shows the graphical login.

- Plasma 6 starts in a **Wayland** session by default. Root-launched Chrome windows normally work through XWayland after `xhost +SI:localuser:root`.
- If headed root-launched windows don't appear, pick the **X11** session in SDDM's session menu (bottom left), if offered.

## 6. Check that everything works

Run these once in a terminal (Konsole or SSH):

```sh
# netem kernel module
sudo modprobe sch_netem && lsmod | grep sch_netem

# netem works (adds 50 ms to loopback, then removes it)
sudo tc qdisc add dev lo root netem delay 50ms
ping -c 3 127.0.0.1        # expect ~100 ms (50 ms each way)
sudo tc qdisc del dev lo root

# network namespaces work
sudo ip netns add test && sudo ip netns list && sudo ip netns del test

# tool versions
google-chrome --version
node -v                    # should be >= 20.19
npm -v
uv --version
git --version
```

If all of these succeed, the VM is complete. The rest happens inside the project (`uv sync`, `npm install`).

---

## Gotchas for later

- **`sudo` and `uv`:** `sudo uv …` fails with "command not found", because sudo doesn't see `~/.local/bin`. Use:
  ```sh
  sudo "$(which uv)" run harness/orchestrator.py configs/experiment.yaml
  ```
- **Displaying root-launched Chrome:** once per desktop login, run `xhost +SI:localuser:root` in a normal (non-root) terminal before `--manual` mode.
- **VM resources:** give the VM ≥ 4 vCPUs and ≥ 8 GB RAM in UTM, so two or more Chromes plus the analysis don't distort timing.
- **Snapshot:** after section 6 passes, take a UTM snapshot named "clean". It's milestone step 0.1's rollback point.
