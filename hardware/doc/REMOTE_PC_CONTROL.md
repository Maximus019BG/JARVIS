# JARVIS Remote PC Control Setup Guide

## Overview

This guide explains how to configure JARVIS (running on Raspberry Pi 5) to use the **remote PC as a compute resource** - opening browsers, running applications, and executing heavy tasks on the PC while the user sees those applications on the PC screen. Meanwhile, JARVIS continues displaying its own TUI on the projector unchanged.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        JARVIS HYBRID ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   RASPBERRY PI 5 (JARVIS)                 REMOTE PC (Windows/Linux)      │
│   ┌─────────────────────────┐              ┌─────────────────────────┐     │
│   │  JARVIS Hardware App    │              │  Compute Resource      │     │
│   │  • TUI (Textual)        │──────────────│  • Browser              │     │
│   │  • Projector Display    │   SSH        │  • IDE                  │     │
│   │  • IMX500 Camera       │   Commands   │  • GUI Apps             │     │
│   │  • AI Reasoning        │              │  • Heavy Compute        │     │
│   │  • Tool Orchestration  │              │                         │     │
│   └─────────────────────────┘              └─────────────────────────┘     │
│            │                                        │                      │
│            │   "Open browser at google.com"        │                      │
│            ├───────────────────────────────────────►│                      │
│            │                                        │                      │
│   PROJECTOR:                          PC SCREEN:                           │
│   ┌─────────────────┐                     ┌─────────────────┐               │
│   │ 🤖 JARVIS TUI   │                     │  🌍 Google      │               │
│   │                 │                     │  Browser open  │               │
│   │ > Open browser  │                     │                 │               │
│   │ Opening...      │                     │                 │               │
│   └─────────────────┘                     └─────────────────┘               │
│   (UNCHANGED)                             (USER LOOKS HERE)               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### How It Works

1. **JARVIS (Pi)**: Handles conversation, makes decisions, processes camera input, displays TUI on projector
2. **Remote PC**: Executes commands via SSH - browsers, IDEs, file operations - results show on PC screen
3. **User Experience**: 
   - Look at **projector** → See JARVIS TUI conversation
   - Look at **PC screen** → See JARVIS-opened browser, files, applications

---

## Step-by-Step Setup (Detailed)

### Phase 1: Prepare the Remote PC (Windows)

This section explains how to set up your Windows PC to accept SSH connections from the Raspberry Pi.

#### Step 1.1: Enable OpenSSH Server on Windows

Windows 10, Windows 11, and Windows Server have OpenSSH built-in - you just need to turn it on.

**Why do this?** SSH (Secure Shell) is the standard way to securely connect to a remote computer. By enabling the SSH server on your PC, you're allowing the Raspberry Pi to connect to and control your PC.

**Steps:**

1. **Open PowerShell as Administrator**:
   - Click the Start button
   - Type "PowerShell" in the search
   - Right-click "Windows PowerShell" and select "Run as administrator"
   - If asked "Do you want to allow this app to make changes to your device?", click "Yes"

2. **Check if OpenSSH is already installed**:
   ```powershell
   Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH*'
   ```
   
   You should see output like:
   ```
   Name  : OpenSSH.Client~~~~0.0.1.0
   State : Installed
   
   Name  : OpenSSH.Server~~~~0.0.1.0
   State : NotInstalled
   ```
   
   If "OpenSSH.Server" shows "NotInstalled", proceed to install it.

3. **Install OpenSSH Server** (if not installed):
   ```powershell
   Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
   ```
   
   Wait for it to complete - this may take a minute or two.

4. **Start the SSH service**:
   ```powershell
   Start-Service sshd
   ```
   
   This starts the SSH server so it can accept connections.

5. **Make SSH start automatically when PC boots**:
   ```powershell
   Set-Service -Name sshd -StartupType Automatic
   ```
   
   This ensures you don't have to manually start SSH every time you restart your PC.

6. **Verify the service is running**:
   ```powershell
   Get-Service sshd
   ```
   
   Look for "Running" in the Status column. The output should look something like:
   ```
   Status   Name               DisplayName
   ------   ----               -----------
   Running  sshd               OpenSSH SSH Server
   ```

#### Step 1.2: Configure Windows Firewall

Windows has a built-in firewall that blocks incoming connections for security. You need to create a rule that allows SSH connections on port 22.

**Why do this?** Without this firewall rule, Windows will ignore all incoming SSH connection attempts from your Raspberry Pi.

