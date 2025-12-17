# QR Drop 📱

**QR Drop** is a lightweight GNOME Shell extension that generates QR codes instantly from your clipboard content. It works completely offline and supports saving QR codes as images!

## Features ✨
- 📋 **Auto-Generate:** Just copy text, open the menu, and see the QR code.
- 🖼️ **Save to File:** Save the generated QR code as a PNG image in your Pictures folder.
- 🔒 **Privacy Focused:** Runs locally on your machine, no internet connection required.
- ⚡ **Auto-Scaling:** Supports everything from small URLs to large text paragraphs.

---

## Installation Guide 📦

Follow these steps to install the extension manually from the source code.

### Step 1: Download the Source Code
Open your terminal and clone the repository using git:
```bash
git clone [https://github.com/shuv-on/qr-drop.git](https://github.com/shuv-on/qr-drop.git)

```
### Step 2: Create the Extension Directory
We need to create a specific folder for this extension in your local GNOME directory. Run this command:
```bash
mkdir -p ~/.local/share/gnome-shell/extensions/qrdrop@shuvon.com
```

### Step 3: Install the Files
```bash
cp -r qr-drop/* ~/.local/share/gnome-shell/extensions/qrdrop@shuvon.com/
```

### Step 4: Restart GNOME Shell
- For X11 Users: Press Alt + F2, type r, and hit Enter.
- For Wayland Users: You must Log Out and Log In again (Restarting via command is not supported in Wayland).
### Step 5: Enable the Extension
```bash
gnome-extensions enable qrdrop@shuvon.com
```