**Steps:**

1. **In the same Administrator PowerShell**, run:
   ```powershell
   New-NetFirewallRule -Name "OpenSSH Server" -DisplayName "OpenSSH Server" -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
   ```
   
   This creates a rule that says "Allow incoming TCP connections on port 22 (the SSH port)".

2. **Verify the rule was created**:
   ```powershell
   Get-NetFirewallRule -Name "OpenSSH Server"
   ```
   
   Check that "Enabled" shows "True".

3. **If you have third-party security software** (like Norton, McAfee, Bitdefender, Kaspersky), you may need to also create an exception there:
   - Open your security software
   - Look for "Firewall" or "Network Rules" or "Exceptions"
   - Add port 22 as an allowed port
   - Or temporarily disable the third-party firewall to test (remember to re-enable it!)

#### Step 1.3: Find Your PC's IP Address

The Raspberry Pi needs to know your PC's network address to connect to it. This is called the IP address.

**Why do this?** Just like you need a street address to send mail to a house, the Pi needs your PC's IP address to send SSH commands to it.

**Steps:**

1. **Open Command Prompt**:
   - Click Start
   - Type "cmd" (not PowerShell)
   - Click "Command Prompt"

2. **Find your IP address**:
   ```cmd
   ipconfig
   ```
   
   Look through the output for "IPv4 Address". It will look something like:
   ```
   Wireless LAN adapter Wi-Fi:
   
      Connection-specific DNS Suffix . : home
      IPv4 Address. . . . . . . . . . . : 192.168.1.100
      Subnet Mask . . . . . . . . . . . : 255.255.255.0
      Default Gateway . . . . . . . . . : 192.168.1.1
   ```
   
   The IPv4 Address (in this example, 192.168.1.100) is what you need. Write it down - you'll need it later.

**Troubleshooting**: If you see multiple adapters (Ethernet, Wi-Fi, VirtualBox, etc.), use the one you actually use to connect to the internet. The "Default Gateway" should be your router IP (usually 192.168.1.1 or 192.168.0.1).

#### Step 1.4: Determine Your Windows Username

The SSH connection needs to know which Windows user account to log into.

**Why do this?** Windows has user accounts, and SSH will authenticate as one of them. You need to tell the Pi which username to use.

**Steps:**

1. **In Command Prompt**, run:
   ```cmd
   echo %USERNAME%
   ```
   
   This will display your username - for example, if your PC login is "John", it will show "John".

**Important**: This is your local Windows username, NOT your Microsoft email address. If you log into Windows as "John" (not "john@outlook.com"), your username is "John".

---

### Phase 2: Prepare the Raspberry Pi

This section explains how to set up the Raspberry Pi to connect to your Windows PC.

#### Step 2.1: Update and Install Required Packages

Your Pi needs the right software to make SSH connections.

**Why do this?** The Pi needs two pieces of software: the SSH client (to connect to other computers) and X11 utilities (for advanced features like running GUI apps).

**Steps:**

1. **Connect to your Pi** using a monitor/keyboard or via SSH from another computer

2. **Update the package list** to ensure you get the latest versions:
   ```bash
   sudo apt update
   ```

3. **Install the required packages**:
   ```bash
   sudo apt install openssh-client xauth
   ```
   
   - `openssh-client`: The software that lets the Pi connect to other computers via SSH
   - `xauth`: Required for X11 forwarding (explained later) - allows running GUI applications

4. **Verify installation** by checking the SSH version:
   ```bash
   ssh -V
   ```
   
   You should see something like "OpenSSH_8.x.x"

#### Step 2.2: Generate SSH Key

Instead of typing a password every time you connect, we'll use SSH keys. This is more secure and allows for automated connections (JARVIS needs to connect without you typing a password).

**Why do this?** 
- Security: Keys are much harder to crack than passwords
- Convenience: JARVIS needs to connect automatically without human intervention
- Automation: The connection can happen in the background

**Steps:**

1. **Generate a new SSH key**:
   ```bash
   ssh-keygen -t ed25519 -C "jarvis@raspberrypi"
   ```
   
   - `-t ed25519`: Use the most modern and secure key type
   - `-C "jarvis@raspberrypi"`: A comment to help identify this key

2. **When prompted "Enter file in which to save the key"**, press Enter to accept the default location (`/home/pi/.ssh/id_ed25519` or `/root/.ssh/id_ed25519`)

3. **When prompted "Enter passphrase"**, you have two choices:
   - Press Enter twice for no passphrase (simpler for automation, but less secure)
   - Type a password if you want extra security (but you'll need to enter it when JARVIS starts)

4. **Verify the keys were created**:
   ```bash
   ls -la ~/.ssh/
   ```
   
   You should see:
   - `id_ed25519` - This is your **private key** (keep secret!)
   - `id_ed25519.pub` - This is your **public key** (safe to share)

**Security Note**: Never share your private key! The public key is the one you give to other computers.

#### Step 2.3: Copy the Public Key to Windows

Now we need to give your PC the public key so it recognizes your Pi.

**Why do this?** This is like giving your house key to a trusted person. The public key tells Windows "This Raspberry Pi is allowed to connect."

**Steps:**

1. **Copy the public key to your Windows PC**:
   ```bash
   ssh-copy-id -i ~/.ssh/id_ed25519.pub your-windows-username@192.168.1.100
   ```
   
   Replace:
   - `your-windows-username` with your actual Windows username (from Step 1.4)
   - `192.168.1.100` with your PC's IP address (from Step 1.3)

2. **When prompted "password:"**, enter your Windows password (the one you use to log into your PC)

3. **If successful**, you'll see a message like:
   ```
   Number of key(s) added: 1
   ```

**Troubleshooting - If ssh-copy-id doesn't work**:

If you get an error or it just doesn't work, here's the manual method:

- **On Windows**, create the .ssh folder:
  ```cmd
  mkdir %USERPROFILE%\.ssh
  ```

- **On Pi**, copy the key:
  ```bash
  scp ~/.ssh/id_ed25519.pub your-username@192.168.1.100:C:\Users\YourUsername\.ssh\
  ```

- **On Windows PowerShell** (not admin), add it to authorized_keys:
  ```powershell
  type C:\Users\YourUsername\.ssh\id_ed25519.pub >> C:\Users\YourUsername\.ssh\authorized_keys
  ```

#### Step 2.4: Fix Key Permissions (Critical Step!)

Windows is very strict about file permissions. If the permissions are wrong, Windows will reject the key even if it's correct.

**Why do this?** Windows security requires that only you can read your .ssh files. If anyone else can read them, Windows assumes it's a security risk and rejects them.

**Steps:**

1. **On Windows, open PowerShell** (regular user, NOT administrator):

   ```powershell
   # Navigate to your .ssh folder
   cd $env:USERPROFILE\.ssh
   
   # Remove inherited permissions (makes it clean)
   icacls authorized_keys /inheritance:r
   
   # Give ONLY your user full control
   icacls authorized_keys /grant "%USERNAME%:F"
   ```

   What these commands do:
   - `/inheritance:r` - Remove inherited permissions, start fresh
   - `/grant "%USERNAME%:F"` - Give you (the current user) Full control

2. **If you're using an Administrator account on Windows** (your user is a Windows Admin):

   The authorized_keys file location is DIFFERENT for admin accounts:

   ```powershell
   # For administrators, use this file instead:
   icacls C:\ProgramData\ssh\administrators_authorized_keys /inheritance:r
   icacls C:\ProgramData\ssh\administrators_authorized_keys /grant "Administrators:F" /grant "SYSTEM:F"
   ```
   
   **This is a very common mistake!** Admin users must use `C:\ProgramData\ssh\administrators_authorized_keys`, not their user folder.

#### Step 2.5: Test the Connection

Now let's verify everything works!

**Why do this?** Better to find problems now than after we've integrated with JARVIS.

**Steps:**

1. **From your Pi**, try connecting to Windows:
   ```bash
   ssh your-windows-username@192.168.1.100
   ```

2. **If it works**, you'll see a Windows PowerShell prompt:
   ```
   Windows PowerShell
   Copyright (C) Microsoft Corporation. All rights reserved.
   
   PS C:\Users\YourUsername>
   ```

3. **Try running a test command**:
   ```powershell
   echo "Hello from Windows!"
   ```

4. **Exit** by typing `exit` and pressing Enter

**Success criteria**: You should be able to connect without entering a password (the key authentication should work automatically).

---

### Phase 3: Configure for GUI Applications (Optional)

**Important**: Windows OpenSSH Server does NOT support X11 forwarding natively - this is a Windows limitation, not something we can fix. The SSH connection can run terminal commands, but not directly launch GUI windows through SSH like you can with Linux-to-Linux connections.

Instead, here are your options for GUI apps:

#### Option A: Use VNC (Recommended for Full Desktop Access)

VNC (Virtual Network Computing) lets you see and control your Windows desktop from the Pi.

**Best for**: Running multiple applications, using the full Windows desktop

**Steps:**

1. **On Windows**:
   - Download [RealVNC Server](https://www.realvnc.com/en/connect/download/vnc-server/) from the official website
   - Install it during installation, you'll be asked to create a VNC password - remember this!
   - Once installed, look for the VNC icon in your system tray

2. **On Pi**:
   ```bash
   sudo apt install realvnc-vnc-viewer
   ```

3. **Connect**:
   ```bash
   vncviewer 192.168.1.100
   ```
   
   Enter the VNC password you created on Windows when prompted.

#### Option B: Use RDP (Remote Desktop Protocol)

RDP is built into Windows and gives you complete access to the Windows desktop.

**Best for**: Full Windows desktop with better performance than VNC

**Steps:**

1. **On Windows**, ensure Remote Desktop is enabled:
   - Press `Win + R`, type `sysdm.cpl`, press Enter
   - Go to the "Remote" tab
   - Under "Remote Desktop", check "Allow remote connections to this computer"
   - Click OK

2. **On Pi**:
   ```bash
   sudo apt install freerdp2-x11
   ```

3. **Connect**:
   ```bash
   xfreerdp /v:192.168.1.100 /u:your-windows-username
   ```
   
   Enter your Windows password when prompted.

#### Option C: Use VcXsrv for Specific GUI Apps

If you want to run just ONE application (like a browser) rather than the full desktop.

**Best for**: Running a single GUI app like a browser

**Steps:**

1. **On Windows**:
   - Download [VcXsrv](https://github.com/ArcticaProject/vcxsrv/releases) (look for the latest .exe file)
   - Run it
   - When prompted with configuration options, use:
     - Multiple windows
     - Display number: 0
     - Start no client
     - Disable access control (for testing - re-enable later for security)

2. **On Pi**, when running commands through SSH, set the DISPLAY variable:
   ```bash
   ssh your-username@192.168.1.100 "set DISPLAY=localhost:0 && firefox"
   ```

---

### Phase 4: Integrate with JARVIS

Now let's add this capability to JARVIS itself.

#### Step 4.1: Add the Dependency

Edit `hardware/pyproject.toml`:

```toml
dependencies = [
    # ... keep your existing dependencies ...
    "asyncssh>=2.14.0",
]
```

Then on your Pi, run:
```bash
cd /path/to/hardware
uv sync
```

This installs the asyncssh library that allows Python to make SSH connections.

#### Step 4.2: Create the Remote PC Tool

Create a new file `tools/remote_pc_tool.py`:

```python
"""Remote PC execution tool - opens apps on remote PC via SSH."""

from __future__ import annotations

import os
from typing import Any

import asyncssh

from tools.base import BaseTool


class RemotePCTool(BaseTool):
    """Execute commands or open applications on remote PC via SSH.
    
    Use this tool when:
    - Opening a browser on the remote PC
    - Running GUI applications
    - Executing commands that require PC resources
    - File operations on the remote PC
    """
    
    name = "remote_pc"
    description = """Execute commands or open applications on the remote PC.
    
    The output will appear on the remote PC's screen. Use this for:
    - Opening web browsers: "Start-Process firefox https://google.com"
    - Running applications: "Start-Process code", "Start-Process notepad"
    - System commands: "Get-Process", "dir"
    """
    
    def __init__(self) -> None:
        self.host = os.getenv("REMOTE_PC_HOST", "192.168.1.100")
        self.username = os.getenv("REMOTE_PC_USER", "your_username")
        self.key_path = os.getenv("REMOTE_PC_KEY", os.path.expanduser("~/.ssh/id_ed25519"))
    
    async def execute(self, command: str, timeout: int = 60) -> dict[str, Any]:
        """Execute command on remote PC.
        
        Args:
            command: Command to execute on PC 
            timeout: Timeout in seconds
            
        Returns:
            Dict with success status, stdout, stderr
        """
        
        # Wrap command for Windows PowerShell
        # Windows SSH defaults to CMD, but we need PowerShell for most modern commands
        if not command.startswith("powershell") and not command.startswith("Start-"):
            # Escape single quotes for PowerShell
            safe_command = command.replace("'", "''")
            wrapped_command = f"powershell -Command '{safe_command}'"
        else:
            wrapped_command = command
        
        try:
            async with asyncssh.connect(
                host=self.host,
                username=self.username,
                client_keys=[self.key_path],
                known_hosts=None,
                server_host_key_algs=['ssh-rsa', 'rsa-sha2-256', 'rsa-sha2-512', 'ed25519'],
            ) as conn:
                result = await conn.run(wrapped_command, timeout=timeout, stderr_is_stdout=True)
                
                return {
                    "success": result.exit_status == 0,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "exit_code": result.exit_status,
                    "message": f"Command executed on remote PC. Look at PC screen to see the result!"
                }
        except Exception as e:
            return {
                "success": False,
                "stdout": "",
                "stderr": str(e),
                "exit_code": -1,
                "message": f"Failed to execute on remote PC: {e}"
            }
    
    def get_schema(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Command to execute on remote PC. Use PowerShell commands like 'Start-Process https://google.com' or 'notepad'"
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Timeout in seconds (default 60)",
                        "default": 60
                    }
                },
                "required": ["command"]
            }
        }
```

#### Step 4.3: Register the Tool

In `hardware/app.py`:

1. **Add to imports** (find where other tools are imported):
   ```python
   from tools.remote_pc_tool import RemotePCTool
   ```

2. **Register the tool** (find the `register_tools` function):
   ```python
   registry.register_tool(RemotePCTool())
   ```

#### Step 4.4: Configure Environment Variables

Create or edit `hardware/.env`:

```bash
# Remote PC Configuration
REMOTE_PC_HOST=192.168.1.100
REMOTE_PC_USER=your_windows_username
REMOTE_PC_KEY=~/.ssh/id_ed25519
```

Replace the values:
- `REMOTE_PC_HOST`: Your PC's IP address from Step 1.3
- `REMOTE_PC_USER`: Your Windows username from Step 1.4
- `REMOTE_PC_KEY`: Path to your SSH private key (usually correct as-is)

---

## Usage Examples

### Open Browser

**User says**: "JARVIS, search for Python tutorials"

**What happens**:
1. JARVIS receives the request
2. JARVIS SSHs to your PC and executes:
   ```
   powershell -Command 'Start-Process https://www.python.org'
   ```
3. On your PC screen: Browser opens showing Python website

### Open File Explorer

**User says**: "JARVIS, show my documents folder"

**What happens**:
1. JARVIS SSHs to your PC and executes:
   ```
   powershell -Command 'explorer C:\Users\YourName\Documents'
   ```
2. On your PC screen: Windows File Explorer opens to that folder

### Run VS Code

**User says**: "JARVIS, open my project in VS Code"

**What happens**:
1. JARVIS SSHs to your PC and executes:
   ```
   powershell -Command 'Start-Process code C:\Users\YourName\Projects\MyProject'
   ```
2. On your PC screen: VS Code opens your project

---

## Complete Workflow Example

```
USER (looking at projector):
> JARVIS, I need to find the datasheet for an LM317 voltage regulator

JARVIS (processing):
> I should search for the LM317 datasheet. I'll open a browser on the remote PC.

JARVIS (on projector TUI):
> Searching for LM317 datasheet...
> Opening browser with search results...

JARVIS (sends to PC via SSH):
> powershell -Command 'Start-Process https://www.ti.com/lit/ds/symlink/lm317.pdf'

USER (looks at PC screen):
> Browser opens, showing the TI LM317 datasheet PDF

JARVIS (on projector):
> The LM317 is an adjustable voltage regulator. It can output from 1.25V to 37V 
> with up to 1.5A of current. The datasheet shows the typical applications include
> adjustable power supplies, battery chargers, and LED drivers.
```

---

## Security Considerations

### Use a Dedicated User (Recommended)

Instead of using your main Windows account, create a limited user specifically for JARVIS:

1. **On Windows PowerShell as Administrator**:
   ```powershell
   # Create a new user (change "YourSecurePassword123" to your desired password)
   New-LocalUser -Name "jarvis" -Password (ConvertTo-SecureString "YourSecurePassword123" -AsPlainText -Force) -Description "JARVIS automation user"
   
   # Add to standard users group (NOT administrators!)
   Add-LocalGroupMember -Group "Users" -Member "jarvis"
   ```

2. **In your .env file**, use this user:
   ```
   REMOTE_PC_USER=jarvis
   ```

**Why?** If something goes wrong, the damage is limited to a basic user account, not your main admin account.

### Firewall Restrictions

Instead of allowing SSH from ANY IP, restrict it to only your Pi's IP:

1. **On Windows PowerShell as Administrator**:
   ```powershell
   # First, remove the broad rule
   Remove-NetFirewallRule -Name "OpenSSH Server"
   
   # Create a limited rule - ONLY your Pi can connect
   # Replace 192.168.1.50 with your Pi's actual IP address
   New-NetFirewallRule -Name "JARVIS-SSH" -DisplayName "JARVIS SSH Access" -Enabled True -Direction Inbound -Protocol TCP -Action Allow -RemoteAddress 192.168.1.50 -LocalPort 22
   ```

### Use a Non-Standard Port (Optional)

For extra security, change the SSH port from default 22 to something else:

1. **On Windows**, open `C:\ProgramData\ssh\sshd_config` in Notepad

2. **Find the line** that says `Port 22` and change it to:
   ```
   Port 2222
   ```

3. **Save and restart SSH**:
   ```powershell
   Restart-Service sshd
   ```

4. **On Pi**, update your .env:
   ```
   REMOTE_PC_HOST=192.168.1.100:2222
   ```

---

## Troubleshooting

### Connection Issues

| Problem | Symptom | Solution |
|---------|---------|----------|
| **Connection refused** | "Connection refused" | Run `Start-Service sshd` on Windows |
| **Connection timed out** | "Connection timed out" | Check firewall: `Get-NetFirewallRule -Name "OpenSSH Server"` |
| **Permission denied (publickey)** | Can't connect | Re-run `ssh-copy-id` OR check authorized_keys file location |
| **REMOTE HOST IDENTIFICATION HAS CHANGED** | Security warning | Run `ssh-keygen -R 192.168.1.100` on Pi |

### Key Authentication Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| **"UNPROTECTED PRIVATE KEY FILE"** | File permissions too open | On Pi: `chmod 600 ~/.ssh/id_ed25519` |
| **"Server refused our key"** | Wrong authorized_keys location | Admin users must use `C:\ProgramData\ssh\administrators_authorized_keys` |
| **"Key too open"** | Windows permissions wrong | Run the icacls commands from Step 2.4 |

### Command Execution Issues

| Problem | Solution |
|---------|----------|
| **"Command not found"** | Use PowerShell explicitly: `powershell -Command "your command"` |
| **"Start-Process is not recognized"** | Make sure you're using PowerShell, not CMD |
| **App doesn't open** | Use VNC or RDP instead of SSH (SSH can't open GUI directly on Windows) |
| **Chinese characters display incorrectly** | Add charset: `chcp 65001` in your PowerShell command |

---

## Complete Setup Checklist

Use this checklist to verify everything is configured correctly:

### On Windows PC
- [ ] OpenSSH Server installed (`Get-Service sshd` shows "Running")
- [ ] Firewall rule exists (`Get-NetFirewallRule -Name "OpenSSH Server"`)
- [ ] Know your IP address (e.g., 192.168.1.100)
- [ ] Know your username (e.g., "john")
- [ ] SSH public key added to Windows
- [ ] Key file permissions set correctly (icacls commands)
- [ ] Tested: Can SSH in from another computer

### On Raspberry Pi
- [ ] openssh-client installed (`ssh -V` works)
- [ ] xauth installed
- [ ] SSH key generated (`ls ~/.ssh/id_ed25519`)
- [ ] Public key copied to Windows (`ssh-copy-id` succeeded)
- [ ] Tested: Can SSH to Windows without password

### In JARVIS Configuration
- [ ] asyncssh installed (`uv sync`)
- [ ] RemotePCTool created in tools/
- [ ] Tool registered in app.py
- [ ] .env file has correct REMOTE_PC_HOST
- [ ] .env file has correct REMOTE_PC_USER
- [ ] .env file has correct REMOTE_PC_KEY path
- [ ] Tested: JARVIS can execute commands on remote PC

---

## Summary

| Component | Location | Description |
|-----------|----------|-------------|
| **JARVIS TUI** | Projector | Unchanged - shows normal JARVIS interface |
| **Remote Commands** | PC via SSH | JARVIS sends commands via SSH |
| **Applications** | PC screen | Browser, IDE, files open on PC display |
| **Connection** | SSH | Key-based auth from Pi to Windows |

This setup gives you the best of both worlds - lightweight JARVIS running on the Pi with powerful PC resources for heavy tasks like browsing, coding, and file management!